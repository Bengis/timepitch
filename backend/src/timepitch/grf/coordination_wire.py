"""Portable bounded K1 observation wire. No Pydantic, server or football imports."""
import base64
import copy
import hashlib
import json
import math
import os
from pathlib import Path
import re
import zlib
if __package__:
    from .physical_wire import canonical,digest,MAX_PHYSICS_MS,MAX_SAMPLES,COLUMNS
    from .candidate_wire import normalize_state as base_state
else:
    from physical_wire import canonical,digest,MAX_PHYSICS_MS,MAX_SAMPLES,COLUMNS
    from candidate_wire import normalize_state as base_state

WINDOWS=((2149000,2159000),(4013000,4023000),(4556000,4566000))
MAX_FRAMES=303
MAX_TRANSACTIONS=400
MAX_RECORD=65536
MAX_POLICY_BYTES=8192
MAX_SIDECAR=8*1024*1024
MAX_EXPANDED=32*1024*1024
VERSION='k1-coordination-1'
COUNTERS=('assignments','holds','handovers','handover_rejections','cover_requested','cover_exposed',
    'cover_unavailable','overrides','invariant_violations','movement_requests','selected_commands')
CAPS=dict(frames=MAX_FRAMES,transactions=MAX_TRANSACTIONS,record=MAX_RECORD,compressed=MAX_SIDECAR,expanded=MAX_EXPANDED,policy=MAX_POLICY_BYTES)
BASE_SPEC=dict(policy_version='c4-marking-1',policy=dict(marking_floor=.85,threat_radius_m=30.,own_area_duel_floor=.70))


def window(ms):return next((i for i,(a,b) in enumerate(WINDOWS) if a<=ms<=b),None)
def keys(v,expected,reason):
    if type(v) is not dict or set(v)!=set(expected):raise ValueError(reason+' schema')
def integer(v,lo=0,hi=2**63-1,reason='integer'):
    if type(v) is not int or not lo<=v<=hi:raise ValueError(reason+' bounds')
def boolean(v):
    if type(v) is not bool:raise ValueError('boolean required')
def finite(v):
    if type(v) not in (int,float) or not math.isfinite(v):raise ValueError('finite scalar required')
def point(v):
    if type(v) not in (tuple,list) or len(v)!=2:raise ValueError('point shape')
    for n in v:finite(n)
def sha(v):
    if type(v) is not str or re.fullmatch('[a-f0-9]{64}',v) is None:raise ValueError('digest identity')
def identity(value,mode):
    keys(value,('run_id','input_hash','native_sha256','profile_identity','build_manifest_sha256'),'identity')
    if not re.fullmatch(r'K-observe-42|k1/(calibration/0[1-8]|heldout/(0[1-9]|1[0-9]|2[0-4]))',value['run_id']):raise ValueError('run identity')
    if mode!=('observe' if value['run_id']=='K-observe-42' else 'apply'):raise ValueError('mode identity')
    for k in value:
        if k!='run_id':sha(value[k])
def _pairs(pairs):
    result={}
    if type(pairs) is not list or len(pairs)>3:raise ValueError('ownership cardinality')
    for m in pairs:
        keys(m,('owner','target','committed_ms'),'ownership')
        for k in m:integer(m[k],reason='ownership')
        if m['owner'] in result or m['target'] in result.values():raise ValueError('ownership duplicate')
        result[m['owner']]=m['target']
    return result
