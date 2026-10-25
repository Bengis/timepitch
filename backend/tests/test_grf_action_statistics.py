"""Action reducer matrices use admitted prefixes; public summaries require full admission."""
import pytest
from grf_action_fixtures import action_trace,semantic,held_24_then_one_hand_release
from grf_physical_fixtures import row
from grf_statistics_fixtures import native_event
from timepitch.grf.action_codec import ActionStreamValidator
from timepitch.grf.action_models import ACTION_NATIVE_SHA256,ActionSemanticEvent
from timepitch.grf.physical_models import PhysicalEvent
from timepitch.grf.action_statistics import build_action_statistics,_ActionAccumulator
from timepitch.grf.physical_codec import make_chunk_ref,manifest_hash


def prefix_result(manifest,chunks):
    """Internal components only: never mislabel a short prefix as a full summary."""
    validator=ActionStreamValidator(manifest.input,ACTION_NATIVE_SHA256)
    reducer=_ActionAccumulator(manifest.input.players,manifest.ledger)
    for chunk in chunks:
        validator.append(chunk)
        watermark=min([chunk.samples[-1][1],*(raw.actual_time_ms for raw,_,_ in validator.pending.values())])
        reducer.add_chunk(chunk,watermark)
    return reducer.finish(int(chunks[-1].samples[-1][1]),int(chunks[-1].samples[-1][2]))


