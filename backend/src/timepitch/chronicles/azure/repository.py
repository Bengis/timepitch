"""Additive SQLite jobs with a private rollback-detection anchor and one send permit."""
from contextlib import contextmanager
from decimal import Decimal
from hashlib import sha256
import hmac
import json
import math
import os
from pathlib import Path
import secrets
import sqlite3
import time

from pydantic import TypeAdapter

from ..models import ChronicleRequest, FactPack, canonical_bytes, fact_pack_hash
from .budget import maximum_liability
from .models import (AncestorSummary, AzureBinding, AzureClaim, AzureGrant, AzureJobView, AzureLease,
    AzureReceipt, AzureTerminalReceipt, CheckedDraft, ErrorCode, PreparedAzureRequest, SendPermit,
    binding_hash, model_digest)
from .validation import validate_draft


class AzureConflict(ValueError): pass
class AzureBudgetExceeded(AzureConflict): pass
class AzureClockRegression(AzureConflict): pass


def clean(cls, value):
    return cls.model_validate_json(canonical_bytes(value))


def _digest(value):
    return sha256(json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode()).hexdigest()


class AzureRepository:
    def __init__(self,path:Path,*,clock=time.time):
        self.path,self.clock=Path(path),clock
        self.private_dir=self.path.with_name(self.path.name+'.azure-private')
        self.anchor_path=self.private_dir/'budget.anchor'
        self.ancestor_dir=self.private_dir/'ancestors'
        self.path.parent.mkdir(parents=True,exist_ok=True)
        self.private_dir.mkdir(mode=0o700,parents=True,exist_ok=True)
        self.ancestor_dir.mkdir(mode=0o700,exist_ok=True)
        with self.connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            exists=conn.execute("SELECT 1 FROM sqlite_master WHERE name='azure_chronicle_meta'").fetchone()
            if exists:
                if conn.execute('SELECT version FROM azure_chronicle_meta WHERE id=1').fetchone()[0]!=1:
                    raise AzureConflict('Unsupported Azure schema')
                self._check(conn)
            else:
                if self.anchor_path.exists() or any(self.private_dir.glob('grant-*.json')) or any(self.ancestor_dir.iterdir()):
                    raise AzureConflict('Azure history exists without its database')
                statements=[
                    'CREATE TABLE azure_chronicle_meta(id INTEGER PRIMARY KEY,version INTEGER,state_id TEXT,seq INTEGER,high_water REAL,blocked TEXT)',
                    'CREATE TABLE azure_chronicle_grants(id TEXT PRIMARY KEY,payload TEXT NOT NULL,digest TEXT NOT NULL)',
                    '''CREATE TABLE azure_chronicle_jobs(id TEXT PRIMARY KEY,owner TEXT,request TEXT,pack TEXT,fact_hash TEXT,
                        binding TEXT,binding_hash TEXT,cache_key TEXT UNIQUE,state TEXT,error TEXT,created REAL,deadline REAL,
                        generation INTEGER DEFAULT 0,worker TEXT,lease_hash TEXT,checked TEXT,checked_hash TEXT)''',
                    '''CREATE TABLE azure_chronicle_attempts(id TEXT PRIMARY KEY,job_id TEXT UNIQUE,owner TEXT,request_hash TEXT,
                        input_bound INTEGER,output_bound INTEGER,currency TEXT,reserved TEXT,tariff TEXT,receipt TEXT,
                        actual_money TEXT,uncertain INTEGER DEFAULT 0)''',
                    'CREATE TABLE azure_chronicle_ancestors(digest TEXT PRIMARY KEY,attempt_id TEXT UNIQUE,payload TEXT NOT NULL)',
                ]
                for sql in statements: conn.execute(sql)
                conn.execute('INSERT INTO azure_chronicle_meta VALUES(1,1,?,0,0,NULL)',(secrets.token_hex(32),))
                self._seal(conn)
            conn.commit()

    @contextmanager
    def connection(self):
        conn=sqlite3.connect(self.path,timeout=10)
        conn.row_factory=sqlite3.Row
        conn.execute('PRAGMA synchronous=FULL')
        try: yield conn
        finally: conn.close()

    def _database_digest(self,conn):
        names=[r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'azure_chronicle_%' ORDER BY name")]
        return _digest({name:[tuple(row) for row in conn.execute('SELECT * FROM "'+name+'" ORDER BY rowid')] for name in names})

    def _write_private(self,path,raw,*,replace=False):
        target=path.with_name(path.name+'.'+secrets.token_hex(8)+'.tmp') if replace else path
        fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        try:
            with os.fdopen(fd,'wb') as stream:
                stream.write(raw);stream.flush();os.fsync(stream.fileno())
            if replace: os.replace(target,path)
            if os.name!='nt':
                directory=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY)
                try: os.fsync(directory)
                finally: os.close(directory)
        finally:
            if replace and target.exists(): target.unlink()

    def _seal(self,conn):
        conn.execute('UPDATE azure_chronicle_meta SET seq=seq+1 WHERE id=1')
        meta=conn.execute('SELECT * FROM azure_chronicle_meta WHERE id=1').fetchone()
        raw=json.dumps({'state_id':meta['state_id'],'digest':self._database_digest(conn)},sort_keys=True).encode()
        # A crash before SQLite commit leaves an anchor mismatch and denies another send.
        self._write_private(self.anchor_path,raw,replace=self.anchor_path.exists())

    def _check(self,conn):
        try:
            raw=self.anchor_path.read_bytes()
            if len(raw)>2048: raise ValueError()
            anchor=json.loads(raw)
            meta=conn.execute('SELECT * FROM azure_chronicle_meta WHERE id=1').fetchone()
            if meta['version']!=1 or anchor!={'state_id':meta['state_id'],'digest':self._database_digest(conn)}:
                raise ValueError()
            for row in conn.execute('SELECT * FROM azure_chronicle_grants'):
                data=(self.private_dir/('grant-'+row['id']+'.json')).read_bytes()
                if sha256(data).hexdigest()!=row['digest'] or data.decode()!=row['payload']: raise ValueError()
            for row in conn.execute('SELECT * FROM azure_chronicle_ancestors'):
                data=(self.ancestor_dir/(row['digest']+'.json')).read_bytes()
                if model_digest(AzureTerminalReceipt.model_validate_json(data))!=row['digest']: raise ValueError()
        except (OSError,ValueError,TypeError,KeyError):
            raise AzureConflict('Azure history or private anchor mismatch') from None

    @contextmanager
    def _read(self):
        with self.connection() as conn:
            conn.execute('BEGIN')
            self._check(conn)
            yield conn

    def _expire(self,conn,now,reason=None):
        if reason:
            conn.execute("UPDATE azure_chronicle_jobs SET state='unavailable',error=? WHERE state IN ('queued','running')",(reason,))
        else:
            conn.execute("UPDATE azure_chronicle_jobs SET state='unavailable',error='queue_expired' WHERE state='queued' AND deadline<=?",(now,))
            conn.execute("UPDATE azure_chronicle_jobs SET state='unavailable',error='job_timeout' WHERE state='running' AND deadline<=?",(now,))
        conn.execute("UPDATE azure_chronicle_attempts SET uncertain=1 WHERE receipt IS NULL AND job_id IN (SELECT id FROM azure_chronicle_jobs WHERE state='unavailable')")

    @contextmanager
    def _transaction(self):
        with self.connection() as conn:
            conn.execute('BEGIN IMMEDIATE'); self._check(conn)
            now=self.clock(); high=conn.execute('SELECT high_water FROM azure_chronicle_meta WHERE id=1').fetchone()[0]
            if type(now) not in (int,float) or not math.isfinite(now) or now<high:
                self._expire(conn,high,'clock_regressed');self._seal(conn);conn.commit()
                raise AzureClockRegression('Clock regressed')
            conn.execute('UPDATE azure_chronicle_meta SET high_water=? WHERE id=1',(now,)); self._expire(conn,now)
            conn.execute('SAVEPOINT operation')
            try: yield conn,float(now)
            except Exception:
                conn.execute('ROLLBACK TO operation');conn.execute('RELEASE operation')
                self._seal(conn);conn.commit();raise
            else:
                conn.execute('RELEASE operation');self._seal(conn);conn.commit()

    @property
    def state_id(self):
        with self._read() as conn: return conn.execute('SELECT state_id FROM azure_chronicle_meta').fetchone()[0]

    def _lineage(self,conn):
        return _digest([conn.execute('SELECT state_id FROM azure_chronicle_meta').fetchone()[0],
            sorted(r[0] for r in conn.execute('SELECT digest FROM azure_chronicle_ancestors')),
            sorted((r['id'],r['request_hash'],r['reserved']) for r in conn.execute('SELECT * FROM azure_chronicle_attempts'))])

    def lineage_digest(self):
        with self._read() as conn: return self._lineage(conn)

    def install_grant(self,grant:AzureGrant):
        grant=clean(AzureGrant,grant);raw=canonical_bytes(grant)
        with self._transaction() as (conn,now):
            existing=conn.execute('SELECT payload FROM azure_chronicle_grants WHERE id=?',(grant.id,)).fetchone()
            if existing:
                if existing[0]!=raw.decode(): raise AzureConflict('Immutable grant changed')
                return
            if grant.state_id!=conn.execute('SELECT state_id FROM azure_chronicle_meta').fetchone()[0] or grant.parent_digest!=self._lineage(conn) or grant.expires_at<=now:
                raise AzureConflict('Grant lineage, state or expiry mismatch')
            usage=self._usage(conn)
            if usage['currencies'] and usage['currencies']!={grant.tariff.currency}: raise AzureConflict('Currency conversion is not supported')
            self._write_private(self.private_dir/('grant-'+grant.id+'.json'),raw)
            conn.execute('INSERT INTO azure_chronicle_grants VALUES(?,?,?)',(grant.id,raw.decode(),sha256(raw).hexdigest()))

    def _usage(self,conn):
        calls=inputs=outputs=exposed_inputs=exposed_outputs=0;reserved=Decimal(0); exposure=Decimal(0); actuals=[]; actual_inputs=[]; currencies=set()
        for row in conn.execute('SELECT * FROM azure_chronicle_attempts'):
            calls+=1;inputs+=row['input_bound'];outputs+=row['output_bound'];reserved+=Decimal(row['reserved']);currencies.add(row['currency'])
            value=AzureReceipt.model_validate_json(row['receipt']) if row['receipt'] else None
            exposed_inputs+=max(row['input_bound'],value.input_tokens or 0) if value else row['input_bound']
            exposed_outputs+=max(row['output_bound'],value.output_tokens or 0) if value else row['output_bound']
            actuals.append(Decimal(row['actual_money']) if row['actual_money'] is not None else None)
            exposure+=max(Decimal(row['reserved']),Decimal(row['actual_money']) if row['actual_money'] is not None else Decimal(0))
            actual_inputs.append(value.input_tokens if value else None)
        for row in conn.execute('SELECT payload FROM azure_chronicle_ancestors'):
            value=AzureTerminalReceipt.model_validate_json(row[0]); calls+=value.charged_dispatches
            inputs+=value.reserved_input_tokens;outputs+=value.reserved_output_tokens;reserved+=value.reserved_money;currencies.add(value.currency)
            actuals.append(value.actual_money);actual_inputs.append(value.actual_input_tokens)
            exposure+=max(value.reserved_money,value.actual_money or Decimal(0))
            exposed_inputs+=max(value.reserved_input_tokens,value.actual_input_tokens or 0)
            exposed_outputs+=max(value.reserved_output_tokens,value.actual_output_tokens or 0)
        return {'charged_calls':calls,'reserved_input_tokens':inputs,'reserved_output_tokens':outputs,'reserved_money':reserved,'exposure_money':exposure,
            'exposure_input_tokens':exposed_inputs,'exposure_output_tokens':exposed_outputs,
            'actual_money':None if any(v is None for v in actuals) else sum(actuals,Decimal(0)),
            'actual_input_tokens':None if any(v is None for v in actual_inputs) else sum(actual_inputs), 'currencies':currencies}

    def usage(self):
        with self._read() as conn: return self._usage(conn)

    def _grant(self,conn,now,binding,owner,request):
        row=conn.execute('SELECT payload FROM azure_chronicle_grants ORDER BY rowid DESC LIMIT 1').fetchone()
        if row is None: raise AzureBudgetExceeded('No Azure grant')
        grant=AzureGrant.model_validate_json(row[0]);usage=self._usage(conn)
        cost=maximum_liability(grant.tariff,binding.input_token_ceiling,2048)
        if usage['currencies'] and usage['currencies']!={grant.tariff.currency}:raise AzureConflict('Currency conversion is not supported')
        if (grant.binding_hash!=binding_hash(binding) or grant.expires_at<=now or usage['charged_calls']>=grant.call_limit
            or usage['exposure_input_tokens']+binding.input_token_ceiling>grant.input_limit
            or usage['exposure_output_tokens']+2048>grant.output_limit or usage['exposure_money']+cost>grant.money_limit):
            raise AzureBudgetExceeded('Azure allowance exhausted or mismatched')
        for name,actual in (('owner',owner),('engine',request.engine),('match_id',request.match_id),('trace_hash',request.trace_hash),('locale',request.locale)):
            if getattr(grant,name) is not None and getattr(grant,name)!=actual: raise AzureBudgetExceeded('Grant scope mismatch')
        owned=conn.execute('SELECT COUNT(*) FROM azure_chronicle_attempts WHERE owner=?',(owner,)).fetchone()[0]
        if owned>=grant.per_owner_calls: raise AzureBudgetExceeded('Owner allowance exhausted')
        if conn.execute('SELECT blocked FROM azure_chronicle_meta').fetchone()[0] or conn.execute('SELECT 1 FROM azure_chronicle_attempts WHERE uncertain=1 LIMIT 1').fetchone():
            raise AzureConflict('Unresolved Azure liability')
        return grant,cost

    def _view(self,row):
        req=ChronicleRequest.model_validate_json(row['request'])
        checked=CheckedDraft.model_validate_json(row['checked']) if row['checked'] else None
        if checked and model_digest(checked)!=row['checked_hash']: raise AzureConflict('Changed checked draft')
        return AzureJobView(id=row['id'],engine=req.engine,match_id=req.match_id,trace_hash=req.trace_hash,
            locale=req.locale,fact_hash=row['fact_hash'],state=row['state'],error=row['error'],checked=checked)

    def _pack(self,row):
        pack=FactPack.model_validate_json(row['pack'])
        if fact_pack_hash(pack)!=row['fact_hash']: raise AzureConflict('Changed facts')
        return pack

    def _key(self,owner,request,pack,binding):
        return _digest([owner,request.model_dump(),fact_pack_hash(pack),binding_hash(binding)])

    def submit(self,owner,request,pack,binding):
        request=clean(ChronicleRequest,request); pack=clean(FactPack,pack); binding=clean(AzureBinding,binding)
        if pack.engine!=request.engine or pack.trace_hash!=request.trace_hash: raise AzureConflict('Source identity mismatch')
        key=self._key(owner,request,pack,binding)
        with self._transaction() as (conn,now):
            row=conn.execute('SELECT * FROM azure_chronicle_jobs WHERE cache_key=?',(key,)).fetchone()
            if row: return self._view(row)
            self._grant(conn,now,binding,owner,request)
            if conn.execute("SELECT COUNT(*) FROM azure_chronicle_jobs WHERE state='queued'").fetchone()[0]>=4:
                raise AzureBudgetExceeded('Azure queue is full')
            id=secrets.token_urlsafe(18)
            conn.execute('''INSERT INTO azure_chronicle_jobs(id,owner,request,pack,fact_hash,binding,binding_hash,cache_key,state,created,deadline)
                VALUES(?,?,?,?,?,?,?,?,'queued',?,?)''',(id,owner,canonical_bytes(request).decode(),canonical_bytes(pack).decode(),
                fact_pack_hash(pack),canonical_bytes(binding).decode(),binding_hash(binding),key,now,now+900))
            return self._view(conn.execute('SELECT * FROM azure_chronicle_jobs WHERE id=?',(id,)).fetchone())

    def get(self,owner,job_id):
        self._tick()
        with self._read() as conn:
            row=conn.execute('SELECT * FROM azure_chronicle_jobs WHERE id=? AND owner=?',(job_id,owner)).fetchone()
            if row is None: raise KeyError(job_id)
            return self._view(row)

    def lookup(self,owner,request,binding):
        self._tick()
        with self._read() as conn:
            for row in conn.execute('SELECT * FROM azure_chronicle_jobs WHERE owner=? AND binding_hash=? ORDER BY rowid DESC',(owner,binding_hash(binding))):
                if ChronicleRequest.model_validate_json(row['request'])==request: return self._view(row)
            return None

    def internal(self,job_id):
        with self._read() as conn:
            row=conn.execute('SELECT * FROM azure_chronicle_jobs WHERE id=?',(job_id,)).fetchone()
            if row is None: raise KeyError(job_id)
            return row['owner'],ChronicleRequest.model_validate_json(row['request']),self._pack(row)

    def claim(self,worker_id):
        with self._transaction() as (conn,now):
            if conn.execute("SELECT 1 FROM azure_chronicle_jobs WHERE state='running'").fetchone(): return None
            row=conn.execute("SELECT * FROM azure_chronicle_jobs WHERE state='queued' ORDER BY created,rowid LIMIT 1").fetchone()
            if row is None:return None
            req=ChronicleRequest.model_validate_json(row['request']);binding=AzureBinding.model_validate_json(row['binding'])
            self._grant(conn,now,binding,row['owner'],req)
            token=secrets.token_urlsafe(32);generation=row['generation']+1
            conn.execute("UPDATE azure_chronicle_jobs SET state='running',worker=?,generation=?,lease_hash=?,deadline=? WHERE id=?",
                (worker_id,generation,sha256(token.encode()).hexdigest(),now+180,row['id']))
            return AzureClaim(owner=row['owner'],request=req,fact_pack=self._pack(row),binding=binding,
                lease=AzureLease(job_id=row['id'],generation=generation,token=token,fact_hash=row['fact_hash']))

    def _lease(self,conn,lease,*,ready=False,terminal=False):
        lease=clean(AzureLease,lease)
        row=conn.execute('SELECT * FROM azure_chronicle_jobs WHERE id=?',(lease.job_id,)).fetchone()
        if (row is None or row['generation']!=lease.generation or row['fact_hash']!=lease.fact_hash
            or not hmac.compare_digest(row['lease_hash'] or '',sha256(lease.token.encode()).hexdigest())
            or row['state'] not in (('running','ready','unavailable','rejected','stale') if terminal else ('running','ready') if ready else ('running',))):
            raise AzureConflict('Invalid or inactive Azure lease')
        return row

    def validate_lease(self,lease,*,receipt=False):
        with self._read() as conn: self._lease(conn,lease,ready=True,terminal=receipt)

    def binding_for_lease(self,lease):
        with self._read() as conn:
            row=self._lease(conn,lease,terminal=True)
            return AzureBinding.model_validate_json(row['binding'])

    def authorize_send(self,lease,prepared):
        prepared=clean(PreparedAzureRequest,prepared)
        with self._transaction() as (conn,now):
            row=self._lease(conn,lease);binding=AzureBinding.model_validate_json(row['binding'])
            if (prepared.binding_hash!=row['binding_hash'] or prepared.fact_hash!=row['fact_hash']
                or prepared.input_upper_tokens!=binding.input_token_ceiling or prepared.body.get('model')!=binding.deployment
                or prepared.body.get('max_output_tokens')!=2048 or prepared.body.get('store') is not False
                or prepared.body.get('tools') or prepared.body.get('background') or prepared.body.get('previous_response_id')):
                raise AzureConflict('Prepared request differs from fixed job binding')
            if conn.execute('SELECT 1 FROM azure_chronicle_attempts WHERE job_id=?',(row['id'],)).fetchone():
                raise AzureConflict('Attempt already consumed')
            grant,cost=self._grant(conn,now,binding,row['owner'],ChronicleRequest.model_validate_json(row['request']))
            id=secrets.token_urlsafe(18)
            conn.execute('''INSERT INTO azure_chronicle_attempts(id,job_id,owner,request_hash,input_bound,output_bound,currency,reserved,tariff)
                VALUES(?,?,?,?,?,2048,?,?,?)''',(id,row['id'],row['owner'],prepared.request_hash,prepared.input_upper_tokens,
                    grant.tariff.currency,str(cost),canonical_bytes(grant.tariff).decode()))
            return SendPermit(attempt_id=id,request_hash=prepared.request_hash)

    def record_receipt(self,lease,receipt):
        from .models import Tariff
        receipt=clean(AzureReceipt,receipt)
        with self._transaction() as (conn,_):
            # Fenced late usage is valuable, but it cannot reopen an expired job.
            row=self._lease(conn,lease,terminal=True)
            attempt=conn.execute('SELECT * FROM azure_chronicle_attempts WHERE job_id=?',(row['id'],)).fetchone()
            if attempt is None or (attempt['id'],attempt['request_hash'])!=(receipt.attempt_id,receipt.request_hash):
                raise AzureConflict('Receipt differs from admitted attempt')
            raw=canonical_bytes(receipt).decode()
            if attempt['receipt']:
                if attempt['receipt']!=raw: raise AzureConflict('Immutable receipt changed')
                return
            actual=None
            if receipt.input_tokens is not None and receipt.output_tokens is not None:
                actual=str(maximum_liability(Tariff.model_validate_json(attempt['tariff']),receipt.input_tokens,receipt.output_tokens))
            conn.execute('UPDATE azure_chronicle_attempts SET receipt=?,actual_money=? WHERE id=?',(raw,actual,attempt['id']))
            if ((receipt.input_tokens is not None and receipt.input_tokens>attempt['input_bound']) or
                (receipt.output_tokens is not None and receipt.output_tokens>2048) or
                (receipt.reasoning_tokens is not None and receipt.output_tokens is not None and receipt.reasoning_tokens>receipt.output_tokens)):
                conn.execute("UPDATE azure_chronicle_meta SET blocked='usage_bound_exceeded' WHERE id=1")
                conn.execute("UPDATE azure_chronicle_jobs SET state='unavailable',error='usage_bound_exceeded' WHERE id=?",(row['id'],))

    def saved_receipt(self,lease):
        with self._read() as conn:
            row=self._lease(conn,lease,terminal=True)
            attempt=conn.execute('SELECT receipt FROM azure_chronicle_attempts WHERE job_id=?',(row['id'],)).fetchone()
            return AzureReceipt.model_validate_json(attempt[0]) if attempt and attempt[0] else None

    def has_attempt(self,lease):
        with self._read() as conn:
            row=self._lease(conn,lease,terminal=True)
            return conn.execute('SELECT 1 FROM azure_chronicle_attempts WHERE job_id=?',(row['id'],)).fetchone() is not None

    def interrupt_orphans(self):
        """Only the exclusive consumer calls this when its private outbox is absent."""
        with self._transaction() as (conn,_):
            rows=conn.execute("SELECT id FROM azure_chronicle_jobs WHERE state='running'").fetchall()
            for row in rows:
                attempt=conn.execute('SELECT id,receipt FROM azure_chronicle_attempts WHERE job_id=?',(row['id'],)).fetchone()
                uncertain=attempt is not None and not attempt['receipt']
                if uncertain:conn.execute('UPDATE azure_chronicle_attempts SET uncertain=1 WHERE id=?',(attempt['id'],))
                conn.execute("UPDATE azure_chronicle_jobs SET state='unavailable',error=? WHERE id=?",
                    ('uncertain_send' if uncertain else 'provider_error',row['id']))
            if conn.execute('SELECT 1 FROM azure_chronicle_attempts WHERE uncertain=1 LIMIT 1').fetchone():return 'uncertain_send'
            return 'provider_error' if rows else None

    def finish(self,lease,checked):
        checked=clean(CheckedDraft,checked)
        with self._transaction() as (conn,_):
            row=self._lease(conn,lease,ready=True)
            attempt=conn.execute('SELECT receipt FROM azure_chronicle_attempts WHERE job_id=?',(row['id'],)).fetchone()
            if attempt is None or not attempt[0]: raise AzureConflict('No durable provider receipt')
            receipt=AzureReceipt.model_validate_json(attempt[0]);binding=AzureBinding.model_validate_json(row['binding'])
            if receipt.error or receipt.model!=binding.expected_model or receipt.draft is None:
                raise AzureConflict('Provider result cannot be accepted')
            expected=validate_draft(self._pack(row),receipt.draft,ChronicleRequest.model_validate_json(row['request']).locale)
            if canonical_bytes(expected)!=canonical_bytes(checked): raise AzureConflict('Checked draft differs from receipt facts')
            if row['state']=='ready':
                if row['checked_hash']!=model_digest(checked):raise AzureConflict('Immutable accepted draft changed')
                return self._view(row)
            conn.execute("UPDATE azure_chronicle_jobs SET state='ready',error=NULL,checked=?,checked_hash=? WHERE id=?",
                (canonical_bytes(checked).decode(),model_digest(checked),row['id']))
            return self._view(conn.execute('SELECT * FROM azure_chronicle_jobs WHERE id=?',(row['id'],)).fetchone())

    def fail(self,lease,code,*,uncertain=False):
        TypeAdapter(ErrorCode).validate_python(code)
        with self._transaction() as (conn,_):
            row=self._lease(conn,lease)
            state='stale' if code=='stale_revision' else 'rejected' if code=='invalid_result' else 'unavailable'
            conn.execute('UPDATE azure_chronicle_jobs SET state=?,error=? WHERE id=?',(state,code,row['id']))
            if uncertain: conn.execute('UPDATE azure_chronicle_attempts SET uncertain=1 WHERE job_id=?',(row['id'],))

    def verify_ancestor(self,receipt):
        receipt=clean(AzureTerminalReceipt,receipt);digest=model_digest(receipt)
        try: anchored=AzureTerminalReceipt.model_validate_json((self.ancestor_dir/(digest+'.json')).read_bytes())
        except (OSError,ValueError):raise AzureConflict('Missing trusted ancestor anchor') from None
        if model_digest(anchored)!=digest: raise AzureConflict('Changed ancestor anchor')
        return AncestorSummary(**receipt.model_dump(),receipt_digest=digest)

    def import_ancestor(self,summary):
        try:summary=clean(AncestorSummary,summary)
        except ValueError:raise AzureConflict('Invalid ancestor summary') from None
        verified=self.verify_ancestor(AzureTerminalReceipt.model_validate_json(json.dumps(summary.model_dump(mode='json',exclude={'receipt_digest'}))))
        if verified!=summary: raise AzureConflict('Unverified ancestor totals')
        with self._transaction() as (conn,_):
            if conn.execute('SELECT 1 FROM azure_chronicle_ancestors WHERE digest=?',(summary.receipt_digest,)).fetchone():return
            if conn.execute('SELECT 1 FROM azure_chronicle_attempts WHERE id=?',(summary.attempt_id,)).fetchone():raise AzureConflict('Ancestor attempt is already local')
            usage=self._usage(conn)
            if usage['currencies'] and usage['currencies']!={summary.currency}:raise AzureConflict('Ancestor currency mismatch')
            active=conn.execute('SELECT payload FROM azure_chronicle_grants ORDER BY rowid DESC LIMIT 1').fetchone()
            if active and AzureGrant.model_validate_json(active[0]).tariff.currency!=summary.currency:
                raise AzureConflict('Ancestor currency differs from active grant')
            try:conn.execute('INSERT INTO azure_chronicle_ancestors VALUES(?,?,?)',(summary.receipt_digest,summary.attempt_id,canonical_bytes(AzureTerminalReceipt.model_validate_json(json.dumps(summary.model_dump(mode='json',exclude={'receipt_digest'})))).decode()))
            except sqlite3.IntegrityError:raise AzureConflict('Overlapping ancestor attempt') from None

    def available(self,owner,binding):
        if binding is None:return False
        with self._read() as conn:
            now=self.clock()
            high=conn.execute('SELECT high_water FROM azure_chronicle_meta').fetchone()[0]
            if type(now) not in (int,float) or not math.isfinite(now) or now<high:return False
            row=conn.execute('SELECT payload FROM azure_chronicle_grants ORDER BY rowid DESC LIMIT 1').fetchone()
            if row is None:return False
            grant=AzureGrant.model_validate_json(row[0])
            req=ChronicleRequest(engine=grant.engine or 'grf',match_id=grant.match_id or 'status',trace_hash=grant.trace_hash or '0'*64,locale=grant.locale or 'en')
            try:self._grant(conn,self.clock(),binding,owner,req)
            except AzureConflict:return False
            return True

    def busy(self):
        self._tick()
        with self._read() as conn:return bool(conn.execute("SELECT 1 FROM azure_chronicle_jobs WHERE state='running'").fetchone())

    def _tick(self):
        try:
            with self._transaction():pass
        except AzureClockRegression:
            # The failure was persisted. Ready output remains readable, never a new admission.
            pass