def state(s):
    keys(s,('time_ms','assignment_ms','period','team','dynamic_side','valid','marks','cover_id','cover_target','hunts',
        'degraded_since_ms','last_override_player','last_override_ms','last_override_kind'),'state')
    for k in ('time_ms','assignment_ms','degraded_since_ms','last_override_ms'):integer(s[k],-1,MAX_PHYSICS_MS,'state')
    integer(s['period'],0,2,'state');integer(s['team'],-1,1,'state');integer(s['dynamic_side'],-1,1,'state')
    if s['valid'] is not True:raise ValueError('state invalid')
    integer(s['cover_id'],-1,2**31-1,'state');integer(s['last_override_player'],-1,2**31-1,'state');point(s['cover_target'])
    owners=_pairs(s['marks'])
    if type(s['hunts']) is not list or len(s['hunts'])>2 or len(set(s['hunts']))!=len(s['hunts']):raise ValueError('state hunts')
    for id in s['hunts']:integer(id,0,2**31-1,'state')
    roles=list(owners)+s['hunts']+([s['cover_id']] if s['cover_id']>=0 else [])
    if len(set(roles))!=len(roles) or s['assignment_ms']>s['time_ms'] or any(m['committed_ms']>s['time_ms'] for m in s['marks']):raise ValueError('state ownership/time')
    if s['time_ms']==-1 and (roles or s['period']!=0 or s['team']!=-1):raise ValueError('state initial')
    if s['time_ms']>=0 and (s['period'] not in (1,2) or s['team'] not in (0,1) or s['dynamic_side'] not in (-1,1)):raise ValueError('state epoch')
    if s['last_override_kind'] not in ('none','manual','ball_contest'):raise ValueError('state override')


def native_input(x):
    keys(x,('time_ms','period','team','dynamic_side','assignment_tick','play_eligible','defending','ball_100ms','players','threat_ids','quality'),'input')
    integer(x['time_ms'],0,MAX_PHYSICS_MS,'clock');integer(x['period'],1,2);integer(x['team'],0,1)
    if x['dynamic_side'] not in (-1,1):raise ValueError('mirror input')
    for k in ('assignment_tick','play_eligible','defending'):boolean(x[k])
    point(x['ball_100ms']);players={}
    if type(x['players']) is not list or not 1<=len(x['players'])<=22:raise ValueError('input actors')
    for p in x['players']:
        keys(p,('id','team','active','keeper','hunt_eligible','manual','ball_contest','position','formation'),'input player')
        integer(p['id'],0,2**31-1);integer(p['team'],0,1)
        if p['id'] in players:raise ValueError('input duplicate actor')
        players[p['id']]=p;point(p['position'])
        for k in ('active','keeper','hunt_eligible','manual','ball_contest'):boolean(p[k])
        if p['formation'] is not None:point(p['formation'])
        if p['team']==x['team'] and p['active'] and not p['keeper'] and p['formation'] is None:raise ValueError('input native formation absent')
    threats=x['threat_ids'];q=x['quality'];own=[p for p in players.values() if p['team']==x['team']]
    if type(threats) is not list or len(threats)>3 or len(set(threats))!=len(threats):raise ValueError('input threats')
    if any(id not in players or players[id]['team']==x['team'] for id in threats):raise ValueError('input threat identity')
    if len(own)>11 or type(q) is not list or len(q)!=len(own):raise ValueError('input Q rows')
    for r in q:
        if type(r) is not list or len(r)!=len(threats):raise ValueError('input Q columns')
        for v in r:
            finite(v)
            if not 0<=v<=1:raise ValueError('input Q range')
    return players


def _json(raw):
    def pairs(items):
        out={}
        for k,v in items:
            if k in out:raise ValueError('duplicate JSON key')
            out[k]=v
        return out
    try:return json.loads(raw,object_pairs_hook=pairs,parse_int=lambda token:-0.0 if token=='-0' else int(token),
        parse_constant=lambda _:(_ for _ in ()).throw(ValueError('finite JSON required')))
    except (TypeError,UnicodeError,json.JSONDecodeError,RecursionError) as e:raise ValueError('corrupted JSON') from e


