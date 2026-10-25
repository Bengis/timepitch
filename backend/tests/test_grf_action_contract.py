"""Semantic mutations recompute hashes: admission must inspect evidence itself."""
import struct
import pytest
from grf_action_fixtures import action_trace, semantic, write_action_match
from grf_physical_fixtures import iter_fixture, row
from grf_statistics_fixtures import native_event
from timepitch.grf.action_models import ActionChunk, ActionManifest, ActionSemanticEvent, ACTION_NATIVE_SHA256
from timepitch.grf.action_codec import ActionStreamValidator
from timepitch.grf.physical_codec import encode_chunk,decode_chunk,make_chunk_ref,parse_manifest,validate_manifest,manifest_hash


def validate_prefix(manifest,chunks):
    validator=ActionStreamValidator(manifest.input,ACTION_NATIVE_SHA256)
    for chunk in chunks:validator.append(chunk)
    return validator


@pytest.mark.parametrize('change',['future','cause','stale'])
@pytest.mark.parametrize('splits',[(),(2,)])
def test_semantic_restart_context_cannot_forge_a_future_or_wrong_incident(change,splits):
    rows=[row(i,i*100,elapsed=i*100,in_play=1) for i in range(5)]
    for r in rows[2:]:r[8:12]=[1,1,4,200]
    events=[native_event(sample_index=1,actual_time_ms=100,match_time_ms=100),
        native_event(seq=1,sample_index=3,actual_time_ms=300,match_time_ms=300,player=10,action_id=2,kind='ball_control')]
    ss=[semantic(),semantic(seq=1,physics_ms=300,sample_index=3,slot=10,animation_id=2,kind='control',intent='control',
        origin='unknown',raw_event_seq=1,release_key=None,restart_id=1,restart_kind='corner')]
    m,blocks=action_trace(rows,events,ss,[2,3],splits=splits)
    validate_prefix(m,blocks)
    contacts=[e for c in blocks for e in c.semantic_events]
    if change=='future':contacts[0].restart_id=1;contacts[0].restart_kind='corner'
    if change=='cause':contacts[1].restart_kind='throw_in'
    if change=='stale':contacts[1].restart_id=0;contacts[1].restart_kind='none'
    m.chunks=[make_chunk_ref(c) for c in blocks];m.trace_hash=manifest_hash(m)
    with pytest.raises(ValueError,match='restart'):validate_prefix(m,blocks)


@pytest.mark.parametrize('delayed',[False,True])
def test_same_tick_contact_semantics_keep_raw_order_even_across_delayed_blocks(delayed):
    rows=[row(i,i*100,elapsed=i*100) for i in range(4)]
    events=[native_event(sample_index=1,actual_time_ms=100,match_time_ms=100),
        native_event(seq=1,sample_index=1,actual_time_ms=100,match_time_ms=100,player=10,action_id=2,kind='ball_control')]
    ss=[semantic(),semantic(seq=1,slot=10,animation_id=2,kind='control',intent='control',origin='unknown',raw_event_seq=1,release_key=None)]
    m,blocks=action_trace(rows,events,ss,[2,3],splits=(2,) if delayed else (),semantic_blocks=[[],ss] if delayed else None)
    validate_prefix(m,blocks)
    target=blocks[-1] if delayed else blocks[0]
    target.semantic_events.reverse()
    for i,e in enumerate(target.semantic_events):e.seq=i
    m.chunks=[make_chunk_ref(c) for c in blocks];m.trace_hash=manifest_hash(m)
    with pytest.raises(ValueError,match='order'):validate_prefix(m,blocks)


def test_contact_at_exact_incident_start_can_precede_the_referee_update():
    # Native F1 evidence: a contact at 34,030 ms precedes a free-kick at
    # the same millisecond. Upper-bound snapshots cannot order those hooks.
    rows=[row(i,i*100,elapsed=i*100) for i in range(4)]
    for r in rows[2:]:r[8:12]=[1,1,4,200]
    m,blocks=action_trace(rows,[native_event(sample_index=2,actual_time_ms=200,match_time_ms=200)],
        [semantic(physics_ms=200,sample_index=2)],[2])
    validate_prefix(m,blocks)
    blocks[0].semantic_events[0].restart_id=1;blocks[0].semantic_events[0].restart_kind='corner'
    validate_prefix(m,blocks)


