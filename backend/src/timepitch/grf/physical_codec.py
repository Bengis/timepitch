"""Canonical bounded physical blocks and whole-stream admission."""
import hashlib
import json
import math
import zlib
from .physical_wire import *
from .codec import _unique,grf_input_hash,ATTRIBUTES,ROLES


def validate_rows(rows):
    previous=None
    for row in rows:
        if len(row)!=len(COLUMNS) or any(not math.isfinite(v) for v in row):raise ValueError('Invalid physical row')
        if any(v!=int(v) for v in row[:21]):raise ValueError('Nonintegral physical state')
        if not (0<=row[0]<MAX_SAMPLES and 0<=row[1]<=MAX_PHYSICS_MS and row[2] in (1,2) and
            0<=row[3]<=3720000 and 0<=row[4]<=row[1] and all(row[i] in (0,1) for i in (5,6,7,9,12)) and
            row[8]>=0 and 0<=row[10]<len(CAUSES) and 0<=row[11]<=row[1] and
            row[13] in (-1,0,1) and -1<=row[14]<=10 and (row[13]==-1)==(row[14]==-1) and
            all(0<=row[i]<=100 for i in (15,16)) and row[17] in (-1,1) and row[18]==-row[17] and
            row[19]>=0 and 0<=row[20]<=6):raise ValueError('Invalid physical state')
        for i in range(21,153,6):
            if not (abs(row[i])<=100 and abs(row[i+1])<=100 and abs(row[i+2])<=20 and abs(row[i+3])<=20 and
                    row[i+4] in (0,1) and 0<=row[i+5]<=1):raise ValueError('Invalid native player state')
        if any(abs(v)>150 for v in row[153:]):raise ValueError('Invalid ball position')
        if previous is not None:validate_pair(previous,row)
        previous=row


def validate_pair(a,b):
    transition=a[2]==1 and b[2]==2
    if b[0]!=a[0]+1 or b[1]-a[1]!=(0 if transition else 100):raise ValueError('Physical sequence gap')
    if transition:
        if not b[7] or b[5] or b[3]!=0 or b[4]!=a[4]:raise ValueError('Invalid halftime discontinuity')
    elif b[2]!=a[2] or b[3]-a[3]!=100:raise ValueError('Invalid period clock')
    if not 0<=b[4]-a[4]<=b[1]-a[1] or any(b[i]<a[i] for i in (15,16,19)):raise ValueError('Regressing physical state')


def encode_chunk(chunk):
    raw=canonical(pack_samples(chunk.model_dump(mode='json')))
    if len(raw)>MAX_EXPANDED:raise ValueError('Expanded physical block exceeds budget')
    compressed=zlib.compress(raw)
    if len(compressed)>MAX_COMPRESSED:raise ValueError('Compressed physical block exceeds budget')
    return compressed


def decode_chunk(raw):
    from .physical_models import PhysicalChunk,ActivityChunk
    if len(raw)>MAX_COMPRESSED:raise ValueError('Compressed physical block exceeds budget')
    decoder=zlib.decompressobj()
    try:data=decoder.decompress(raw,MAX_EXPANDED+1)
    except zlib.error as e:raise ValueError('Invalid physical block') from e
    if len(data)>MAX_EXPANDED or not decoder.eof or decoder.unused_data:raise ValueError('Invalid expanded physical block')
    try:
        value=unpack_samples(json.loads(data,object_pairs_hook=_unique,
            parse_constant=lambda _:(_ for _ in ()).throw(ValueError('Nonfinite JSON'))))
        if value.get('schema_version')=='grf-actions-chunk-1':
            from .action_models import ActionChunk
            return ActionChunk.model_validate(value)
        cls=ActivityChunk if value.get('schema_version')=='grf-activity-chunk-1' else PhysicalChunk
        return cls.model_validate(value)
    except (RecursionError,UnicodeError) as e:raise ValueError('Invalid physical JSON') from e


def make_chunk_ref(chunk,raw=None):
    from .action_models import ActionChunk
    if isinstance(chunk,ActionChunk):
        from .action_codec import make_action_chunk_ref
        return make_action_chunk_ref(chunk,raw)
    from .physical_models import ChunkRef
    logical=canonical(chunk.model_dump(mode='json'));expanded=canonical(pack_samples(chunk.model_dump(mode='json')));raw=raw or encode_chunk(chunk)
    return ChunkRef(index=chunk.index,samples=len(chunk.samples),events=len(chunk.events),
        physics_start=int(chunk.samples[0][1]),physics_end=int(chunk.samples[-1][1]),
        compressed_bytes=len(raw),expanded_bytes=len(expanded),sha256=hashlib.sha256(logical).hexdigest())