class FrameValidator:
    def __init__(self,mode):self.mode=mode;self.frames=0;self.transactions=0;self.previous_index=-1;self.last_ms=-1;self.last_relocation=0;self.current_window=None;self.states=None
    def accept(self,value):
        keys(value,('sample','native','transactions'),'frame')
        sample=value['sample'];f=value['native'];txs=value['transactions']
        keys(sample,('index','physics_ms','period','relocation_id','attack_direction','sha256'),'sample');sha(sample['sha256'])
        integer(sample['index'],0,MAX_SAMPLES-1);integer(sample['physics_ms'],0,MAX_PHYSICS_MS)
        integer(sample['period'],1,2);integer(sample['relocation_id'],0,MAX_SAMPLES)
        if sample['attack_direction'] not in ([1,-1],[-1,1]):raise ValueError('mirror sample')
        ms=sample['physics_ms'];w=window(ms)
        keys(f,('physics_ms','period','relocation_id','window','states','state_mirror_signs','lineage'),'native frame')
        for key in ('physics_ms','period','relocation_id','window'):integer(f[key],reason='clock')
        if w is None or f['window']!=w:raise ValueError('window identity')
        if (f['physics_ms'],f['period'],f['relocation_id'])!=(ms,sample['period'],sample['relocation_id']):raise ValueError('clock sample identity')
        if sample['index']<=self.previous_index or ms<self.last_ms:raise ValueError('clock ordering')
        if type(f['states']) is not list or len(f['states'])!=2 or type(f['state_mirror_signs']) is not list or len(f['state_mirror_signs'])!=2:raise ValueError('state shape')
        for team,s in enumerate(f['states']):
            state(s)
            if s['time_ms']>ms or s['time_ms']>=0 and s['team']!=team:raise ValueError('state clock/actor')
            sign=f['state_mirror_signs'][team]
            if sign not in (-1,0,1) or s['time_ms']>=0 and sign==0:raise ValueError('mirror state')
            if s['time_ms']>=0 and s['period']==sample['period'] and s['dynamic_side']*sign!=-sample['attack_direction'][team]:raise ValueError('mirror state/sample')
        if type(txs) is not list:raise ValueError('transaction array')
        if w!=self.current_window:
            if ms!=WINDOWS[w][0] or txs:raise ValueError('initial window state required before transactions')
            self.states=copy.deepcopy(f['states']);self.current_window=w
        for tx in txs:self.transaction(tx,sample)
        if self.states!=f['states']:raise ValueError('state continuity at sample')
        lineage=f['lineage']
        if type(lineage) is not list or len(lineage)>22:raise ValueError('lineage bound')
        seen=set()
        for m in lineage:
            keys(m,('player','request_seq','request_ms','selection_ms','requested_target','position_at_request','cover_requested','command_index',
                'requested_function','animation_before','selected_animation','selected','mirror_sign','movement_requested'),'lineage')
            integer(m['player'],0,2**31-1);integer(m['request_seq'],1);integer(m['request_ms'],0,ms);integer(m['selection_ms'],-1,ms)
            if m['player'] in seen:raise ValueError('lineage actor duplicate')
            seen.add(m['player']);boolean(m['movement_requested']);boolean(m['cover_requested']);boolean(m['selected'])
            if m['movement_requested']:point(m['position_at_request'])
            elif m['position_at_request'] is not None or m['cover_requested']:raise ValueError('Unobserved movement position must be null')
            if m['mirror_sign'] not in (-1,1):raise ValueError('mirror lineage')
            if m['cover_requested']:point(m['requested_target'])
            elif m['requested_target'] is not None:raise ValueError('unavailable movement target must be null')
            for k in ('command_index','requested_function'):integer(m[k],-1,1024)
            for k in ('animation_before','selected_animation'):integer(m[k])
            if m['selection_ms']>=0 and m['selection_ms']<m['request_ms']:raise ValueError('lineage selection before request')
        self.frames+=1;self.previous_index=sample['index'];self.last_ms=ms;self.last_relocation=sample['relocation_id']
        if self.frames>MAX_FRAMES:raise ValueError('frame count bound')
    def transaction(self,tx,sample):
        if len(canonical(tx))>MAX_RECORD:raise ValueError('record expanded bound')
        common={'type','physics_ms','period','team','dynamic_side','relocation_id','prior_state','applied','mirror_sign'}
        kind=tx.get('type')
        extra={'assignment':{'actual_prior_marks','input','decision'},'override':{'state','player','kind'},'context':{'state','eligible'}}
        if kind not in extra:raise ValueError('transaction type')
        keys(tx,common|extra[kind],'transaction')
        team=tx['team'];integer(team,0,1);t=tx['physics_ms'];integer(t,0,MAX_PHYSICS_MS,'clock')
        if not WINDOWS[self.current_window][0]<=t<WINDOWS[self.current_window][1] or not self.last_ms<=t<=sample['physics_ms']:raise ValueError('clock transaction window')
        integer(tx['relocation_id'],0,MAX_SAMPLES,'clock')
        if tx['period']!=sample['period'] or not self.last_relocation<=tx['relocation_id']<=sample['relocation_id']:raise ValueError('clock transaction epoch')
        if tx['mirror_sign'] not in (-1,1) or tx['dynamic_side']*tx['mirror_sign']!=-sample['attack_direction'][team]:raise ValueError('mirror transaction')
        if tx['applied'] is not (self.mode=='apply'):raise ValueError('mode transaction')
        if tx['prior_state']!=self.states[team]:raise ValueError('continuity prior state')
        state(tx['prior_state'])
        if kind=='assignment':
            x=tx['input'];players=native_input(x)
            if (x['time_ms'],x['period'],x['team'],x['dynamic_side'])!=(t,tx['period'],team,tx['dynamic_side']):raise ValueError('clock input/transaction')
            d=tx['decision'];keys(d,('valid','version','objective','marks','cover','hunts','reasons','state'),'decision')
            if d['valid'] is not True or d['version']!=VERSION:raise ValueError('decision policy')
            finite(d['objective']);marks=_pairs(d['marks'])
            for owner,target in marks.items():
                if owner not in players or target not in players or players[owner]['team']!=team or players[target]['team']==team or players[owner]['keeper']:raise ValueError('ownership actor')
            if d['cover'] is not None:
                keys(d['cover'],('id','target'),'cover');point(d['cover']['target'])
            if type(d['reasons']) is not list or any(type(r) is not str or len(r)>64 for r in d['reasons']):raise ValueError('decision reasons')
            next_state=d['state'];state(next_state)
            if (next_state['time_ms'],next_state['period'],next_state['team'],next_state['dynamic_side'])!=(t,tx['period'],team,tx['dynamic_side']):raise ValueError('state decision clock')
            if next_state['marks']!=d['marks'] or next_state['hunts']!=d['hunts'] or (d['cover'] is None)!=(next_state['cover_id']<0):raise ValueError('state decision responsibility')
            if d['cover'] is not None and (next_state['cover_id'],next_state['cover_target'])!=(d['cover']['id'],d['cover']['target']):raise ValueError('state cover target')
            if type(tx['actual_prior_marks']) is not list or len(tx['actual_prior_marks'])>11:raise ValueError('observed ownership bound')
            seen=set()
            for mark in tx['actual_prior_marks']:
                keys(mark,('owner','target'),'observed ownership')
                if mark['owner'] not in players or mark['target'] not in players or mark['owner'] in seen:raise ValueError('observed ownership identity')
                seen.add(mark['owner'])
        else:
            next_state=tx['state'];state(next_state)
            if next_state['time_ms']!=t:raise ValueError('state event clock')
            if kind=='override':
                integer(tx['player'],0,2**31-1)
                if tx['kind'] not in ('manual','ball_contest'):raise ValueError('override kind')
            else:boolean(tx['eligible'])
        self.states[team]=copy.deepcopy(next_state);self.transactions+=1
        if self.transactions>MAX_TRANSACTIONS:raise ValueError('transaction count bound')