def test_lossless_wire_and_action_discriminators_survive_dispatch():
    m,blocks=action_trace();c=blocks[0];c.samples[0][21]=-0.;c.samples[1][21]=.12345678901234567
    actual=decode_chunk(encode_chunk(c))
    assert isinstance(actual,ActionChunk) and actual.contact_roles==[2]
    assert [struct.pack('<d',r[21]) for r in actual.samples]==[struct.pack('<d',r[21]) for r in c.samples]
    assert actual.semantic_events[0].release_key==(0,9,1,30)
    assert isinstance(parse_manifest(m.model_dump_json()),ActionManifest)
    before=make_chunk_ref(c);c.contact_roles=[6]
    assert before.sha256!=make_chunk_ref(c).sha256
    c.contact_roles=[2];c.semantic_events[0].origin='set_piece_pass'
    assert before.sha256!=make_chunk_ref(c).sha256


@pytest.mark.parametrize('change',['actor','animation','raw_reference','time','phase','sample','role_zero','goal_role',
    'missing_semantic','origin_intent','release_key','end_without_start','retained_without_start','sequence','restart'])
def test_crossed_or_missing_contact_evidence_is_rejected(change):
    m,blocks=action_trace();c=blocks[0];s=c.semantic_events[0]
    if change=='actor':s.slot=8
    if change=='animation':s.animation_id=2
    if change=='raw_reference':s.raw_event_seq=1
    if change=='time':s.physics_ms=101
    if change=='phase':s.phase=2
    if change=='sample':s.sample_index=2
    if change=='role_zero':c.contact_roles=[0]
    if change=='goal_role':c.events[0].type='goal'
    if change=='missing_semantic':c.semantic_events=[]
    if change=='origin_intent':s.intent='shot'
    if change=='release_key':s.release_key=(1,9,1,30)
    if change=='end_without_start':s.kind='retention_end';s.raw_event_seq=None;s.release_key=None;s.retention_end_reason='lost';s.intent='unknown';s.origin='unknown'
    if change=='retained_without_start':c.contact_roles=[1];c.semantic_events=[]
    if change=='sequence':s.seq=1
    if change=='restart':s.restart_kind='invented'
    # An attacker can regenerate every digest; it cannot make the evidence coherent.
    m.chunks=[make_chunk_ref(c)];m.trace_hash=manifest_hash(m)
    with pytest.raises(ValueError):
        v=validate_prefix(m,blocks);v.finish(m)


def test_raw_reference_can_cross_block_boundary_but_cannot_cross_actor():
    s=semantic();m,blocks=action_trace(splits=(2,),semantic_blocks=[[],[s]])
    validate_prefix(m,blocks)
    blocks[1].semantic_events[0].slot=8
    with pytest.raises(ValueError):validate_prefix(m,blocks)


def test_duplicate_release_key_fails_even_after_another_animation():
    events=[native_event(seq=i,sample_index=i+1,actual_time_ms=(i+1)*100,match_time_ms=(i+1)*100,action_id=a)
        for i,a in enumerate((1,2,1))]
    ss=[semantic(seq=i,physics_ms=(i+1)*100,sample_index=i+1,animation_id=a,raw_event_seq=i,release_key=(0,9,a,30)) for i,a in enumerate((1,2,1))]
    rows=[row(i,i*100,elapsed=i*100) for i in range(4)]
    m,blocks=action_trace(rows,events,ss)
    with pytest.raises(ValueError,match='release'):validate_prefix(m,blocks)


def test_retained_contacts_and_release_end_same_tick_keep_their_order():
    rows=[row(i,i*100,elapsed=i*100) for i in range(4)]
    events=[native_event(seq=i,sample_index=i+1,actual_time_ms=(i+1)*100,match_time_ms=(i+1)*100) for i in range(3)]
    ss=[semantic(kind='retention_start',intent='control',origin='unknown',raw_event_seq=None,release_key=None),
        semantic(seq=1,physics_ms=300,sample_index=3,raw_event_seq=2,origin='retainer_distribution'),
        semantic(seq=2,physics_ms=300,sample_index=3,kind='retention_end',intent='unknown',origin='unknown',raw_event_seq=None,release_key=None,retention_end_reason='released')]
    m,blocks=action_trace(rows,events,ss,[1,1,2],splits=(3,))
    validate_prefix(m,blocks)
    assert sum(s.kind=='release' for c in blocks for s in c.semantic_events)==1


