"""One linked canary; immutable predecessor, durable admission before HTTP."""
from contextlib import contextmanager, closing
from hashlib import sha256
import json
import os
from pathlib import Path
import secrets
import sqlite3
from typing import Annotated, Literal

from pydantic import ConfigDict, Field, StrictInt, computed_field, model_validator
from .models import StrictModel, Digest, MODEL, PROFILE, PROMPT_VERSION, canonical_bytes
from .worker_state import RecoveryRequired, safe_path


PARENT='pc-worker-20261019-1'
RUN='qwen-canary-1'
BINDING_FILES=tuple('backend/src/timepitch/'+name for name in (
    'runtime.py','config.py','agents/provider.py',
    *('chronicles/'+name+'.py' for name in ('canary_budget','canary_recovery','canary_runtime','canary','acceptance','worker',
        'worker_state','provider','diagnostics','facts','render','models','interfaces','http_client','service',
        'repository','auth','usage')),'api/chronicles.py','security.py'))+('backend/pyproject.toml','backend/uv.lock')
ANCESTOR_KEYS={'manifest.json','usage.anchor.json','usage.sqlite','report.json','quarantine'}
PINNED_SDK={'agent-framework-core':'1.22.0','agent-framework-foundry-local':'1.0.0b261015',
    'foundry-local-sdk':'0.5.1','openai':'3.31.0','httpx':'0.28.1'}


class CanaryRefused(RecoveryRequired):pass


def canary_directory(root):
    return safe_path(Path(root)/'.local/ai-worker-continuations'/PARENT/RUN)


def canary_implementation_binding(root):
    return {name:sha256(safe_path(Path(root)/name).read_bytes()).hexdigest() for name in BINDING_FILES}


class CanaryAuthorization(StrictModel):
    model_config=ConfigDict(extra='forbid',strict=True,frozen=True)
    run_id:Literal['qwen-canary-1']=RUN
    predecessor:Literal['pc-worker-20261019-1']=PARENT
    execution_phase:Literal[3]=3
    approval_ref:Digest
    workspace_root:str
    slot:Literal['timepitch-en-canary']='timepitch-en-canary'
    engine:Literal['timepitch']='timepitch'
    locale:Literal['en']='en'
    model_id:Literal[MODEL]=MODEL
    profile:Literal[PROFILE]=PROFILE
    prompt_version:Literal[PROMPT_VERSION]=PROMPT_VERSION
    new_http_max:Literal[4]=4
    cumulative_http_max:Literal[7]=7
    cumulative_reserved_max:Literal[8]=8
    predecessor_hashes:dict[str,Digest]
    source_sha256:Digest
    trace_hash:Digest
    fact_hash:Digest
    implementation:dict[str,Digest]
    sdk_versions:dict[str,str]=Field(default_factory=lambda:dict(PINNED_SDK))

    @model_validator(mode='after')
    def closure(self):
        if set(self.predecessor_hashes)!=ANCESTOR_KEYS or set(self.implementation)!=set(BINDING_FILES) or self.sdk_versions!=PINNED_SDK:
            raise ValueError('Incomplete canary binding')
        return self


def authorization_digest(authorization):return sha256(canonical_bytes(authorization)).hexdigest()