class CoordinationWriter:
    def __init__(self,path,expected,mode):
        identity(expected,mode);self.path=Path(path);self.identity=copy.deepcopy(expected);self.mode=mode
        self.validator=FrameValidator(mode);self.hashed=hashlib.sha256();self.expanded=0;self.closed=False
        header=dict(type='header',schema_version='grf-coordination-sidecar-1',identity=expected,mode=mode,windows=WINDOWS,caps=CAPS)
        with self.path.open('xb') as f:f.write(canonical(header)+b'\n');f.flush();os.fsync(f.fileno())
    def _write(self,value):
        raw=canonical(value)+b'\n'
        if self.path.stat().st_size+len(raw)>MAX_SIDECAR:raise ValueError('sidecar compressed bound')
        with self.path.open('ab') as f:f.write(raw);f.flush();os.fsync(f.fileno())
    def append(self,row,native,transactions):
        if self.closed:raise ValueError('sidecar already final')
        ms=int(row[1])
        if window(ms) is None:
            if native or transactions:raise ValueError('unexpected outside-window native data')
            return
        if not native:raise ValueError('initial/native window frame missing')
        if len(row)!=len(COLUMNS):raise ValueError('sample width')
        if any(type(x) in (int,float) and not math.isfinite(x) for x in row):raise ValueError('finite sample')
        # Round-trip preserves native JSON values and normalizes tuple containers.
        try:value=_json(canonical(dict(sample=dict(index=int(row[0]),physics_ms=ms,period=int(row[2]),relocation_id=int(row[19]),
            attack_direction=[int(row[17]),int(row[18])],sha256=digest(row)),native=native,transactions=transactions)))
        except ValueError as e:raise ValueError('finite native record required') from e
        raw=canonical(value)
        if len(raw)>MAX_RECORD:raise ValueError('record expanded bound')
        self.validator.accept(value);self.expanded+=len(raw)
        if self.expanded>MAX_EXPANDED:raise ValueError('sidecar expanded bound')
        self.hashed.update(raw);self._write(dict(type='frame',sequence=self.validator.frames-1,data=base64.b85encode(zlib.compress(raw)).decode()))
    def finish(self,trace_hash):
        if self.closed:raise ValueError('sidecar already final')
        sha(trace_hash);self._write(dict(type='final',trace_hash=trace_hash,frames=self.validator.frames,
            transactions=self.validator.transactions,frames_sha256=self.hashed.hexdigest()));self.closed=True