def test_combined_budget_accepts_100000_and_rejects_100001_without_two_event_pools():
    # Raw noncontact events need no semantic counterpart; this is a bounded prefix.
    m,blocks=action_trace(events=[],semantics=[],roles=[])
    c=blocks[0]
    c.events=[native_event(seq=i,sample_index=1,actual_time_ms=100,match_time_ms=100,type='decision',kind='normal',actor_team=-1,player=-1) for i in range(100000)]
    # Partition into small valid blocks/rows so individual compressed/expanded limits still apply.
    v=ActionStreamValidator(m.input,ACTION_NATIVE_SHA256)
    for i in range(50):
        data=[dict(e,sample_index=i*2+1,actual_time_ms=(i*2+1)*100) for e in c.events[i*2000:(i+1)*2000]]
        b=ActionChunk(index=i,samples=[row(i*2,i*200,elapsed=i*200),row(i*2+1,i*200+100,elapsed=i*200+100)],
            activity=[[0]*22]*2,events=data,contact_roles=[0]*2000,semantic_events=[])
        v.append(b)
    extra=ActionChunk(index=50,samples=[row(100,10000,elapsed=10000)],activity=[[0]*22],events=[],contact_roles=[],
        semantic_events=[semantic(seq=0,physics_ms=10000,sample_index=100,kind='retention_start',intent='control',origin='unknown',raw_event_seq=None,release_key=None)])
    with pytest.raises(ValueError,match='budget'):v.append(extra)


@pytest.fixture(scope='module')
def full_action_match(tmp_path_factory):
    directory=tmp_path_factory.mktemp('actions');return directory,write_action_match(directory)


def test_complete_synthetic_match_and_prefix_have_distinct_admission(full_action_match):
    directory,m=full_action_match
    validate_manifest(m,iter_fixture(directory,m),m.input)
    first=next(iter_fixture(directory,m));v=validate_prefix(m,[first])
    with pytest.raises(ValueError,match='Incomplete'):v.finish(m)


@pytest.mark.parametrize('change',['input','readbacks','duplicate_readback','binary','counts','overflow'])
def test_manifest_identity_and_native_counters_cannot_be_forged(full_action_match,change):
    directory,original=full_action_match;m=original.model_copy(deep=True)
    if change=='input':m.input.config.seed+=1
    if change=='readbacks':m.attribute_readbacks[0].base=0
    if change=='duplicate_readback':m.attribute_readbacks[1]=m.attribute_readbacks[0]
    if change=='binary':m.native_binary_sha256='f'*64
    if change=='counts':m.raw_event_count+=1
    if change=='overflow':m.overflowed=True
    m.trace_hash=manifest_hash(m)
    with pytest.raises(ValueError):validate_manifest(m,iter_fixture(directory,original),original.input)


def test_missing_semantic_contact_rejects_otherwise_complete_rehashed_match(full_action_match):
    directory,original=full_action_match;m=original.model_copy(deep=True)
    first=next(iter_fixture(directory,m));first.semantic_events=[]
    m.semantic_event_count=0;m.chunks[0]=make_chunk_ref(first);m.trace_hash=manifest_hash(m)
    def chunks():
        for block in iter_fixture(directory,original):yield first if block.index==0 else block
    with pytest.raises(ValueError,match='Incomplete'):validate_manifest(m,chunks())


@pytest.mark.parametrize('reason',['reset','lost'])
def test_halftime_reset_can_close_previous_period_retention_at_the_same_physical_tick(full_action_match,reason):
    directory,original=full_action_match;m=original.model_copy(deep=True);changes={}
    for block in iter_fixture(directory,m):
        if block.index==26:
            block.semantic_events.append(ActionSemanticEvent(**semantic(seq=1,physics_ms=2699900,sample_index=26999,
                kind='retention_start',intent='control',origin='unknown',raw_event_seq=None,release_key=None)))
        elif block.index==27:
            block.semantic_events.append(ActionSemanticEvent(**semantic(seq=2,physics_ms=2700000,sample_index=27001,
                kind='retention_end',intent='unknown',origin='unknown',raw_event_seq=None,release_key=None,retention_end_reason=reason)))
        else:continue
        # Validate hand-authored dictionaries through the public contract.
        block=ActionChunk.model_validate(block.model_dump(mode='json'))
        changes[block.index]=block;m.chunks[block.index]=make_chunk_ref(block)
    m.semantic_event_count=3;m.trace_hash=manifest_hash(m)
    chunks=(changes.get(b.index,b) for b in iter_fixture(directory,original))
    if reason=='reset':validate_manifest(m,chunks)
    else:
        with pytest.raises(ValueError,match='capture interval'):validate_manifest(m,chunks)
