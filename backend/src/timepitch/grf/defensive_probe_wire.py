"""Portable, bounded research sidecar. No GRF or server imports.

JSONL header, independently deflated lossless cache frames, and a final trace
binding. Native sparse fields stay sparse; no target is recomputed here.
"""
import base64
import hashlib
import json
import math
import re
import struct
import zlib
from pathlib import Path
if __package__:
    from .physical_wire import canonical,digest,MAX_PHYSICS_MS,MAX_SAMPLES
else:
    from physical_wire import canonical,digest,MAX_PHYSICS_MS,MAX_SAMPLES

MAX_SIDECAR=8388608
MAX_FRAME=1024*1024
IDENTITY_KEYS={'input_hash','native_sha256','descriptor_sha256','build_manifest_sha256'}
STATUS={
    'strategy':{'not_evaluated','other_or_stopped','defense','midfield','offense','keeper'},
    'marking':{'not_evaluated','ineligible','applied','no_marker'},
    'hunt':{'not_evaluated','skipped_manual_or_stopped','designated_self','gated','forced_magnet','outside_top_two','override','guard_rejected'},
    'slide':{'not_evaluated','gated','proposed'},
}


def _keys(value,keys):
    if type(value) is not dict or set(value)!=set(keys):raise ValueError('Defense schema keys')


def _integer(value,lo,hi):
    if type(value) is not int or not lo<=value<=hi:raise ValueError('Defense integer bounds')


def _boolean(value):
    if type(value) is not bool:raise ValueError('Defense boolean required')


def _sha(value):
    if not isinstance(value,str) or re.fullmatch('[0-9a-f]{64}',value) is None:raise ValueError('Defense digest')


def _identity(value):
    _keys(value,IDENTITY_KEYS)
    for sha in value.values():_sha(sha)


def _windows(windows):
    if type(windows) is not list or not 1<=len(windows)<=3:raise ValueError('Defense windows')
    previous=-1;events=set()
    for w in windows:
        _keys(w,('event_seq','event_ms','start_ms','end_ms'))
        for key in ('start_ms','end_ms','event_ms'):_integer(w[key],0,MAX_PHYSICS_MS)
        _integer(w['event_seq'],0,100000)
        if not previous<w['start_ms']<=w['event_ms']<=w['end_ms'] or w['event_seq'] in events:
            raise ValueError('Defense window order')
        previous=w['end_ms'];events.add(w['event_seq'])


def in_window(t,windows):return next((w for w in windows if w['start_ms']<=t<=w['end_ms']),None)


def _number(v):
    if type(v) not in (int,float) or not math.isfinite(v) or abs(v)>1e100:raise ValueError('Defense finite scalar')


def _vector(v):
    if type(v) not in (list,tuple) or len(v)!=3:raise ValueError('Defense vector')
    for n in v:_number(n)


def _fields(f):
    _keys(f,('values','vectors','status','overflowed'))
    if f['overflowed'] is not False:raise ValueError('Native defense overflow')
    for key,limit in (('values',128),('vectors',32),('status',16)):
        if type(f[key]) is not dict or len(f[key])>limit:raise ValueError('Defense field capacity')
        for name,value in f[key].items():
            if not isinstance(name,str) or re.fullmatch('[a-z_0-9]{1,64}',name) is None:raise ValueError('Defense field name')
            if key=='values':_number(value)
            elif key=='vectors':_vector(value)
            elif name not in STATUS or value not in STATUS[name]:raise ValueError('Defense status')


def _empty_fields(f):return not any(f[k] for k in ('values','vectors','status'))


def _pack(records):
    # Keep every IEEE754 bit, including negative zero, without decimal expansion.
    # The marker cannot be a native status/field name admitted by _records.
    numbers=bytearray()
    def walk(v):
        if type(v) is float:numbers.extend(struct.pack('<d',v));return '$f64'
        if type(v) is dict:return {k:walk(v[k]) for k in sorted(v)}
        if type(v) in (list,tuple):return [walk(x) for x in v]
        return v
    skeleton=canonical(walk(records))
    return struct.pack('<I',len(skeleton))+skeleton+numbers


def _unpack(raw):
    if len(raw)<4:raise ValueError('Defense numeric frame header')
    size=struct.unpack('<I',raw[:4])[0]
    if size>len(raw)-4 or (len(raw)-size-4)%8:raise ValueError('Defense numeric frame length')
    skeleton=_json(raw[4:4+size]);offset=4+size
    def walk(v):
        nonlocal offset
        if v=='$f64':
            if offset+8>len(raw):raise ValueError('Defense numeric frame truncated')
            value=struct.unpack('<d',raw[offset:offset+8])[0];offset+=8;return value
        if type(v) is dict:return {k:walk(v[k]) for k in sorted(v)}
        if type(v) is list:return [walk(x) for x in v]
        return v
    result=walk(skeleton)
    if offset!=len(raw):raise ValueError('Defense unused numeric values')
    return result


