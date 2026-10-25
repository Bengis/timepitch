"""Synthetic wire fixtures; native acceptance is tested separately."""
from timepitch.grf.physical_models import PhysicalChunk
from timepitch.grf.physical_wire import COLUMNS
from pathlib import Path


def row(index=0, physics=0, period=1, elapsed=0, **kwargs):
    values=dict.fromkeys(COLUMNS,0)
    values.update(index=index,physics_ms=physics,period=period,period_elapsed_ms=elapsed,
                  owner_team=-1,owner_slot=-1,home_attack=1,away_attack=-1)
    for side in ('home','away'):
        for slot in range(11):
            values[f'{side}_{slot}_active']=1;values[f'{side}_{slot}_fatigue']=1
    values.update(kwargs)
    return [values[name] for name in COLUMNS]


def chunk(index=0, start=0):
    return PhysicalChunk(index=index,samples=[row(start,start*100,elapsed=start*100),
        row(start+1,(start+1)*100,elapsed=(start+1)*100)])


def write_match(directory,*,maximum=False):
    """Known synthetic clock/exposure trace, bounded memory even at maximum length."""
    from dataclasses import asdict
    from timepitch.grf.physical_clock import ClockState,ClockObservation,advance_clock
    from timepitch.grf.physical_models import PhysicalManifest,PHYSICAL_NATIVE_SHA256
    from timepitch.grf.physical_codec import encode_chunk,make_chunk_ref,manifest_hash
    from timepitch.grf.input import make_physical_input
    from timepitch.catalog.repository import CatalogRepository
    from grf_fixtures import request_fixture,DATASET
    directory=Path(directory);directory.mkdir(parents=True,exist_ok=True)
    request=make_physical_input(request_fixture().config,CatalogRepository(DATASET))
    clock=ClockState();rows=[];refs=[];index=0
    duration=3720000 if maximum else 2700000
    for period in (1,2):
        for elapsed in range(0,duration+1,100):
            physics=(period-1)*duration+elapsed
            active=maximum and 100<=elapsed<900100
            observation=ClockObservation(physics_ms=physics,period=period,in_play=0<elapsed<duration,
                restart_active=active,restart_id=period if active else 0,restart_cause='goal' if active else 'none',
                restart_start_ms=(period-1)*duration+100 if active else 0,discontinuity=period==2 and elapsed==0)
            clock=advance_clock(clock,observation)
            rows.append(row(index,physics,period,elapsed,in_play=int(observation.in_play),
                restart_active=int(active),restart_id=observation.restart_id,restart_cause=3 if active else 0,
                restart_start_ms=observation.restart_start_ms,discontinuity=int(observation.discontinuity)))
            index+=1
            if len(rows)==1000 or (period==2 and elapsed==duration):
                block=PhysicalChunk(index=len(refs),samples=rows);raw=encode_chunk(block)
                (directory/f'{block.index}.zlib').write_bytes(raw);refs.append(make_chunk_ref(block,raw));rows=[]
    readbacks=[dict(side=p.side,slot=p.slot,attribute=name,base=value,effective=value)
        for p in request.players for name,value in p.attributes.items()]
    manifest=PhysicalManifest(input=request,native_binary_sha256=PHYSICAL_NATIVE_SHA256,
        duration_ms=clock.physics_ms,score=(0,0),periods=list(clock.periods),ledger=[asdict(r) for r in clock.ledger],
        chunks=refs,attribute_readbacks=readbacks)
    manifest.trace_hash=manifest_hash(manifest)
    (directory/'manifest.json').write_text(manifest.model_dump_json(),encoding='utf-8')
    return manifest


def iter_fixture(directory,manifest):
    from timepitch.grf.physical_codec import decode_chunk
    for ref in manifest.chunks:yield decode_chunk((Path(directory)/f'{ref.index}.zlib').read_bytes())
