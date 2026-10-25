"""Permanent bounded acceptance reservations; importing this never loads GRF."""
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import time

ROOT=Path(__file__).resolve().parents[2]
CASE_LIMITS={**{f'F{i}':60000 for i in range(1,5)},**{f'P{seed}-{kind}':300000 for seed in (42,43) for kind in ('control','actions')}}
CONTINUATION_LIMITS={**{f'F{i}-r2':60000 for i in range(1,4)},'F4':60000,
    **{f'P{seed}-{kind}':300000 for seed in (42,43) for kind in ('control','actions')}}


def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _atomic(path,value):
    temporary=path.with_suffix('.tmp')
    with temporary.open('w',encoding='utf-8',newline='\n') as stream:
        json.dump(value,stream,sort_keys=True);stream.flush();os.fsync(stream.fileno())
    os.replace(temporary,path)


@contextmanager
def _lock(path):
    path.parent.mkdir(parents=True,exist_ok=True);lock=path.with_suffix('.lock');deadline=time.monotonic()+5
    while True:
        try:stream=lock.open('x');break
        except FileExistsError:
            if time.monotonic()>=deadline:raise ValueError('Acceptance ledger locked; do not reset it')
            time.sleep(.01)
    try:yield
    finally:stream.close();lock.unlink()


def reserve_action_case(checkpoint,case_id,input_hash,native_sha256,*,identity='unit-test'):
    checkpoint=Path(checkpoint)
    with _lock(checkpoint):
        data=json.loads(checkpoint.read_text()) if checkpoint.exists() else dict(identity=identity,cases={})
        extension=data.get('extension')
        revised=extension is not None and extension['identity']==identity
        limits=CONTINUATION_LIMITS if revised else CASE_LIMITS
        if case_id not in limits:raise ValueError('Unapproved native case')
        if data['identity']!=identity and not revised:raise ValueError('Acceptance identity changed')
        existing=data['cases'].get(case_id)
        if existing:
            if existing.get('identity',data['identity'])!=identity:raise ValueError('Case belongs to another revision')
            if (existing['input_hash'],existing['native_sha256'])!=(input_hash,native_sha256):raise ValueError('Acceptance inputs changed')
            if existing['state']!='complete':raise ValueError('Attempt already consumed; no automatic retry')
            return existing['result']
        if extension and not revised:raise ValueError('Original acceptance retired; use its explicit continuation')
        if len(data['cases'])>=(11 if extension else 8) or sum(r['maximum_ms'] for r in data['cases'].values())+limits[case_id]>(1620000 if extension else 1440000):
            raise ValueError('Native acceptance budget exhausted')
        data['cases'][case_id]=dict(input_hash=input_hash,native_sha256=native_sha256,state='reserved',maximum_ms=limits[case_id],identity=identity)
        _atomic(checkpoint,data)
    return None


def extend_action_acceptance(checkpoint,previous_identity,new_identity,*,authorization):
    checkpoint=Path(checkpoint)
    if authorization!='user-hazlo-tp033-continuation' or not checkpoint.is_file():raise ValueError('Explicit original-ledger continuation required')
    with _lock(checkpoint):
        data=json.loads(checkpoint.read_text())
        if data['identity']!=previous_identity:raise ValueError('Wrong predecessor identity')
        proposed=dict(identity=new_identity,authorization=authorization,maximum_processes=11,maximum_physics_ms=1620000)
        if data.get('extension'):
            if data['extension']!=proposed:raise ValueError('Only one authorized continuation; do not renew budget')
            return
        if set(data['cases'])!={'F1','F2','F3'} or any(c['state']!='complete' or c['maximum_ms']!=60000 for c in data['cases'].values()):
            raise ValueError('Unexpected original attempts; preserve and investigate')
        data['extension']=proposed;_atomic(checkpoint,data)


def finish_action_case(checkpoint,case_id,state,result):
    if state not in ('complete','failed'):raise ValueError('Invalid attempt result')
    with _lock(Path(checkpoint)):
        data=json.loads(Path(checkpoint).read_text());entry=data['cases'][case_id]
        if entry['state']!='reserved':raise ValueError('Attempt already finished')
        entry.update(state=state,result=result);_atomic(Path(checkpoint),data)


def execute_reserved_case(checkpoint,case_id,input_hash,native_sha256,launch,*,identity='unit-test'):
    cached=reserve_action_case(checkpoint,case_id,input_hash,native_sha256,identity=identity)
    if cached is not None:return cached
    try:result=launch()
    except BaseException as error:
        finish_action_case(checkpoint,case_id,'failed',dict(error=type(error).__name__,detail=str(error)[-1000:]));raise
    finish_action_case(checkpoint,case_id,'complete',result);return result