def verify_authorization(authorization,root):
    """Read-only, including ancestor SQLite. Never construct the legacy budget."""
    try:
        import importlib.metadata
        a=CanaryAuthorization.model_validate_json(authorization.model_dump_json())
        root=safe_path(root)
        if a.workspace_root!=str(root):raise ValueError()
        directory=canary_directory(root);auth=safe_path(directory/'authorization.json')
        if not auth.is_file() or auth.stat().st_size>16384:raise ValueError()
        raw=auth.read_bytes()
        if CanaryAuthorization.model_validate_json(raw)!=a:raise ValueError()
        from ..config import ROOT
        if root==ROOT:
            from .worker import check_private_acl
            check_private_acl(auth);check_private_acl(directory);check_private_acl(directory.parent)
        if any(importlib.metadata.version(name)!=version for name,version in a.sdk_versions.items()):raise ValueError()
        parent=safe_path(root/'.local/ai-worker-acceptance'/PARENT)
        for name,digest in a.predecessor_hashes.items():
            path=safe_path(root/'.local/inference-uncertain.json') if name=='quarantine' else safe_path(parent/name)
            if sha256(path.read_bytes()).hexdigest()!=digest:raise ValueError()
        manifest=json.loads((parent/'manifest.json').read_bytes());anchor=json.loads((parent/'usage.anchor.json').read_bytes())
        if manifest['grant']!=PARENT or manifest['profile']!=PROFILE or anchor['manifest']!=a.predecessor_hashes['manifest.json']:raise ValueError()
        with closing(sqlite3.connect((parent/'usage.sqlite').resolve().as_uri()+'?mode=ro',uri=True)) as conn:
            meta=conn.execute('SELECT nonce,manifest,halted FROM metadata').fetchall()
            if meta!=[(anchor['nonce'],anchor['manifest'],1)]:raise ValueError()
            if conn.execute('SELECT SUM(charged),SUM(reserved),SUM(responses) FROM slots').fetchone()!=(3,4,3):raise ValueError()
            if conn.execute("SELECT state FROM slots WHERE name='preflight'").fetchall()!=[('failed',)]:raise ValueError()
        entry=manifest['sources']['timepitch'];source=safe_path(parent/entry['file'])
        if not source.is_relative_to(parent) or source.stat().st_size>16*1024*1024:raise ValueError()
        if (entry['sha256'],entry['trace_hash'],entry['fact_hash'])!=(a.source_sha256,a.trace_hash,a.fact_hash):raise ValueError()
        if sha256(source.read_bytes()).hexdigest()!=a.source_sha256 or canary_implementation_binding(root)!=a.implementation:raise ValueError()
        return sha256(raw).hexdigest(),source
    except (OSError,ValueError,KeyError,TypeError,ImportError,sqlite3.Error,RecoveryRequired):
        raise CanaryRefused('Canary approval, predecessor or implementation is unavailable or changed') from None


class CanaryUsage(StrictModel):
    state:Literal['fresh','running','succeeded','failed','aborted']
    inherited_charged:Literal[3]=3
    inherited_reserved:Literal[4]=4
    new_charged:Annotated[StrictInt,Field(ge=0,le=4)]
    new_reserved:Literal[0,4]
    new_response_headers:Annotated[StrictInt,Field(ge=0,le=4)]

    @model_validator(mode='after')
    def invariant(self):
        if self.new_response_headers>self.new_charged:raise ValueError('Unadmitted header')
        if self.new_reserved==0 and (self.new_charged or self.state not in ('fresh','aborted')):raise ValueError('Invalid reservation')
        if self.state=='fresh' and self.new_reserved:raise ValueError('Fresh state is reserved')
        return self

    @computed_field
    @property
    def cumulative_charged(self)->int:return 3+self.new_charged
    @computed_field
    @property
    def cumulative_reserved(self)->int:return 4+self.new_reserved


