import pytest
from chronicle_fixtures import canonical, grf_pair
from timepitch.chronicles.facts import from_timepitch, from_grf, fact_pack_hash
from timepitch.chronicles.models import FactPack, ChronicleFact


def test_fact_identity_coverage_and_engine_units():
    record, summary = grf_pair()
    pack = from_grf(record, summary)
    assert pack.trace_hash == record.trace_hash and pack.engine == 'grf'
    assert pack.score == [1, 0] and pack.full_time_ms == summary.full_time_ms
    assert pack.full_time_ms != 5400000  # Preserve recorded native stoppage time.
    assert pack.facts[0].kind == 'result'
    assert not any(f.metric_id in ('xg', 'distance', 'saves') for f in pack.facts)
    summary.trace_hash = 'c' * 64
    with pytest.raises(ValueError): from_grf(record, summary)


def test_unknown_goal_actor_and_own_goal():
    record, summary = grf_pair()
    summary.goals[0].actor_id = None
    summary.goals[0].own_goal = True
    goal = next(f for f in from_grf(record, summary).facts if f.kind == 'goal')
    assert goal.own_goal and goal.player_ids == [] and goal.player_names == []
    assert goal.side == 'home' and goal.event_refs


def test_grf_missing_metrics_are_not_zero():
    record, summary = grf_pair()
    for metrics in summary.by_team.values():
        for metric in metrics.values(): metric.value = None
    for metrics in summary.by_player.values():
        for metric in metrics.values(): metric.value = None
    pack = from_grf(record, summary)
    assert not any(f.kind in ('team_compare', 'actor_stat') for f in pack.facts)
    assert pack.score == [1, 0]


def test_timepitch_resolved_event_references():
    record = canonical()
    pack = from_timepitch(record)
    assert pack.score == [1, 0] and pack.engine == 'timepitch'
    goal = next(f for f in pack.facts if f.kind == 'goal')
    assert goal.player_ids == [record.events[0].participants[0]]
    assert goal.event_refs == ['goal-one']
    assert pack.full_time_ms == 5400000


def test_unsupported_physical_format_refused():
    _, summary = grf_pair()
    with pytest.raises(ValueError): from_grf(object(), summary)


def test_limits_32768_16facts_8events():
    record, summary = grf_pair()
    data = from_grf(record, summary).model_dump()
    with pytest.raises(ValueError): FactPack.model_validate({**data, 'extra': True})
    with pytest.raises(ValueError): FactPack.model_validate({**data, 'facts': [data['facts'][0]] * 17})
    with pytest.raises(ValueError): FactPack.model_validate({**data, 'events': [{'id':str(i),'type':'goal','time_ms':i,'side':'home'} for i in range(9)]})
    with pytest.raises(ValueError): ChronicleFact(id='bad', kind='actor_stat', value=float('inf'))
    with pytest.raises(ValueError): FactPack.model_validate({**data, 'coverage': {'events_complete':True, 'native_clock':True, 'notes':['雪'*200]*80}})


def test_same_pack_same_hash_and_changed_fact_changes_hash():
    record, summary = grf_pair()
    pack = from_grf(record, summary)
    assert fact_pack_hash(pack) == fact_pack_hash(FactPack.model_validate_json(pack.model_dump_json()))
    assert fact_pack_hash(pack) != fact_pack_hash(pack.model_copy(update={'score':[2, 0]}))


def test_canonical_confirmed_pass_credits_passer_like_grf_and_ignores_unresolved_attempt():
    from timepitch.simulation.models import MatchEvent
    record=canonical(); passer,receiver=record.initial_frame.players[:2]
    event=MatchEvent(id='pass-one',t0_ms=1500,t1_ms=2000,type='pass',side='home',
        participants=[passer.key,receiver.key],outcome='complete',evidence={},frame_after=record.initial_frame)
    record.events.insert(1,event)
    record.events.insert(2,event.model_copy(update={'id':'unresolved','outcome':'in_flight'}))
    facts=from_timepitch(record).facts
    lead=next(f for f in facts if f.id=='leader:pass_received')
    assert lead.player_ids==[passer.key] and lead.value==1


def test_fact_pack_actual_byte_cap_independent_of_list_bounds():
    record,summary=grf_pair(); data=from_grf(record,summary).model_dump()
    data['facts']=[data['facts'][0]]+[dict(data['facts'][0],id=str(i),event_refs=['雪'*200]*8) for i in range(15)]
    with pytest.raises(ValueError,match='exceeds'): FactPack.model_validate(data)
