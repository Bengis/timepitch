"""Offline bridge/comparison fixtures. Never executes a football engine or model."""
from types import SimpleNamespace
import pytest
from historical_analysis_support import game as match_events,statistics

from timepitch.historical.crosswalk import ClubCrosswalk,resolve_matchup
from timepitch.historical.comparison import compare_match,SimulationMetricSnapshot,ComparisonMetric


class Catalog:
    dataset_version='catalog-fixture'
    def get_team(self,key):
        if key not in ('chelsea:2015','arsenal:2015'):raise KeyError(key)
        return SimpleNamespace(key=key,available_formations=['4-4-2'],players=[SimpleNamespace(key=f'{key}:p{i}',role=('GK' if i==0 else 'DEF' if i<5 else 'MID' if i<9 else 'FWD')) for i in range(11)])


def crosswalk(players=None):
    return ClubCrosswalk(clubs={'statsbomb:33':'chelsea','statsbomb:1':'arsenal'},players=players or {})


def test_club_prefill_does_not_resolve_players_by_name_or_replace_4231():
    match,events=match_events([])
    result=resolve_matchup(match,Catalog(),crosswalk(),starting_formations=statistics(match,events,1,0).formations)
    assert result.available and result.home.catalog_key=='chelsea:2015'
    assert not result.exact_xi_available
    assert result.home.source_formation=='4-2-3-1'
    assert result.home.player_keys is None
    assert 'unsupported_source_formation' in result.home.differences
    assert 'unverified_player_identities' in result.home.differences


def test_only_explicit_team_season_player_identities_can_enable_exact_xi():
    match,events=match_events([])
    formations=[f.model_copy(update={'formation':442}) for f in statistics(match,events,1,0).formations]
    players={f'{team}:2015':{f'statsbomb:{start+i}':f'{team}:2015:p{i}' for i in range(11)} for team,start in [('chelsea',100),('arsenal',200)]}
    result=resolve_matchup(match,Catalog(),crosswalk(players),starting_formations=formations)
    assert result.exact_xi_available
    assert len(set(result.home.player_keys))==11
    del players['chelsea:2015']['statsbomb:100']
    assert not resolve_matchup(match,Catalog(),crosswalk(players),starting_formations=formations).exact_xi_available


def test_matching_club_name_with_unknown_source_id_is_not_a_crosswalk():
    match,_=match_events([])
    match=match.model_copy(update={'home_team':match.home_team.model_copy(update={'key':'statsbomb:unknown','name':'Chelsea'})})
    result=resolve_matchup(match,Catalog(),crosswalk())
    assert not result.available and result.home.catalog_key is None


def snapshot(engine='timepitch',away='arsenal:2015'):
    return SimulationMetricSnapshot(engine=engine,simulation_id='saved',trace_hash='fixture',home_key='chelsea:2015',away_key=away,
        home_formation='4-4-2',away_formation='4-4-2',home_players=[],away_players=[],seed=42,engine_version='fixture',
        metrics={key:ComparisonMetric(home=value,away=value,definition=definition) for key,value,definition in [
            ('goals',0,'final-goal-count'),('shots',0,'timepitch-shot-events'),('xg',.2,'timepitch-generative-xg'),('completed_passes',1,'timepitch-resolved-passes')]})


def test_compatibility_is_definition_based_and_not_based_on_matching_numbers():
    match,events=match_events([])
    facts=statistics(match,events)
    value=snapshot();metrics=dict(value.metrics)
    for key,source in [('xg','xg'),('completed_passes','passes_completed')]:
        metrics[key]=metrics[key].model_copy(update={'home':facts.teams[0].metrics[source].value,'away':facts.teams[1].metrics[source].value})
    result=compare_match(facts,value.model_copy(update={'metrics':metrics}))
    rows={r.metric:r for r in result.rows}
    assert rows['goals'].status=='comparable' and rows['goals'].delta.home==0
    assert rows['xg'].status=='different_definition' and rows['xg'].delta is None
    assert rows['completed_passes'].status=='different_definition' and rows['completed_passes'].delta is None


def test_grf_absent_xg_is_unavailable_and_no_distance_reference_is_fabricated():
    match,events=match_events([])
    value=snapshot('grf').model_copy(update={'metrics':{k:v for k,v in snapshot().metrics.items() if k!='xg'}})
    result=compare_match(statistics(match,events),value)
    assert next(r for r in result.rows if r.metric=='xg').status=='unavailable'
    assert all('distance' not in row.metric for row in result.rows)


@pytest.mark.parametrize('engine,definition,expected',[('grf','grf-native-shot-actions','different_definition'),('timepitch','timepitch-shot-events','comparable')])
def test_shot_compatibility_excludes_native_grf_clearance_animations(engine,definition,expected):
    match,events=match_events([])
    value=snapshot(engine);metrics=dict(value.metrics)
    metrics['shots']=ComparisonMetric(home=0,away=0,definition=definition)
    row=next(r for r in compare_match(statistics(match,events),value.model_copy(update={'metrics':metrics})).rows if r.metric=='shots')
    assert row.status==expected
    assert (row.delta is None)==(engine=='grf')


def test_short_legacy_grf_episode_is_not_a_full_match_comparison():
    from grf_fixtures import replay_fixture
    from timepitch.historical.comparison import simulation_snapshot
    with pytest.raises(ValueError,match='Unsupported comparison'):
        simulation_snapshot('grf','legacy-fixture',replay_fixture())