class CanaryBudget:
    def __init__(self,authorization,*,root,path=None):
        self.root=safe_path(root);self.authorization=CanaryAuthorization.model_validate_json(authorization.model_dump_json())
        self.directory=canary_directory(self.root);self.path=safe_path(self.directory/'usage.sqlite')
        if path is not None and safe_path(path)!=self.path:raise CanaryRefused('Canary has one canonical path')
        self.anchor=safe_path(self.directory/'usage.anchor.json')
        self.guard=safe_path(self.directory.parent/(RUN+'.issued.json'))

    @classmethod
    def create_once(cls,authorization,*,root):
        auth_hash,_=verify_authorization(authorization,root)
        b=cls(authorization,root=root)
        if b.guard.exists() or b.anchor.exists() or b.path.exists():raise CanaryRefused('Canary already exists; never initialise again')
        nonce=secrets.token_hex(32)
        try:
            witness=json.dumps({'nonce':nonce,'authorization':auth_hash}).encode()
            for path,data in ((b.guard,witness),(b.anchor,witness),(b.path,b'')):
                with path.open('xb') as stream:
                    os.chmod(path,0o600);stream.write(data);stream.flush();os.fsync(stream.fileno())
            with closing(sqlite3.connect(b.path)) as conn,conn:
                conn.execute('CREATE TABLE canary(nonce TEXT,authorization TEXT,state TEXT,charged INTEGER,reserved INTEGER,headers INTEGER,recovery TEXT,recovery_used INTEGER)')
                conn.execute("INSERT INTO canary VALUES(?,?,'fresh',0,0,0,NULL,0)",(nonce,auth_hash))
        except (OSError,sqlite3.Error):raise CanaryRefused('Interrupted canary creation; preserve evidence') from None
        return b

    @contextmanager
    def connection(self):
        conn=None
        try:
            auth_hash,_=verify_authorization(self.authorization,self.root)
            safe_path(self.path);safe_path(self.anchor);safe_path(self.guard)
            if not self.path.is_file() or not self.anchor.is_file() or self.anchor.stat().st_size>2048 or not self.guard.is_file() or self.guard.stat().st_size>2048:raise ValueError()
            if self.guard.read_bytes()!=self.anchor.read_bytes():raise ValueError()
            anchor=json.loads(self.anchor.read_bytes())
            conn=sqlite3.connect(self.path.resolve().as_uri()+'?mode=rw',uri=True,timeout=10);conn.row_factory=sqlite3.Row
            conn.execute('BEGIN IMMEDIATE');rows=conn.execute('SELECT * FROM canary').fetchall()
            if len(rows)!=1 or rows[0]['nonce']!=anchor['nonce'] or rows[0]['authorization']!=anchor['authorization'] or anchor['authorization']!=auth_hash:raise ValueError()
            row=rows[0]
            if row['recovery_used'] not in (0,1) or (row['recovery_used'] and not row['recovery']):raise ValueError()
            usage=CanaryUsage(state=row['state'],new_charged=row['charged'],new_reserved=row['reserved'],new_response_headers=row['headers'])
            yield conn,row,usage
            conn.commit()
        except (OSError,ValueError,KeyError,sqlite3.Error,RecoveryRequired):
            if conn:conn.rollback()
            raise CanaryRefused('Canary is invalid, changed or no longer admissible') from None
        finally:
            if conn:conn.close()

    def snapshot(self):
        with self.connection() as (_,row,usage):return usage

    def nonce(self):
        with self.connection() as (_,row,__):return row['nonce']

    def begin(self):
        with self.connection() as (conn,_,usage):
            if usage.state!='fresh':raise CanaryRefused('Canary cannot restart')
            conn.execute("UPDATE canary SET state='running',reserved=4")

    def claim_recovery(self,digest):
        with self.connection() as (conn,row,usage):
            if usage.state!='fresh' or row['recovery'] is not None:raise CanaryRefused('Recovery already issued')
            conn.execute('UPDATE canary SET recovery=?',(digest,))

    def consume_recovery(self,digest):
        with self.connection() as (conn,row,usage):
            if usage.state!='fresh' or row['recovery']!=digest or row['recovery_used']:raise CanaryRefused('Recovery cannot be replayed')
            conn.execute('UPDATE canary SET recovery_used=1')

    def reserve_http(self,count):
        with self.connection() as (conn,_,usage):
            if type(count) is not int or count!=1 or usage.state!='running' or usage.new_charged>=4:raise CanaryRefused('Canary HTTP denied')
            conn.execute('UPDATE canary SET charged=charged+1')

    def response(self):
        with self.connection() as (conn,_,usage):
            if usage.state not in ('running','failed') or usage.new_response_headers>=usage.new_charged:raise CanaryRefused('Unadmitted canary response')
            conn.execute('UPDATE canary SET headers=headers+1')

    def finish(self,outcome):
        with self.connection() as (conn,_,usage):
            if outcome not in ('succeeded','failed','aborted') or usage.state not in ('fresh','running'):raise CanaryRefused('Canary is terminal')
            if usage.state=='fresh' and outcome!='aborted':raise CanaryRefused('Only unreserved abort is valid')
            if outcome=='succeeded' and not usage.new_charged:raise CanaryRefused('No successful inference observed')
            conn.execute('UPDATE canary SET state=?',(outcome,))
