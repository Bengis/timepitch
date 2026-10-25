"""Owned temporal statistics; the tiny stored fixture exercises cutoff, not match physics."""
import pytest
from fastapi.testclient import TestClient
from statistics_fixtures import action,motion
from test_replay_versions import small_v2
from timepitch.app import create_app
from timepitch.simulation.replay_models import ResolvedEvent
from timepitch.simulation.replay import trace_hash

BASE='http://127.0.0.1:8078'


@pytest.fixture
def owned(tmp_path):
    with TestClient(create_app(runtime_dir=tmp_path),base_url=BASE,headers={'Origin':BASE}) as client:
        # Establish the same signed owner as the existing match routes.
        client.get('/api/matches')
        owner=client.cookies['timepitch_session'].split('.')[0]
        record=small_v2()
        record.motion=[motion(0),motion(1800000),motion(1800250),motion(1860000)]
        shooter=record.initial_frame.players[5].key
        event=action('future-shot','shot',start=1859500,end=1860000,participants=[shooter],
                     outcome='goal',simulated_xg=.4).model_copy(update={'sample_index':3,'origin_sample_index':2})
        goal=action('future-goal','goal',start=1860000,end=1860000,participants=[shooter],
                    outcome='scored',related=['future-shot'],shot_id='future-shot').model_copy(update={'sample_index':3,'origin_sample_index':3})
        record.events=[ResolvedEvent(**e.model_dump(exclude={'context_available'})) for e in (event,goal)]
        record.trace_hash=trace_hash(record)
        repo=client.app.state.matches.repository
        job=repo.create(record.config,owner)
        repo.start(job.id,owner);repo.finish(job.id,owner,record)
        yield client,job.id


def test_cutoff_has_no_future_goal_xg_plots_or_evidence(owned):
    client,id=owned
    response=client.get(f'/api/matches/{id}/statistics?end_ms=1800349')
    assert response.status_code==200
    body=response.json()
    assert body['end_ms']==1800250
    assert body['by_team']['home']['simulated_xg']['value']==0
    assert body['by_team']['home']['goals_minus_xg']['value']==0
    assert 'future-shot' not in response.text and 'future-goal' not in response.text
    assert body['plots']['shots']==[]
    final=client.get(f'/api/matches/{id}/statistics?end_ms=1860000').json()
    assert final['by_team']['home']['simulated_xg']['value']==.4


def test_other_owner_and_unknown_match_are_not_visible(owned):
    client,id=owned
    intruder=TestClient(client.app,base_url=BASE)
    try:
        assert intruder.get(f'/api/matches/{id}/statistics?end_ms=1800000').status_code==404
    finally: intruder.close()
    assert client.get('/api/matches/unknown/statistics?end_ms=0').status_code==404


@pytest.mark.parametrize('end',['-1','5400001','1.5','not-a-clock'])
def test_invalid_window_is_rejected(owned,end):
    client,id=owned
    assert client.get(f'/api/matches/{id}/statistics?end_ms={end}').status_code==422