def _selection(s,lo,t,*,selected=False,slide=False):
    _keys(s,('available','physics_ms','function','found','animation_before','animation_after','evaluation_sequence'))
    _boolean(s['available'])
    if not s['available']:
        if any(v is not None for k,v in s.items() if k!='available'):raise ValueError('Unavailable selection has values')
        return
    _integer(s['physics_ms'],lo,t);_integer(s['function'],0,255);_boolean(s['found'])
    for key in ('animation_before','animation_after'):_integer(s[key],0,2**32-1)
    if s['evaluation_sequence'] is not None:_integer(s['evaluation_sequence'],1,2**32-1)
    if slide and s['function']!=13:raise ValueError('Non-slide in slide cache')
    if selected and (not s['found'] or s['animation_before']==s['animation_after']):raise ValueError('Proposal is not selection')


def _records(records,t,window):
    if type(records) is not list or len(records)!=22:raise ValueError('All22 defense slots required')
    for i,r in enumerate(records):
        _keys(r,('team','slot','active','availability_reason','evaluation_available','evaluation_complete',
            'evaluation_ms','evaluation_sequence','fields','last_attempt','last_selected','slide_attempt','slide_selected',
            'slide_proposal','current_function','current_animation','current_mirrored','current_position','current_movement'))
        _integer(r['team'],0,1);_integer(r['slot'],0,10)
        if (r['team'],r['slot'])!=(i//11,i%11):raise ValueError('Defense slot order or duplicate')
        for key in ('active','evaluation_available','evaluation_complete','current_mirrored'):_boolean(r[key])
        reason='inactive' if not r['active'] else 'cached_evaluation' if r['evaluation_available'] else 'no_evaluation'
        if r['availability_reason']!=reason:raise ValueError('Defense availability reason')
        _fields(r['fields'])
        if r['evaluation_available']:
            _integer(r['evaluation_ms'],window['start_ms'],t);_integer(r['evaluation_sequence'],1,2**32-1)
            if set(r['fields']['status'])!=set(STATUS):raise ValueError('Missing stage status')
        elif (r['evaluation_ms'] is not None or r['evaluation_sequence'] is not None or r['evaluation_complete'] or
              r['fields']['status'] or set(r['fields']['values'])-{'queue_size','queue_movement_speed'} or
              set(r['fields']['vectors'])-{'queue_movement_direction'}):raise ValueError('Unavailable evaluation has tactical values')
        for key in ('last_attempt','last_selected','slide_attempt','slide_selected'):
            _selection(r[key],window['start_ms'],t,selected=key.endswith('selected'),slide=key.startswith('slide'))
        p=r['slide_proposal'];_keys(p,('available','physics_ms','evaluation_sequence','fields'));_boolean(p['available']);_fields(p['fields'])
        if p['available']:
            _integer(p['physics_ms'],window['start_ms'],t);_integer(p['evaluation_sequence'],1,2**32-1)
            if p['fields']['status'].get('slide')!='proposed':raise ValueError('Missing actual slide proposal')
        elif p['physics_ms'] is not None or p['evaluation_sequence'] is not None or not _empty_fields(p['fields']):
            raise ValueError('Unavailable proposal has values')
        if r['active']:
            _integer(r['current_function'],0,255);_integer(r['current_animation'],0,2**32-1)
            _vector(r['current_position']);_vector(r['current_movement'])
        elif any(r[k] is not None for k in ('current_function','current_animation','current_position','current_movement')):
            raise ValueError('Inactive motion must be unavailable')


class DefenseSidecarWriter:
    def __init__(self,path:Path,identity:dict,windows:list[dict]):
        _identity(identity);_windows(windows)
        self.path=Path(path);self.windows=windows;self.count=0;self.previous=(-1,-1);self.hashed=hashlib.sha256();self.size=0;self.failed=False
        self.stream=self.path.open('xb')
        try:self._write(dict(type='header',schema_version='grf-defense-sidecar-1',encoding='zlib-json-f64-b85-1',identity=identity,windows=windows))
        except BaseException:self.close();raise

    def _write(self,value):
        raw=canonical(value)+b'\n'
        if self.size+len(raw)>MAX_SIDECAR:raise ValueError('Defense sidecar budget')
        self.stream.write(raw);self.stream.flush();self.size+=len(raw)
        return raw

    def append(self,physics_ms:int,sample_index:int,records:list[dict])->None:
        if self.failed or self.stream.closed:raise ValueError('Defense writer already stopped')
        try:self._append(physics_ms,sample_index,records)
        except BaseException:
            self.failed=True;self.close();raise

    def _append(self,physics_ms,sample_index,records):
        _integer(physics_ms,0,MAX_PHYSICS_MS);_integer(sample_index,0,MAX_SAMPLES-1)
        w=in_window(physics_ms,self.windows)
        if w is None or physics_ms%100 or sample_index<=self.previous[1] or physics_ms<self.previous[0]:
            raise ValueError('Defense frame window or order')
        _records(records,physics_ms,w);raw=_pack(records)
        if len(raw)>MAX_FRAME:raise ValueError('Defense frame expansion budget')
        encoded=base64.b85encode(zlib.compress(raw)).decode('ascii')
        line=self._write(dict(type='frame',physics_ms=physics_ms,sample_index=sample_index,data=encoded))
        self.hashed.update(line);self.count+=1;self.previous=(physics_ms,sample_index)

    def finish(self,trace_hash:str)->dict:
        if self.failed or self.stream.closed:raise ValueError('Defense writer failed or closed')
        _sha(trace_hash)
        value=dict(type='final',trace_hash=trace_hash,frames=self.count,frames_sha256=self.hashed.hexdigest())
        try:self._write(value)
        finally:self.close()
        return value

    def close(self):self.stream.close()


def _json(raw):
    def pairs(items):
        d={}
        for k,v in items:
            if k in d:raise ValueError('Duplicate defense JSON key')
            d[k]=v
        return d
    return json.loads(raw,object_pairs_hook=pairs,parse_constant=lambda v:(_ for _ in ()).throw(ValueError('Nonfinite JSON')))


def _lines(path):
    path=Path(path)
    if path.stat().st_size>MAX_SIDECAR:raise ValueError('Defense sidecar budget')
    with path.open('rb') as stream:
        total=0
        while raw:=stream.readline(MAX_SIDECAR+1):
            total+=len(raw)
            if total>MAX_SIDECAR or not raw.endswith(b'\n'):raise ValueError('Defense truncated/oversized line')
            yield raw,_json(raw)


def _decode_frame(value):
    _keys(value,('type','physics_ms','sample_index','data'))
    compressed=base64.b85decode(value['data']);decoder=zlib.decompressobj()
    raw=decoder.decompress(compressed,MAX_FRAME+1)
    if len(raw)>MAX_FRAME or decoder.unconsumed_tail or decoder.unused_data or not decoder.eof:
        raise ValueError('Defense invalid/bounded frame compression')
    return dict(physics_ms=value['physics_ms'],sample_index=value['sample_index'],records=_unpack(raw))


def iter_defense_frames(path):
    """Use only after validation; iteration keeps at most one cache frame in memory."""
    for _,value in _lines(path):
        if value.get('type')=='frame':yield _decode_frame(value)


def _expected_frames(manifest,windows):
    half=manifest.periods[0].duration_ms
    if (half%100 or manifest.duration_ms%100 or len(manifest.periods)!=2 or
        sum(p.duration_ms for p in manifest.periods)!=manifest.duration_ms or
        not 0<half<manifest.duration_ms<=MAX_PHYSICS_MS or windows[-1]['end_ms']>manifest.duration_ms):
        raise ValueError('Defense period clock/window bounds')
    for t in range(0,manifest.duration_ms+1,100):
        if in_window(t,windows):
            yield t,t//100+int(t>half)
            if t==half:yield t,t//100+1


def validate_defense_sidecar(path:Path,*,manifest,descriptor:dict)->dict:
    lines=iter(_lines(path));first=next(lines,None)
    if first is None:raise ValueError('Empty defense sidecar')
    _,header=first
    _keys(header,('type','schema_version','encoding','identity','windows'))
    if (header['type']!='header' or header['schema_version']!='grf-defense-sidecar-1' or header['encoding']!='zlib-json-f64-b85-1' or
        header['identity']!=descriptor['identity'] or header['windows']!=descriptor['windows']):raise ValueError('Defense header binding')
    _identity(header['identity']);_windows(header['windows'])
    if (header['identity']['input_hash']!=manifest.input.input_hash or
        header['identity']['native_sha256']!=manifest.native_binary_sha256):raise ValueError('Defense manifest binding')
    expected=iter(_expected_frames(manifest,header['windows']));hashed=hashlib.sha256();count=0;final=None
    for raw,value in lines:
        if final is not None:raise ValueError('Defense data after final binding')
        if value.get('type')=='final':final=value;continue
        if value.get('type')!='frame':raise ValueError('Defense frame type')
        frame=_decode_frame(value);t=frame['physics_ms'];i=frame['sample_index']
        _integer(t,0,MAX_PHYSICS_MS);_integer(i,0,MAX_SAMPLES-1)
        if (t,i)!=next(expected,None):raise ValueError('Defense required window truncated or reordered')
        _records(frame['records'],t,in_window(t,header['windows']));hashed.update(raw);count+=1
    if final is None:raise ValueError('Missing defense final binding')
    _keys(final,('type','trace_hash','frames','frames_sha256'))
    if (next(expected,None) is not None or final['frames']!=count or final['frames_sha256']!=hashed.hexdigest() or
        final['trace_hash']!=manifest.trace_hash):raise ValueError('Defense final trace/coverage binding')
    return dict(frames=count,records=count*22,bytes=Path(path).stat().st_size,sha256=hashlib.sha256(Path(path).read_bytes()).hexdigest(),
        trace_hash=manifest.trace_hash,frames_sha256=hashed.hexdigest())