def _lines(path):
    path=Path(path)
    if path.stat().st_size>MAX_SIDECAR:raise ValueError('sidecar compressed bound')
    with path.open('rb') as f:
        while raw:=f.readline(100000):
            if not raw.endswith(b'\n'):raise ValueError('sidecar truncated/record bound')
            yield _json(raw)
def _decode(envelope):
    keys(envelope,('type','sequence','data'),'frame envelope')
    try:
        compressed=base64.b85decode(envelope['data']);d=zlib.decompressobj();raw=d.decompress(compressed,MAX_RECORD+1)
        if len(raw)>MAX_RECORD or not d.eof or d.unconsumed_tail or d.unused_data:raise ValueError('record compressed/expanded bound')
        return raw,_json(raw)
    except (zlib.error,TypeError,UnicodeError,ValueError) as e:raise ValueError('corrupted or oversize record') from e
def iter_coordination_frames(path):
    for value in _lines(path):
        if value.get('type')=='frame':yield _decode(value)[1]
def validate_coordination_sidecar(path,expected,mode,trace_hash,*,expected_rows):
    identity(expected,mode);sha(trace_hash);lines=iter(_lines(path));header=next(lines,None)
    if header is None:raise ValueError('empty sidecar')
    keys(header,('type','schema_version','identity','mode','windows','caps'),'header')
    if header!=dict(type='header',schema_version='grf-coordination-sidecar-1',identity=expected,mode=mode,windows=[list(x) for x in WINDOWS],caps=CAPS):raise ValueError('header identity/mode/caps')
    checker=FrameValidator(mode);hashed=hashlib.sha256();expanded=0;final=None
    expected_iter=iter(row for row in expected_rows if window(int(row[1])) is not None)
    for envelope in lines:
        if final is not None:raise ValueError('data after final')
        if envelope.get('type')=='final':final=envelope;continue
        if envelope.get('type')!='frame' or envelope.get('sequence')!=checker.frames:raise ValueError('frame sequence')
        raw,value=_decode(envelope);expanded+=len(raw)
        if expanded>MAX_EXPANDED:raise ValueError('sidecar expanded bound')
        row=next(expected_iter,None)
        if row is None or value['sample']['sha256']!=digest(row):raise ValueError('replay sample identity')
        if (value['sample']['index'],value['sample']['physics_ms'],value['sample']['period'],value['sample']['relocation_id'])!=tuple(int(row[i]) for i in (0,1,2,19)):raise ValueError('replay clock identity')
        if value['sample']['attack_direction']!=[int(row[17]),int(row[18])]:raise ValueError('replay mirror identity')
        checker.accept(value);hashed.update(canonical(value))
    if final is None:raise ValueError('missing final/prefix interruption')
    keys(final,('type','trace_hash','frames','transactions','frames_sha256'),'final')
    if next(expected_iter,None) is not None or final!=dict(type='final',trace_hash=trace_hash,frames=checker.frames,
        transactions=checker.transactions,frames_sha256=hashed.hexdigest()):raise ValueError('final trace/coverage identity')
    return dict(frames=checker.frames,transactions=checker.transactions,sha256=hashlib.sha256(Path(path).read_bytes()).hexdigest(),
        bytes=Path(path).stat().st_size,expanded_bytes=expanded,trace_hash=trace_hash)


