import pytest
from grf_statistics_fixtures import statistics_replay,native_event
from timepitch.grf.statistics import build_grf_statistics


def stream(*entries):
    events=[];score=[0,0]
    for seq,(tick,fields) in enumerate(entries):
        if fields.get('type')=='goal':score[fields.get('team',0)]+=1
        params=dict(seq=seq,sample_index=tick,actual_time_ms=1900+tick*100,match_time_ms=(tick-1)*1800,action_id=seq+1)
        params.update(fields);params['score']=score.copy()
        events.append(native_event(**params))
    record=statistics_replay(events)
    for sample in record.samples:
        current=[0,0]
        for event in record.telemetry.events:
            if event.type=='goal' and event.sample_index<=sample.index:current[event.team]+=1
        sample.score=tuple(current)
    return record


def test_pass_results_partition_attempts():
    record=stream((2,{}),(3,{'kind':'trap','player':8}),
        (4,{'player':8}),(5,{'kind':'trap','team':1,'actor_team':1,'player':7}),
        (6,{}),(7,{'type':'decision','kind':'corner','stage':'prepared','incident_id':1}),
        (8,{}),(9,{'kind':'ball_control'}),(2000,{'phase':2}))
    summary=build_grf_statistics(record)
    outcomes=[p.outcome for p in summary.passes]
    assert sorted(outcomes)==sorted(['received','intercepted','interrupted','same_actor','unresolved'])
    assert summary.by_team['home']['pass_attempts'].value==5
    assert sum(e.count for e in summary.pass_edges)==1


def test_action_dedup_keeps_new_animations():
    record=stream((2,{'kind':'shot','action_id':10}),(3,{'kind':'shot','action_id':10}),(4,{'kind':'shot','action_id':11}))
    assert build_grf_statistics(record).by_team['home']['shots'].value==2


@pytest.mark.parametrize('delay,expected',[(100,1),(101,0)])
def test_assist_uses_internal_time_boundary(delay,expected):
    record=stream((2,{}),(3,{'kind':'trap','player':8}),
        (3+delay,{'kind':'shot','player':8}),(4+delay,{'type':'goal','kind':'goal','player':8}))
    summary=build_grf_statistics(record)
    assert summary.by_team['home']['assists'].value==expected
    assert (summary.goals[0].assist_id is not None)==bool(expected)


@pytest.mark.parametrize('interruption',[
    {'kind':'trap','team':1,'actor_team':1,'player':4},
    {'kind':'short_pass','player':8},
    {'type':'decision','kind':'free_kick','stage':'prepared','incident_id':1},
])
def test_rival_new_pass_and_restart_invalidate_assist(interruption):
    summary=build_grf_statistics(stream((2,{}),(3,{'kind':'trap','player':8}),(4,interruption),
        (5,{'kind':'shot','player':8}),(6,{'type':'goal','kind':'goal','player':8})))
    assert summary.goals[0].assist_id is None


def test_autogoal_and_unresolved_author_do_not_require_own_shot():
    summary=build_grf_statistics(stream((2,{'type':'goal','kind':'goal','team':1,'own_goal':True}),
        (4,{'type':'goal','kind':'goal','team':0,'actor_team':-1,'player':-1})))
    assert summary.score==(1,1) and len(summary.shots)==0
    assert summary.goals[0].own_goal and summary.goals[0].assist_id is None
    assert summary.goals[1].actor_id is None


def test_unknown_contacts_and_ball_free_are_not_successful_passes_or_recoveries():
    summary=build_grf_statistics(stream((2,{}),(3,{'kind':'other','touch_type':2,'actor_team':1,'team':1}),
        (4,{'kind':'trap','actor_team':1,'team':1})))
    assert summary.passes[0].outcome=='unresolved'
    assert summary.by_team['away']['recoveries'].value==1


def test_foul_stages_and_repeated_restart_have_one_incident():
    summary=build_grf_statistics(stream(
        (2,{'type':'decision','kind':'foul','stage':'accepted','incident_id':1}),
        (3,{'type':'decision','kind':'foul','stage':'sanctioned','incident_id':1}),
        (4,{'type':'decision','kind':'corner','stage':'prepared','incident_id':2}),
        (5,{'type':'decision','kind':'corner','stage':'prepared','incident_id':2}),
        (6,{'type':'decision','kind':'offside','stage':'awarded','incident_id':3})))
    assert summary.by_team['home']['fouls'].value==1
    assert summary.by_team['home']['corners'].value==1
    assert summary.by_team['home']['offsides'].value==1


def test_repeated_rival_animation_still_breaks_shot_and_assist_evidence():
    summary=build_grf_statistics(stream(
        (1,{'kind':'ball_control','team':1,'actor_team':1,'action_id':99}),
        (2,{}),(3,{'kind':'trap','player':8}),(4,{'kind':'shot','player':8}),
        (5,{'kind':'ball_control','team':1,'actor_team':1,'action_id':99}),
        (6,{'type':'goal','kind':'goal','player':8})))
    assert summary.goals[0].assist_id is None and summary.goals[0].shot_seq is None


def test_pass_edges_are_scoped_to_the_native_half():
    summary=build_grf_statistics(stream((2,{}),(3,{'kind':'trap','player':8}),
        (1600,{'phase':2}),(1601,{'phase':2,'kind':'trap','player':8})))
    assert len(summary.pass_edges)==2
    assert {e.phase for e in summary.pass_edges}=={1,2}
    assert all(e.count==1 for e in summary.pass_edges)


@pytest.mark.parametrize('resolution',['sanctioned','advantage_played'])
def test_accepted_foul_counts_once_including_played_advantage(resolution):
    from timepitch.grf.codec import encode_grf,parse_grf,grf_hash
    record=stream((2,{'type':'decision','kind':'foul','stage':'accepted','incident_id':1}),
        (3,{'type':'decision','kind':'foul','stage':resolution,'incident_id':1}))
    record.trace_hash=grf_hash(record)
    summary=build_grf_statistics(parse_grf(encode_grf(record)))
    assert summary.by_team['home']['fouls'].value==1
    assert summary.by_player[record.input.players[9].id]['fouls'].value==1


def test_played_advantage_preserves_pass_and_assist_chain():
    summary=build_grf_statistics(stream((2,{}),
        (3,{'type':'decision','kind':'foul','stage':'accepted','incident_id':1}),
        (4,{'type':'decision','kind':'foul','stage':'advantage_played','incident_id':1}),
        (5,{'kind':'trap','player':8}),(6,{'kind':'shot','player':8}),
        (7,{'type':'goal','kind':'goal','player':8})))
    assert summary.by_team['home']['fouls'].value==1
    assert summary.passes[0].outcome=='received' and summary.goals[0].assist_id is not None
