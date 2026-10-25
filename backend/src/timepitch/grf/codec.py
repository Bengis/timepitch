"""Canonical hashing and independent validation of experimental outputs."""
import hashlib
import json
from pydantic import TypeAdapter
from .models import GrfInput, GrfReplay, GrfRecord, GrfFullMatchReplay,GrfStatisticsReplay, NATIVE_SHA256, MATCH_NATIVE_SHA256,STATS_NATIVE_SHA256
from .runtime_layout import LINUX_STATS_SHA256
from .native_json import MAX_BYTES

RECORD=TypeAdapter(GrfRecord)
from .match_rules import full_time_opportunity

ATTRIBUTES = {'physical_velocity', 'technical_shot', 'technical_shortpass'}
ROLES = {'GK':'GK', 'DEF':'CB', 'MID':'CM', 'FWD':'CF'}


def _json(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False).encode('utf-8')


def grf_input_hash(request: GrfInput) -> str:
    return hashlib.sha256(_json(request.model_dump(mode='json', exclude={'input_hash'}))).hexdigest()


def grf_hash(replay: GrfReplay) -> str:
    return hashlib.sha256(_json(replay.model_dump(mode='json', exclude={'trace_hash'}))).hexdigest()


def encode_grf(replay: GrfReplay) -> bytes:
    raw = _json(replay.model_dump(mode='json'))
    if len(raw)>MAX_BYTES: raise ValueError('GRF replay exceeds size budget')
    return raw


def _unique(pairs):
    result={}
    for key,value in pairs:
        if key in result: raise ValueError('Duplicate JSON key')
        result[key]=value
    return result


def parse_grf(raw: bytes, expected: GrfInput | None = None) -> GrfReplay:
    if len(raw)>MAX_BYTES: raise ValueError('GRF replay exceeds size budget')
    try:
        data=json.loads(raw, object_pairs_hook=_unique,
                        parse_constant=lambda value: (_ for _ in ()).throw(ValueError('Nonfinite JSON')))
        record=RECORD.validate_python(data)
        validate_grf(record, expected or record.input)
        return record
    except (RecursionError, OverflowError, UnicodeError) as error:
        raise ValueError('Invalid GRF JSON') from error


def validate_grf(record: GrfReplay, expected: GrfInput) -> None:
    request=record.input
    if request != expected or request.input_hash != grf_input_hash(request):
        raise ValueError('GRF input differs from requested catalogue configuration')
    full=isinstance(record,GrfFullMatchReplay)
    natives={STATS_NATIVE_SHA256,LINUX_STATS_SHA256} if isinstance(record,GrfStatisticsReplay) else {MATCH_NATIVE_SHA256 if full else NATIVE_SHA256}
    if record.native_binary_sha256 not in natives or record.trace_hash != grf_hash(record):
        raise ValueError('GRF binary or trace integrity mismatch')
    if request.config.home_tactic!='balanced' or request.config.away_tactic!='balanced':
        raise ValueError('Unsupported GRF tactics')
    if len({p.id for p in request.players})!=22: raise ValueError('Duplicate actor')
    for side,start in (('home',0),('away',11)):
        for slot,p in enumerate(request.players[start:start+11]):
            if (p.side!=side or p.slot!=slot or p.id!=f'{side}:{p.source_key}' or
                    p.source_key!=getattr(request.config,side+'_players')[slot] or
                    p.native_role!=ROLES[p.role] or set(p.attributes)!=ATTRIBUTES or set(p.provenance)!=ATTRIBUTES):
                raise ValueError('Invalid actor identity, role or attributes')
        if len(set(getattr(request.config,side+'_players')))!=11: raise ValueError('Duplicate selected player')
    readbacks={}
    for value in record.attribute_readbacks:
        key=(value.side,value.slot,value.attribute)
        if key in readbacks: raise ValueError('Duplicate readback')
        readbacks[key]=value.base
    for p in request.players:
        for name,value in p.attributes.items():
            if abs(readbacks.get((p.side,p.slot,name),-1)-value)>1e-5:
                raise ValueError('Native attribute readback mismatch')
    if record.duration_ms!=(len(record.samples)-1)*100: raise ValueError('Incorrect observation duration')
    if record.samples[0].engine_step!=-1 or (not full and record.samples[-1].engine_step!=3000) or record.samples[0].score!=(0,0):
        raise ValueError('Incomplete native episode')
    previous=None
    for index,sample in enumerate(record.samples):
        if sample.index!=index: raise ValueError('Invalid observation order')
        if (sample.owner_team==-1)!=(sample.owner_slot==-1): raise ValueError('Invalid ball owner')
        if previous and (sample.engine_step<=previous.engine_step or any(a<b for a,b in zip(sample.score,previous.score))):
            raise ValueError('Native time or score regressed')
        previous=sample
    if full:
        validate_full_match(record)
    if isinstance(record,GrfStatisticsReplay):
        from .telemetry_validation import validate_telemetry
        validate_telemetry(record)


def validate_full_match(record:GrfFullMatchReplay):
    samples=record.samples;last=samples[-1]
    if (samples[0].phase!=1 or samples[0].match_time_ms!=0 or last.phase!=2 or
        last.match_time_ms<5400000 or last.engine_step>=record.input.settings.game_duration or
        record.steps_left!=record.input.settings.game_duration-last.engine_step or
        not full_time_opportunity(last.phase,last.match_time_ms,last.game_mode,last.ball_xyz[0])):
        raise ValueError('Incomplete full match or unsafe final whistle')
    transitions=[]
    for index,sample in enumerate(samples):
        if sample.engine_step!=index-1:raise ValueError('Missing native observation')
        if index:
            previous=samples[index-1]
            if (sample.match_time_ms<previous.match_time_ms or sample.match_time_ms-previous.match_time_ms>1800 or
                sample.actual_time_ms<previous.actual_time_ms or sample.phase<previous.phase):
                raise ValueError('Native match clock or phase regressed')
            if sample.phase!=previous.phase:transitions.append(index)
    if transitions!=[record.halftime_sample_index] or samples[transitions[0]].match_time_ms<2700000:
        raise ValueError('Missing or inconsistent native half-time')