def coordination_state(value,mode,*,initial=False):
    keys(value,('version','mode','overflowed','counters'),'coordination counters')
    if value['version']!=VERSION or value['mode']!=mode or value['overflowed'] is not False:raise ValueError('coordination state mode/overflow')
    c=value['counters'];keys(c,COUNTERS,'coordination counters')
    for v in c.values():integer(v)
    if c['invariant_violations'] or initial and any(c.values()) or c['cover_requested']>c['assignments'] or c['holds']+c['handovers']>3*c['assignments']:raise ValueError('coordination counter invariant')
    return copy.deepcopy(value)
def policy_value(expected,mode,trace_hash,base_start,base_final,coord_start,coord_final):
    identity(expected,mode);sha(trace_hash)
    return dict(schema_version='grf-coordination-policy-1',identity=expected,mode=mode,trace_hash=trace_hash,
        base_start=base_state(base_start,BASE_SPEC,initial=True),base_final=base_state(base_final,BASE_SPEC),
        coordination_start=coordination_state(coord_start,mode,initial=True),coordination_final=coordination_state(coord_final,mode))
def read_coordination_policy(path,expected,mode,trace_hash):
    with Path(path).open('rb') as f:raw=f.read(MAX_POLICY_BYTES+1)
    if len(raw)>MAX_POLICY_BYTES:raise ValueError('policy exceeds8KiB')
    return validate_coordination_policy(_json(raw),expected,mode,trace_hash)
def validate_coordination_policy(value,expected,mode,trace_hash):
    if len(canonical(value))>MAX_POLICY_BYTES:raise ValueError('policy exceeds8KiB')
    keys(value,('schema_version','identity','mode','trace_hash','base_start','base_final','coordination_start','coordination_final'),'policy')
    if value['schema_version']!='grf-coordination-policy-1' or value['identity']!=expected or value['mode']!=mode or value['trace_hash']!=trace_hash:raise ValueError('policy identity')
    identity(expected,mode)
    for key in ('base_start','base_final'):
        s=value[key];normalized=base_state(dict(policy_version=s['policy_version'],**s['constants'],**s['counters']),BASE_SPEC,initial=key=='base_start')
        if s!=normalized:raise ValueError('base policy attestation changed')
    coordination_state(value['coordination_start'],mode,initial=True);coordination_state(value['coordination_final'],mode)
    return value
def write_coordination_policy(path,value):
    raw=canonical(value)
    if len(raw)>MAX_POLICY_BYTES:raise ValueError('policy exceeds8KiB')
    with Path(path).open('xb') as f:f.write(raw);f.flush();os.fsync(f.fileno())
