"""Portable M1 envelopes. No server, native loader, or permission creation."""
from pathlib import Path
import zlib
from .physical_wire import canonical,digest,MAX_MANIFEST
from .shot_context_wire import (_json,keys,integer,_identity,MAX_RECORD,MAX_COMPRESSED,
    MAX_EXPANDED,MAX_ATTESTATION)

POLICY='m1-bounded-whistle-1'
MANIFEST='m1-actions-1'
ENGINE='grf-2.10.2-m1-bounded-1'
COUNTERS=('ticks','references','guards','downstream_changes','resets','invalid_inputs','setters','behavioral_changes')


def state_digest(signature):
    h=14695981039346656037
    for c in signature.encode('utf-8'):h=((h^c)*1099511628211)&((1<<64)-1)
    return '%016x'%h


def validate_close(receipt,request,row):
    keys(receipt,('version','reason','before','after'))
    if receipt['version']!='m1-period-close-1' or receipt['reason']!=request['reason']:
        raise ValueError('M1 close version/reason')
    names=('physics_ms','effective_ms','period','relocation_id','score','in_play','pending_penalty',
           'protected_restart','state_signature','state_digest')
    for f in (receipt['before'],receipt['after']):
        keys(f,names)
        for k in ('physics_ms','effective_ms','relocation_id'):integer(f[k])
        integer(f['period'],1,2)
        if type(f['score']) is not list or len(f['score'])!=2:raise ValueError('Close score')
        for n in f['score']:integer(n,0,100000)
        for k in ('in_play','pending_penalty','protected_restart'):
            if type(f[k]) is not bool:raise ValueError('Close boolean')
        if type(f['state_signature']) is not str or not 0<len(f['state_signature'].encode())<=MAX_RECORD:
            raise ValueError('Close state signature')
        if f['state_digest']!=dict(algorithm='fnv1a64',value=state_digest(f['state_signature'])):
            raise ValueError('Close diagnostic digest')
    before,after=receipt['before'],receipt['after']
    if before['protected_restart']!=(bool(row[9]) and int(row[10]) in (3,8)):
        raise ValueError('Close protected restart observation')
    if (after!=dict(before,in_play=False) or before['pending_penalty'] or
        (before['period'],before['physics_ms'])!=(request['period'],request['physics_ms']) or
        (before['physics_ms'],before['effective_ms'],before['period'],before['relocation_id'],before['score'],before['in_play'])!=
        (int(row[1]),int(row[4]),int(row[2]),int(row[19]),[int(row[15]),int(row[16])],bool(row[5]))):
        raise ValueError('Close observation/state mismatch')
    if request['reason']=='bounded_open_play':
        if not before['in_play'] or before['protected_restart']:raise ValueError('Unsafe open-play close')
    elif request['reason']=='natural_stoppage':
        if before['in_play']:raise ValueError('Unsafe natural close')
    else:raise ValueError('Close reason')
    return receipt


def policy_state(value,mode,*,initial=False):
    keys(value,('version','mode',*COUNTERS,'overflowed','enabled'))
    if value['version']!='m1-policy-counters-1' or value['mode']!=mode or value['overflowed'] is not False or value['enabled'] is not True:
        raise ValueError('Disabled/overflowed M1 policy')
    for k in COUNTERS:integer(value[k],0,2000000)
    if (value['invalid_inputs'] or value['guards']>value['references'] or value['downstream_changes']>value['behavioral_changes'] or
        value['behavioral_changes']>value['references'] or mode=='observe' and value['behavioral_changes'] or
        value['references']>3*value['ticks'] or value['setters']>14*value['ticks'] or
        initial and any(value[k] for k in COUNTERS if k!='resets')):
        raise ValueError('Invalid M1 full-run policy')
    return value


def write_exclusive(path,value,limit=MAX_MANIFEST):
    import os
    raw=canonical(value)
    if len(raw)>limit:raise ValueError('M1 metadata budget')
    with Path(path).open('xb') as stream:stream.write(raw);stream.flush();os.fsync(stream.fileno())


def write_context(path,identity,trace_hash,record):
    _identity(identity)
    if len(trace_hash)!=64:raise ValueError('Context trace hash')
    a=dict(identity=identity,trace_hash=trace_hash,record_sha256=digest(record))
    if len(canonical(a))>MAX_ATTESTATION:raise ValueError('Context attestation budget')
    raw=canonical(dict(attestation=a,record=record))
    if len(raw)>MAX_EXPANDED:raise ValueError('Context expanded budget')
    compressed=zlib.compress(raw)
    if len(compressed)>MAX_COMPRESSED:raise ValueError('Context compressed budget')
    with Path(path).open('xb') as stream:stream.write(compressed)


def read_context(path,identity,trace_hash):
    with Path(path).open('rb') as stream:compressed=stream.read(MAX_COMPRESSED+1)
    if len(compressed)>MAX_COMPRESSED:raise ValueError('Context compressed budget')
    try:
        d=zlib.decompressobj();raw=d.decompress(compressed,MAX_EXPANDED+1)
        if len(raw)>MAX_EXPANDED or d.unused_data or d.unconsumed_tail or not d.eof:raise ValueError('Context expanded/trailing budget')
    except zlib.error as e:raise ValueError('Context compression') from e
    envelope=_json(raw);keys(envelope,('attestation','record'));a=envelope['attestation']
    keys(a,('identity','trace_hash','record_sha256'));_identity(a['identity'])
    if len(canonical(a))>MAX_ATTESTATION or a!=dict(identity=identity,trace_hash=trace_hash,record_sha256=digest(envelope['record'])):
        raise ValueError('Context trace/source binding')
    return envelope['record']