def flight(*,arrival=300,team=0,slot=10,kind='control',origin='open_play_pass',intent='pass',splits=()):
    end=max(500,((arrival or 10300)+99)//100*100)
    rows=[row(i,i*100,elapsed=i*100,in_play=1) for i in range(end//100+1)]
    events=[native_event(sample_index=1,actual_time_ms=100,match_time_ms=100)]
    ss=[semantic(origin=origin,intent=intent)];roles=[2]
    if arrival is not None:
        index=(arrival+99)//100;role={'control':3,'accidental':5,'deflection':4,'unknown_contact':6,'release':2}[kind]
        events.append(native_event(seq=1,sample_index=index,actual_time_ms=arrival,match_time_ms=arrival,
            actor_team=team,team=team,player=slot,action_id=2,kind='ball_control'))
        ss.append(semantic(seq=1,physics_ms=arrival,sample_index=index,actor_team=team,slot=slot,animation_id=2,
            kind=kind,intent='shot' if kind=='release' else ('control' if kind=='control' else 'unknown'),
            origin='open_play_shot' if kind=='release' else 'unknown',raw_event_seq=1,
            release_key=(team,slot,2,30) if kind=='release' else None))
        roles.append(role)
    return action_trace(rows,events,ss,roles,splits=splits)


def test_24_retained_contacts_make_one_hand_pass_and_a_410_ms_episode():
    m,blocks=held_24_then_one_hand_release(complete=False)
    result=prefix_result(m,blocks)
    assert result['team_actions'][0].passes==1
    assert result['actions'][0].pass_contacts==25
    assert len(result['retentions'])==1 and result['retentions'][0].observed_ms==410
    assert result['retentions'][0].closed_by=='released'
    p=result['passes'][0]
    assert p.released_physics_ms==500 and p.received_physics_ms==700 and p.outcome=='received'
    assert p.evidence[0].release_raw_event_seq==24 and p.evidence[0].arrival_raw_event_seq==25
    assert result['pass_edges'][0].count==1


@pytest.mark.parametrize('team,slot,kind,outcome',[(0,10,'control','received'),(1,5,'control','intercepted'),
    (0,9,'control','same_actor'),(0,10,'accidental','interrupted'),(1,5,'deflection','interrupted'),
    (0,10,'unknown_contact','interrupted'),(1,5,'release','intercepted'),(0,10,'release','received')])
def test_contact_evidence_resolves_the_pass_without_using_sample_owner(team,slot,kind,outcome):
    m,blocks=flight(team=team,slot=slot,kind=kind);result=prefix_result(m,blocks)
    assert result['passes'][0].outcome==outcome
    assert len(result['pass_edges'])==int(outcome=='received')
    assert all(r[13]==-1 for c in blocks for r in c.samples)
    assert result['passes'][0].evidence[0].arrival_physics_ms==300


@pytest.mark.parametrize('delta,outcome',[(9999,'received'),(10000,'received'),(10001,'unresolved')])
def test_receipt_deadline_is_inclusive_and_uses_event_time(delta,outcome):
    m,blocks=flight(arrival=100+delta);result=prefix_result(m,blocks)
    p=result['passes'][0];assert p.outcome==outcome
    assert p.resolved_physics_ms==(100+delta if outcome=='received' else 10100)


@pytest.mark.parametrize('origin,intent,field',[('emergency_clearance','clearance','clearances'),
    ('open_play_shot','shot','shots'),('unknown','unknown','unknown_releases')])
@pytest.mark.parametrize('raw_kind',['shot','high_pass'])
def test_release_origin_defines_the_action_instead_of_animation_kind(origin,intent,field,raw_kind):
    m,blocks=flight(arrival=None,origin=origin,intent=intent)
    blocks[0].events[0].kind=raw_kind
    result=prefix_result(m,blocks)
    assert getattr(result['team_actions'][0],field)==1
    assert result['team_actions'][0].passes==0 and not result['passes']


def test_owner_samples_do_not_confirm_receipt_and_pass_categories_partition_attempts():
    m,blocks=flight(arrival=None)
    for c in blocks:
        for r in c.samples:r[13:15]=[0,10]
    result=prefix_result(m,blocks)
    assert result['passes'][0].outcome=='unresolved' and not result['pass_edges']
    assert len(result['passes'])==sum(a.passes for a in result['team_actions'])


@pytest.mark.parametrize('barrier',['relocation','discontinuity','restart'])
def test_new_barrier_interrupts_existing_flight(barrier):
    m,blocks=flight();rows=blocks[0].samples
    if barrier=='discontinuity':rows[2][7]=1
    if barrier=='relocation':
        for r in rows[2:]:r[19]=1
    if barrier=='restart':
        for r in rows[2:]:r[8:12]=[1,1,4,200]
        blocks[0].semantic_events[1].restart_id=1;blocks[0].semantic_events[1].restart_kind='corner'
    result=prefix_result(m,blocks)
    assert result['passes'][0].outcome=='interrupted' and result['passes'][0].resolved_physics_ms==200


@pytest.mark.parametrize('start',[150,300])
def test_manifest_restart_ledger_prevents_late_capture_from_confirming_invalid_receipt(start):
    from timepitch.grf.physical_models import PhysicalRestart
    m,original=flight()
    rows=[row(i,i*100,elapsed=i*100,in_play=1) for i in range(11)]
    for r in rows[5:7]:r[8:12]=[1,1,4,start]
    m,blocks=action_trace(rows,[e.model_dump() for e in original[0].events],
        [s.model_dump() for s in original[0].semantic_events],[2,3],splits=(5,))
    if start==150:
        # Incident evidence is observed in the next block; keep its semantic
        # contact pending until that context can be checked against the rows.
        control=blocks[0].semantic_events.pop();control.restart_id=1;control.restart_kind='corner'
        blocks[1].semantic_events.append(control)
    m.ledger=[PhysicalRestart(id=1,cause='corner',start=start,end=700,eligible_loss_ms=0,period=1)]
    result=prefix_result(m,blocks)
    assert result['passes'][0].outcome=='interrupted' and result['passes'][0].resolved_physics_ms==start
    m.ledger=[]
    with pytest.raises(ValueError,match='Late'):prefix_result(m,blocks)


def test_set_piece_release_and_end_of_same_incident_do_not_cancel_pass():
    m,blocks=flight(origin='set_piece_pass')
    blocks[0].semantic_events[0].restart_id=1;blocks[0].semantic_events[0].restart_kind='throw_in'
    blocks[0].semantic_events[1].restart_id=1;blocks[0].semantic_events[1].restart_kind='throw_in'
    for r in blocks[0].samples:
        r[8]=1;r[10]=6;r[9]=int(r[1]<200);r[6]=int(r[1]<200);r[5]=int(r[1]>=200)
    assert prefix_result(m,blocks)['passes'][0].outcome=='received'


def test_partition_and_delayed_semantic_raw_reference_preserve_results():
    outputs=[]
    for splits in ((),(1,5),(2,4,8)):
        m,blocks=held_24_then_one_hand_release(complete=False,splits=splits)
        result=prefix_result(m,blocks);outputs.append({k:[x.model_dump() for x in result[k]] for k in ('passes','retentions','pass_edges','team_actions')})
    assert outputs[0]==outputs[1]==outputs[2]
    m,blocks=flight(splits=(2,))
    original=prefix_result(m,blocks)['passes'][0].model_dump()
    release=blocks[0].semantic_events.pop(0);blocks[1].semantic_events.insert(0,release)
    assert prefix_result(m,blocks)['passes'][0].model_dump()==original
    blocks[1].samples[0][7]=1
    interrupted=prefix_result(m,blocks)['passes'][0]
    assert interrupted.outcome=='interrupted' and interrupted.resolved_physics_ms==200


def test_final_whistle_interrupts_unfinished_flight_before_its_timeout():
    m,blocks=flight(arrival=None)
    blocks[0].samples=blocks[0].samples[:6];blocks[0].activity=blocks[0].activity[:6]
    result=prefix_result(m,blocks)
    assert result['passes'][0].outcome=='interrupted' and result['passes'][0].resolved_physics_ms==500


def test_unknown_contacts_and_releases_report_partial_classification_and_empty_ratios_are_null():
    m,blocks=flight(kind='unknown_contact',origin='unknown',intent='unknown')
    result=prefix_result(m,blocks);coverage=result['classification']
    assert coverage.unknown_contacts==coverage.unknown_releases==1
    assert coverage.contact_ratio==.5 and coverage.release_ratio==0
    assert coverage.availability=='observed_partial' and result['team_actions'][0].availability=='observed_partial'
    m,blocks=action_trace(events=[],semantics=[],roles=[]);empty=prefix_result(m,blocks)
    assert empty['classification'].contact_ratio is None and empty['classification'].release_ratio is None
    assert empty['classification'].availability=='unavailable'
    assert empty['team_actions'][0].passes==0 and empty['team_actions'][0].availability=='observed_complete'


def test_open_retention_is_partial_and_raw_contacts_do_not_create_passes():
    m,blocks=held_24_then_one_hand_release(complete=False)
    c=blocks[0];c.events=c.events[:24];c.contact_roles=c.contact_roles[:24];c.semantic_events=c.semantic_events[:1]
    result=prefix_result(m,blocks)
    assert not result['passes'] and result['retentions'][0].end_physics_ms is None
    assert result['retentions'][0].availability=='observed_partial'


def test_reset_closes_retention_and_excluded_interval_keeps_coverage_partial():
    m,blocks=held_24_then_one_hand_release(complete=False);c=blocks[0]
    c.events=c.events[:24];c.contact_roles=c.contact_roles[:24]
    end=c.semantic_events[2];end.seq=1;end.retention_end_reason='reset'
    c.semantic_events=[c.semantic_events[0],end];c.samples[5][7]=1
    result=prefix_result(m,blocks);episode=result['retentions'][0]
    assert episode.closed_by=='reset' and episode.end_physics_ms==500
    assert episode.observed_ms==310 and episode.availability=='observed_partial' and not result['passes']


def test_receiving_release_can_start_the_next_pass_without_losing_either_attempt():
    m,blocks=flight(kind='release');c=blocks[0]
    c.events[1].kind='short_pass';c.semantic_events[1].intent='pass';c.semantic_events[1].origin='open_play_pass'
    result=prefix_result(m,blocks)
    assert result['team_actions'][0].passes==len(result['passes'])==2
    assert [p.outcome for p in result['passes']]==['received','interrupted']
    assert result['passes'][1].released_physics_ms==300 and len(result['pass_edges'])==1


def test_public_v1_v2_geometry_matches_for_three_complete_stream_partitions(complete_held_trace):
    from timepitch.grf.action_models import ActionChunk
    from timepitch.grf.physical_models import ActivityInput,ActivitySettings,ActivityChunk,ActivityManifest,ACTIVITY_NATIVE_SHA256
    from timepitch.grf.physical_statistics import build_physical_statistics
    from timepitch.grf.codec import grf_input_hash
    original,source=complete_held_trace
    rows=[r for c in source for r in c.samples]
    contacts=[(e,role) for c in source for e,role in zip(c.events,c.contact_roles)]
    semantics=[e for c in source for e in c.semantic_events]
    request=ActivityInput(**original.input.model_dump(exclude={'settings','input_hash'}),
        settings=ActivitySettings(**original.input.settings.model_dump(exclude={'telemetry_policy'})))
    request.input_hash=grf_input_hash(request)
    for offset in (1000,1,500):
        stops=(*range(offset,len(rows),1000),len(rows));start=0;new=[];old=[]
        for stop in stops:
            samples=rows[start:stop];first,last=int(samples[0][0]),int(samples[-1][0])
            selected=[(e,r) for e,r in contacts if first<=e.sample_index<=last]
            block=ActionChunk(index=len(new),samples=samples,activity=[[0]*22]*len(samples),
                events=[e for e,_ in selected],contact_roles=[r for _,r in selected],
                semantic_events=[e for e in semantics if first<=e.sample_index<=last])
            new.append(block)
            old.append(ActivityChunk(index=block.index,samples=samples,activity=block.activity,events=block.events))
            start=stop
        m=original.model_copy(deep=True);m.chunks=[make_chunk_ref(c) for c in new];m.trace_hash=manifest_hash(m)
        legacy=ActivityManifest(**original.model_dump(exclude={'schema_version','engine_version','input','native_binary_sha256',
            'trace_hash','chunks','raw_event_count','semantic_event_count','overflowed'}),input=request,
            native_binary_sha256=ACTIVITY_NATIVE_SHA256,chunks=[make_chunk_ref(c) for c in old])
        legacy.trace_hash=manifest_hash(legacy)
        actual=build_action_statistics(m,iter(new));previous=build_physical_statistics(legacy,iter(old))
        assert actual.players==previous.players
        assert actual.players[1].distance_m==pytest.approx(1.8)
        assert actual.players[1].observed_ms==actual.players[1].active_ms==5400000
        assert actual.players[1].periods[0].distance_m==pytest.approx(1.8)
        assert actual.players[1].periods[1].distance_m==0


@pytest.fixture(scope='module')
def complete_held_trace():return held_24_then_one_hand_release()


def test_public_summary_admits_complete_trace_and_preserves_score_and_player_team_sums(complete_held_trace):
    m,blocks=complete_held_trace;summary=build_action_statistics(m,iter(blocks))
    assert summary.schema_version==summary.statistics_version=='grf-physical-statistics-2'
    assert summary.score==m.score and summary.team_actions[0].passes==1
    assert summary.actions[0].pass_contacts==25 and summary.passes[0].outcome=='received'
    assert summary.players[1].distance_m==pytest.approx(1.8)
    for cell in summary.team_actions:
        players=[p for p in summary.player_actions if p.side==cell.side and p.period==cell.period]
        assert len(players)==11
        for field in ('passes','shots','clearances','unknown_releases'):
            assert sum(getattr(p,field) for p in players)==getattr(cell,field)


def test_public_summary_rejects_short_or_corrupted_trace():
    m,blocks=held_24_then_one_hand_release(complete=False)
    with pytest.raises(ValueError,match='Incomplete'):build_action_statistics(m,iter(blocks))
    blocks[0].contact_roles[0]=0
    with pytest.raises(ValueError):build_action_statistics(m,iter(blocks))


def test_halftime_breaks_flight_and_native_score_stays_independent_of_classified_shots(complete_held_trace):
    original,blocks=complete_held_trace;m=original.model_copy(deep=True);changes={}
    for index in (26,27,len(blocks)-1):changes[index]=blocks[index].model_copy(deep=True)
    changes[26].events.append(PhysicalEvent(**native_event(seq=26,sample_index=26999,actual_time_ms=2699900,match_time_ms=2699900,action_id=3)))
    changes[26].contact_roles.append(2)
    changes[26].semantic_events.append(ActionSemanticEvent(**semantic(seq=4,physics_ms=2699900,sample_index=26999,animation_id=3,
        raw_event_seq=26,release_key=(0,9,3,30))))
    changes[27].events.append(PhysicalEvent(**native_event(seq=27,sample_index=27002,actual_time_ms=2700100,match_time_ms=2700100,
        phase=2,player=10,action_id=4,kind='ball_control')))
    changes[27].contact_roles.append(3)
    changes[27].semantic_events.append(ActionSemanticEvent(**semantic(seq=5,physics_ms=2700100,sample_index=27002,phase=2,
        slot=10,animation_id=4,kind='control',intent='control',origin='unknown',raw_event_seq=27,release_key=None)))
    changes[len(blocks)-1].samples[-1][15:17]=[9,7]
    m.score=(9,7);m.raw_event_count=28;m.semantic_event_count=6
    for index,c in changes.items():m.chunks[index]=make_chunk_ref(c)
    m.trace_hash=manifest_hash(m)
    result=build_action_statistics(m,(changes.get(c.index,c) for c in blocks))
    assert result.score==(9,7) and sum(c.shots for c in result.team_actions)==0
    assert result.passes[-1].outcome=='interrupted' and result.passes[-1].resolved_physics_ms==2700000
