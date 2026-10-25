"""Portable fixed policy attestation. No server, Pydantic or football imports."""
import copy
import hashlib
import json
import math
import os
from pathlib import Path
import re
import struct
if __package__:
    from .physical_wire import canonical,digest
else:
    from physical_wire import canonical,digest

ATTRIBUTES=('physical_velocity','technical_shot','technical_shortpass')
COUNTERS=('marking_eligible','marking_raised','area_slide_eligible','area_slide_rejected','invalid_inputs')
MAX_POLICY_BYTES=8192


def normalize_payload(payload):
    result=copy.deepcopy(payload)
    for player in result['players']:
        if set(player['attributes'])!=set(ATTRIBUTES):raise ValueError('Three fixed attributes required')
        player['attributes']={name:player['attributes'][name] for name in ATTRIBUTES}
    return result


def float_bits(value):
    if type(value) not in (int,float) or not math.isfinite(value):raise ValueError('Finite compiled float required')
    try:return struct.unpack('<I',struct.pack('<f',value))[0]
    except (OverflowError,struct.error) as error:raise ValueError('Invalid compiled float') from error


def normalize_state(state,spec,*,initial=False):
    version=spec['policy_version'];policy=spec['policy']
    fixed={'c4-marking-1':.70,'c5-marking-area-risk-1':.90}
    if version not in fixed or policy!=dict(marking_floor=.85,threat_radius_m=30.,own_area_duel_floor=fixed[version]):
        raise ValueError('Unapproved policy constants')
    if set(state)!={'policy_version',*policy,*COUNTERS} or state['policy_version']!=version:
        raise ValueError('Native policy shape/version')
    bits={name:float_bits(state[name]) for name in policy}
    if bits!={name:float_bits(value) for name,value in policy.items()}:raise ValueError('Native policy float32 bits')
    counters={name:state[name] for name in COUNTERS}
    if any(type(v) is not int or not 0<=v<2**63 for v in counters.values()):raise ValueError('Invalid native counter')
    if (counters['invalid_inputs'] or counters['marking_raised']>counters['marking_eligible'] or
        counters['area_slide_rejected']>counters['area_slide_eligible'] or
        version=='c4-marking-1' and counters['area_slide_rejected'] or initial and any(counters.values())):
        raise ValueError('Invalid native policy state')
    return dict(policy_version=version,constants={name:state[name] for name in policy},float32_bits=bits,counters=counters)


def _identity(identity,trace_hash):
    if set(identity)!={'run_id','input_hash','native_sha256','profile_identity','build_manifest_sha256'}:
        raise ValueError('Policy identity shape')
    run=identity['run_id']
    if not isinstance(run,str) or not re.fullmatch(r'(c[45]/calibration/0[1-8]|selected/heldout/(0[1-9]|1[0-9]|2[0-4]))',run):
        raise ValueError('Policy run identity')
    for value in [trace_hash,*(v for k,v in identity.items() if k!='run_id')]:
        if not isinstance(value,str) or re.fullmatch('[0-9a-f]{64}',value) is None:raise ValueError('Policy digest identity')


def validate_policy(value,identity,spec,trace_hash):
    _identity(identity,trace_hash)
    if (set(value)!={'schema_version','identity','trace_hash','start','final'} or
        value['schema_version']!='grf-candidate-policy-1' or value['identity']!=identity or value['trace_hash']!=trace_hash):
        raise ValueError('Unbound native policy')
    states=[]
    for key in ('start','final'):
        record=value[key]
        if set(record)!={'policy_version','constants','float32_bits','counters'}:raise ValueError('Policy state shape')
        normalized=normalize_state(dict(policy_version=record['policy_version'],**record['constants'],**record['counters']),spec,initial=key=='start')
        if normalized!=record:raise ValueError('Policy bit/counter attestation changed')
        states.append(normalized)
    if any(states[1]['counters'][k]<states[0]['counters'][k] for k in COUNTERS):raise ValueError('Counters decreased')
    return value


def write_policy(path,identity,spec,start,final,trace_hash):
    value=dict(schema_version='grf-candidate-policy-1',identity=identity,trace_hash=trace_hash,
        start=normalize_state(start,spec,initial=True),final=normalize_state(final,spec))
    validate_policy(value,identity,spec,trace_hash)
    raw=canonical(value)
    if len(raw)>MAX_POLICY_BYTES:raise ValueError('Policy file exceeds8KiB')
    path=Path(path);temporary=path.with_suffix('.tmp')
    with temporary.open('xb') as stream:stream.write(raw);stream.flush();os.fsync(stream.fileno())
    os.replace(temporary,path)
    return value


def read_policy(path,identity,spec,trace_hash):
    try:
        with Path(path).open('rb') as stream:raw=stream.read(MAX_POLICY_BYTES+1)
        if len(raw)>MAX_POLICY_BYTES:raise ValueError('Policy file exceeds8KiB')
        value=json.loads(raw)
        return validate_policy(value,identity,spec,trace_hash)
    except (OSError,KeyError,TypeError,OverflowError) as error:raise ValueError('Missing or invalid native policy') from error