def manifest_hash(manifest):return digest(manifest.model_dump(mode='json',exclude={'trace_hash'}))


def parse_manifest(value):
    from .physical_models import PhysicalManifest,ActivityManifest
    if isinstance(value,(str,bytes)):value=json.loads(value,object_pairs_hook=_unique)
    if value.get('schema_version')=='grf-actions-1':
        from .action_models import ActionManifest
        return ActionManifest.model_validate(value)
    cls=ActivityManifest if value.get('schema_version')=='grf-activity-1' else PhysicalManifest
    return cls.model_validate(value)


def validate_manifest(manifest,chunks,expected=None):
    from .action_models import ActionManifest
    if isinstance(manifest,ActionManifest):
        from .action_codec import validate_action_manifest
        return validate_action_manifest(manifest,chunks,expected)
    from .physical_models import PHYSICAL_NATIVE_SHA256,ActivityManifest,ActivityChunk,ACTIVITY_NATIVE_SHA256
    from .physical_clock import ClockState,ClockObservation,advance_clock
    request=manifest.input
    activity=isinstance(manifest,ActivityManifest)
    native=ACTIVITY_NATIVE_SHA256 if activity else PHYSICAL_NATIVE_SHA256
    if (request!=(expected or request) or request.input_hash!=grf_input_hash(request) or
        manifest.trace_hash!=manifest_hash(manifest) or manifest.native_binary_sha256!=native):
        raise ValueError('Physical input, trace or native mismatch')
    identities={(p.side,p.slot) for p in request.players}
    if identities!={(side,slot) for side in ('home','away') for slot in range(11)} or len({p.id for p in request.players})!=22:
        raise ValueError('Invalid physical participants')
    reads={(r.side,r.slot,r.attribute):r.base for r in manifest.attribute_readbacks}
    if len(reads)!=66:raise ValueError('Duplicate readback')
    for p in request.players:
        if (p.id!=f'{p.side}:{p.source_key}' or p.source_key!=getattr(request.config,p.side+'_players')[p.slot] or
            p.native_role!=ROLES[p.role] or set(p.attributes)!=ATTRIBUTES or set(p.provenance)!=ATTRIBUTES or
            any(abs(reads.get((p.side,p.slot,k),-1)-v)>1e-5 for k,v in p.attributes.items())):
            raise ValueError('Physical catalogue/readback mismatch')
    previous=None;count=events=compressed=expanded=blocks=0;clock=ClockState();last_event_time=-1
    for chunk in chunks:
        if isinstance(chunk,ActivityChunk)!=activity:raise ValueError('Mixed physical motion versions')
        if blocks>=len(manifest.chunks) or chunk.index!=blocks:raise ValueError('Invalid block sequence')
        ref=make_chunk_ref(chunk)
        if ref!=manifest.chunks[blocks]:raise ValueError('Physical block digest mismatch')
        compressed+=ref.compressed_bytes;expanded+=ref.expanded_bytes
        if compressed>MAX_TOTAL_COMPRESSED or expanded>MAX_TOTAL_EXPANDED:raise ValueError('Physical stream exceeds budget')
        for row in chunk.samples:
            if previous is None:
                if row[:5]!=[0,0,1,0,0] or row[15:17]!=[0,0]:raise ValueError('Invalid initial physical state')
            else:validate_pair(previous,row)
            clock=advance_clock(clock,ClockObservation(physics_ms=int(row[1]),period=int(row[2]),effective_ms=int(row[4]),
                in_play=bool(row[5]),restart_id=int(row[8]),restart_active=bool(row[9]),restart_cause=CAUSES[int(row[10])],
                restart_start_ms=int(row[11]),pending_penalty=bool(row[12]),discontinuity=bool(row[7])))
            if clock.period_elapsed_ms!=row[3]:raise ValueError('Physical clock policy mismatch')
            previous=row;count+=1
        for event in chunk.events:
            if (event.seq!=events or not chunk.samples[0][0]<=event.sample_index<=chunk.samples[-1][0] or
                event.actual_time_ms<last_event_time or event.actual_time_ms>ref.physics_end):raise ValueError('Invalid physical event sequence')
            last_event_time=event.actual_time_ms;events+=1
        blocks+=1
    if (blocks!=len(manifest.chunks) or count>MAX_SAMPLES or events>MAX_EVENTS or not clock.finished or
        previous[1]!=manifest.duration_ms or previous[15:17]!=list(manifest.score) or
        list(clock.periods)!=[p.model_dump() for p in manifest.periods] or
        [r.__dict__ for r in clock.ledger]!=[r.model_dump() for r in manifest.ledger]):raise ValueError('Incomplete physical match')
    if len(canonical(manifest.model_dump(mode='json')))>MAX_MANIFEST:raise ValueError('Oversized physical manifest')
