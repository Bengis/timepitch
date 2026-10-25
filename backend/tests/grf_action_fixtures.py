"""Hand-authored synthetic action evidence; not native match acceptance."""
from pathlib import Path
from grf_physical_fixtures import row, write_match, iter_fixture
from grf_statistics_fixtures import native_event
from grf_fixtures import request_fixture, DATASET
from timepitch.catalog.repository import CatalogRepository
from timepitch.grf.input import make_action_input
from timepitch.grf.action_models import ActionChunk, ActionManifest, ACTION_NATIVE_SHA256
from timepitch.grf.physical_codec import encode_chunk, make_chunk_ref, manifest_hash


def semantic(seq=0, physics_ms=100, sample_index=1, **updates):
    value=dict(seq=seq,physics_ms=physics_ms,phase=1,sample_index=sample_index,
        actor_team=0,slot=9,animation_id=1,kind='release',intent='pass',origin='open_play_pass',
        raw_event_seq=0,release_key=(0,9,1,30),restart_id=0,restart_kind='none',retention_end_reason=None)
    value.update(updates)
    return value


def action_trace(rows=None, events=None, semantics=None, roles=None, splits=(), semantic_blocks=None):
    request=make_action_input(request_fixture().config,CatalogRepository(DATASET))
    rows=rows if rows is not None else [row(),row(1,100,elapsed=100),row(2,200,elapsed=200)]
    events=events if events is not None else [native_event(sample_index=1,actual_time_ms=100,match_time_ms=100)]
    semantics=semantics if semantics is not None else [semantic()]
    roles=roles if roles is not None else [2]*len(events)
    chunks=[];start=0
    for stop in (*splits,len(rows)):
        indexes={int(r[0]) for r in rows[start:stop]}
        selected=[(e,role) for e,role in zip(events,roles) if e['sample_index'] in indexes]
        selected_semantics=([e for e in semantics if e['sample_index'] in indexes]
            if semantic_blocks is None else semantic_blocks[len(chunks)])
        chunks.append(ActionChunk(index=len(chunks),samples=rows[start:stop],activity=[[0]*22 for _ in rows[start:stop]],
            events=[e for e,_ in selected],contact_roles=[role for _,role in selected],semantic_events=selected_semantics))
        start=stop
    manifest=ActionManifest(input=request,native_binary_sha256=ACTION_NATIVE_SHA256,duration_ms=5400000,
        score=(0,0),periods=[dict(period=i,duration_ms=2700000,allowance_ms=0,announced_minimum_ms=0,effective_ms=0) for i in (1,2)],
        ledger=[],chunks=[make_chunk_ref(c) for c in chunks],raw_event_count=len(events),semantic_event_count=len(semantics),
        attribute_readbacks=[dict(side=p.side,slot=p.slot,attribute=k,base=v,effective=v) for p in request.players for k,v in p.attributes.items()])
    manifest.trace_hash=manifest_hash(manifest)
    return manifest,chunks


def write_action_match(directory:Path):
    """Full synthetic clock, with one release; stream blocks instead of retaining rows."""
    directory=Path(directory);legacy=directory/'legacy'
    old=write_match(legacy)
    request=make_action_input(old.input.config,CatalogRepository(DATASET));refs=[]
    for original in iter_fixture(legacy,old):
        events=[native_event(sample_index=1,actual_time_ms=100,match_time_ms=100)] if original.index==0 else []
        block=ActionChunk(index=original.index,samples=original.samples,activity=[[0]*22 for _ in original.samples],
            events=events,contact_roles=[2] if events else [],semantic_events=[semantic()] if events else [])
        raw=encode_chunk(block);(directory/f'{block.index}.zlib').write_bytes(raw);refs.append(make_chunk_ref(block,raw))
    manifest=ActionManifest(**old.model_dump(exclude={'schema_version','engine_version','input','native_binary_sha256','trace_hash','chunks'}),
        input=request,native_binary_sha256=ACTION_NATIVE_SHA256,chunks=refs,raw_event_count=1,semantic_event_count=1)
    manifest.trace_hash=manifest_hash(manifest)
    (directory/'manifest.json').write_text(manifest.model_dump_json(),encoding='utf-8')
    return manifest


def held_24_then_one_hand_release(*,complete=True,splits=()):
    """Synthetic evidence: 24 retained contacts, hand release at 500, control at 700."""
    rows=[row(i,i*100,elapsed=i*100,in_play=1,home_1_x_m=i*.2) for i in range(10)]
    events=[native_event(seq=i,sample_index=(100+i*10+99)//100,actual_time_ms=100+i*10,
        match_time_ms=100+i*10,touch_type=1) for i in range(24)]
    events.extend([native_event(seq=24,sample_index=5,actual_time_ms=500,match_time_ms=500,touch_type=1),
        native_event(seq=25,sample_index=7,actual_time_ms=700,match_time_ms=700,kind='ball_control',player=10,action_id=2)])
    ss=[semantic(physics_ms=90,kind='retention_start',intent='control',origin='unknown',raw_event_seq=None,release_key=None),
        semantic(seq=1,physics_ms=500,sample_index=5,raw_event_seq=24,origin='retainer_distribution'),
        semantic(seq=2,physics_ms=500,sample_index=5,kind='retention_end',intent='unknown',origin='unknown',raw_event_seq=None,
            release_key=None,retention_end_reason='released'),
        semantic(seq=3,physics_ms=700,sample_index=7,slot=10,animation_id=2,kind='control',intent='control',origin='unknown',
            raw_event_seq=25,release_key=None)]
    if complete:
        for i in range(10,27001):rows.append(row(i,i*100,elapsed=i*100,home_1_x_m=1.8))
        for elapsed in range(0,2700001,100):
            rows.append(row(27001+elapsed//100,2700000+elapsed,period=2,elapsed=elapsed,discontinuity=int(elapsed==0)))
        splits=tuple(range(1000,len(rows),1000))
    return action_trace(rows,events,ss,[1]*24+[2,3],splits=splits)