def read_segment(path,request,*,native_sha256=None):
    import base64
    from timepitch.grf.physical_codec import decode_chunk,make_chunk_ref
    from timepitch.grf.action_codec import ActionStreamValidator
    from timepitch.grf.action_models import ActionInput,ACTION_NATIVE_SHA256
    validator=ActionStreamValidator(request,native_sha256 or ACTION_NATIVE_SHA256) if isinstance(request,ActionInput) else None
    blocks=[];segment=None;compressed=expanded=0
    with Path(path).open('rb') as stream:
        while line:=stream.readline(2*1024*1024):
            if not line.endswith(b'\n'):raise ValueError('Segment line limit')
            if segment is not None:raise ValueError('Output after segment')
            message=json.loads(line)
            if message.get('type')=='chunk' and set(message)=={'type','data'}:
                raw=base64.b64decode(message['data'],validate=True);block=decode_chunk(raw);ref=make_chunk_ref(block,raw)
                compressed+=len(raw);expanded+=ref.expanded_bytes
                if compressed>32*1024*1024 or expanded>256*1024*1024:raise ValueError('Segment byte budget')
                if block.index!=len(blocks):raise ValueError('Segment block order')
                if validator is not None:validator.append(block)
                blocks.append(block)
            elif message.get('type')=='segment':segment=message
            else:raise ValueError('Not a segment protocol')
    if not blocks or segment is None:raise ValueError('Incomplete segment evidence')
    # Deliberately no validator.finish: these are partial matches.
    return blocks,segment,dict(compressed_bytes=compressed,expanded_bytes=expanded,stream_bytes=Path(path).stat().st_size)


def run_action_case(case_id,work_dir):
    import subprocess
    from timepitch.grf.action_models import ActionInput
    from timepitch.grf.physical_models import ActivityInput
    from timepitch.grf.physical_resources import private_bytes
    frozen_path=ROOT/'research/engine-evaluation/2026-10-17-grf-actions/acceptance-r2.json'
    frozen=json.loads(frozen_path.read_text());case=frozen['cases'][case_id]
    canonical_work=ROOT/'.local/grf-action-work/acceptance'
    if Path(work_dir).resolve()!=canonical_work.resolve():raise ValueError('Use the canonical acceptance ledger, never a fresh budget directory')
    if set(frozen['cases'])!=set(CONTINUATION_LIMITS) or case['maximum_ms']!=CONTINUATION_LIMITS[case_id]:raise ValueError('Unapproved acceptance manifest')
    checkpoint=Path(work_dir)/'checkpoint.json'
    if not checkpoint.is_file() or json.loads(checkpoint.read_text()).get('extension',{}).get('identity')!=sha(frozen_path):
        raise ValueError('Original budget and registered continuation must exist before launch')
    for name,digest in frozen['files'].items():
        if sha(ROOT/name)!=digest:raise ValueError('Frozen acceptance file changed: '+name)
    payload=frozen['inputs'][case['input']]
    request=(ActionInput if case['kind']=='actions' else ActivityInput).model_validate(payload)
    directory=Path(work_dir)/case_id
    def launch():
        directory.mkdir(parents=True,exist_ok=True)
        out=directory/'stdout.jsonl';err=directory/'stderr.txt'
        env=os.environ.copy()
        for key in ('PYTHONPATH','PYTHONHOME','GFOOTBALL_DATA_DIR','GFOOTBALL_FONT'):env.pop(key,None)
        command=[str(ROOT/frozen['python']),'-X','utf8','-u',str(ROOT/frozen['fixture']),str(ROOT/case['native_dir'])]
        started=time.monotonic();peak=0;child=None
        try:
            with out.open('xb') as stdout,err.open('xb') as stderr:
                child=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=stdout,stderr=stderr,env=env,
                    creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
                child.stdin.write(json.dumps(dict(id=case_id,kind=case['kind'],input=payload,maximum_ms=case['maximum_ms'])).encode());child.stdin.close()
                while child.poll() is None:
                    peak=max(peak,private_bytes(child))
                    if peak>512*1024*1024 or out.stat().st_size>48*1024*1024 or err.stat().st_size>65536:raise ValueError('Native acceptance resource budget')
                    if time.monotonic()-started>600:raise TimeoutError('Native acceptance timeout')
                    time.sleep(.05)
            if child.returncode:raise ValueError('Native segment failed: '+err.read_text(encoding='utf-8',errors='replace')[-1500:])
            if out.stat().st_size>48*1024*1024 or err.stat().st_size>65536:raise ValueError('Native stream budget')
            blocks,segment,sizes=read_segment(out,request,native_sha256=frozen['files'][case['native_dir']+'/_gameplayfootball.pyd'])
            if segment['id']!=case_id or segment['physics_ms']!=case['maximum_ms']:raise ValueError('Native physical budget mismatch')
            if int(blocks[-1].samples[-1][1])!=segment['physics_ms']:raise ValueError('Segment time mismatch')
            return dict(segment=segment,**sizes,stdout_sha256=sha(out),peak_private_bytes=peak,wall_seconds=round(time.monotonic()-started,3))
        finally:
            if child is not None:
                from timepitch.grf.process import GrfProcess
                GrfProcess._stop(child)
                if child.stdin is not None:child.stdin.close()
    result=execute_reserved_case(checkpoint,case_id,request.input_hash,frozen['files'][case['native_dir']+'/_gameplayfootball.pyd'],launch,identity=sha(frozen_path))
    if sha(directory/'stdout.jsonl')!=result['stdout_sha256']:raise ValueError('Cached native evidence changed')
    return result