def test_comparison_resolves_metric_sides_by_source_key_not_array_position():
    match,events=match_events([]);facts=statistics(match,events)
    home=facts.teams[0].model_copy(update={'metrics':{**facts.teams[0].metrics,'shots':facts.teams[0].metrics['shots'].model_copy(update={'value':2})}})
    away=facts.teams[1].model_copy(update={'metrics':{**facts.teams[1].metrics,'shots':facts.teams[1].metrics['shots'].model_copy(update={'value':7})}})
    result=compare_match(facts.model_copy(update={'teams':[away,home]}),snapshot(),team_keys=(match.home_team.key,match.away_team.key))
    row=next(r for r in result.rows if r.metric=='shots')
    assert row.historical.home==2 and row.historical.away==7


def test_partial_timepitch_replay_is_not_compared_as_a_final_match():
    from timepitch.historical.comparison import simulation_snapshot
    with pytest.raises(ValueError,match='incomplete'):
        simulation_snapshot('timepitch','partial',timepitch_record().model_copy(update={'events':[]}))


def timepitch_record(away='arsenal:2015'):
    from timepitch.simulation.models import MatchRecord,MatchConfig,RenderFrame
    config=MatchConfig(home_key='chelsea:2015',away_key=away,home_players=[f'h{i}' for i in range(11)],away_players=[f'a{i}' for i in range(11)])
    frame=RenderFrame(clock_ms=0,period=1,ball={'x':52.5,'y':34},carrier=None,possession='home',score={},
        players=[{'key':str(i),'name':f'Fixture {i}','role':'MID','side':'home' if i<11 else 'away','x':30,'y':30} for i in range(22)])
    from timepitch.simulation.models import MatchEvent
    final=frame.model_copy(update={'clock_ms':5_400_000,'period':2})
    event=MatchEvent(id='end',t0_ms=5_400_000,t1_ms=5_400_000,type='fulltime',side=None,participants=[],outcome='full_time',evidence={},frame_after=final)
    return MatchRecord(config=config,seed=42,dataset_version='fixture',home_name='Fixture home',away_name='Fixture away',initial_frame=frame,events=[event],metrics={},trace_hash='fixture')


def comparison_client(tmp_path,monkeypatch):
    from timepitch.app import create_app
    from fastapi.testclient import TestClient
    from historical_support import records,write_source
    from historical_analysis_support import event
    from test_historical_import import build
    _,rows=records()
    rows += [event(10,'Half Start'),event(11,'Half End',ms=2_800_000),event(12,'Half Start',period=2),event(13,'Half End',period=2,ms=3_038_204)]
    source=write_source(tmp_path/'source',events=rows);build(source,tmp_path/'dataset')
    monkeypatch.setenv('TIMEPITCH_HISTORICAL_DATASET',str(tmp_path/'dataset'))
    monkeypatch.setenv('TIMEPITCH_RECONSTRUCTION_ENABLED','1');monkeypatch.setenv('TIMEPITCH_LOCAL_MODEL','');monkeypatch.setenv('TIMEPITCH_PUBLIC_ORIGIN','')
    return TestClient(create_app(runtime_dir=tmp_path/'runtime'),base_url='http://127.0.0.1')


def test_comparison_api_checks_replay_owner_and_ordered_club_seasons(tmp_path,monkeypatch):
    from fastapi.testclient import TestClient
    import subprocess
    monkeypatch.setattr(subprocess,'Popen',lambda *a,**k:pytest.fail('No generation in GET'))
    with comparison_client(tmp_path,monkeypatch) as app:
        app.get('/api/matches')
        owner=app.cookies.get('timepitch_session').split('.')[0]
        repository=app.app.state.matches.repository
        def store(record):
            job=repository.create(record.config,owner);repository.start(job.id,owner);repository.finish(job.id,owner,record);return job.id
        id=store(timepitch_record())
        base='/api/historical/matches/3754217/comparison'
        assert app.get(base,params={'engine':'timepitch','simulation_id':'missing'}).status_code==404
        stranger=TestClient(app.app,base_url='http://127.0.0.1')
        try:
            assert stranger.get(base,params={'engine':'timepitch','simulation_id':id}).status_code==404
        finally:stranger.close()
        assert app.get(base,params={'engine':'other','simulation_id':id}).status_code==422
        response=app.get(base,params={'engine':'timepitch','simulation_id':id})
        assert response.status_code==200,response.text
        assert response.json()['lineup_differences']
        mismatch=store(timepitch_record('arsenal:2003'))
        assert app.get(base,params={'engine':'timepitch','simulation_id':mismatch}).status_code==422
        assert app.get('/api/historical/matches/3754217/matchup').json()['exact_xi_available'] is False


def test_corrupt_owned_replay_is_unavailable_without_generating_or_leaking_details(tmp_path,monkeypatch):
    with comparison_client(tmp_path,monkeypatch) as app:
        def corrupt(*args):raise ValueError('Private integrity diagnostic')
        monkeypatch.setattr(app.app.state.matches,'get_match',corrupt)
        response=app.get('/api/historical/matches/3754217/comparison',params={'engine':'timepitch','simulation_id':'corrupt'})
        assert response.status_code==503
        assert 'Private integrity' not in response.text
