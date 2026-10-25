import importlib

from historical_analysis_support import event, game
from timepitch.historical.participation import build_participation


def extract(match,events):
    return importlib.import_module('timepitch.reconstruction.anchors').extract_anchors(match,events,build_participation(match,events))


def test_failed_pass_endpoint_is_a_ball_anchor_never_an_invented_recipient():
    match,events=game([event(30,'Pass',ms=622,player=101,location=[60,40],duration=.4,
                             **{'pass':{'recipient':{'id':102},'end_location':[72,40],'outcome':{'name':'Incomplete'}}})],ends=(2_000,2_000))
    anchors=extract(match,events).items
    assert any(a.entity_key=='ball' and a.period_ms==1022 and a.location.x==63 for a in anchors)
    assert not any(a.entity_key=='statsbomb:102' for a in anchors)
    assert any(a.entity_key=='statsbomb:101' and a.period_ms==622 for a in anchors)


def test_unknown_duration_keeps_endpoint_insufficient_without_inventing_time():
    match,events=game([event(30,'Pass',ms=622,player=101,location=[60,40],
                             **{'pass':{'end_location':[72,40]}})],ends=(2_000,2_000))
    end=next(a for a in extract(match,events).items if a.id.endswith(':ball:end'))
    assert end.period_ms is None and end.status=='insufficient'
    assert end.reason=='missing_usable_duration'


def test_pressure_is_actor_observation_not_a_ball_observation():
    match,events=game([event(30,'Pressure',ms=622,player=101,location=[60,40])],ends=(2_000,2_000))
    anchors=extract(match,events).items
    assert len(anchors)==1 and anchors[0].entity_key=='statsbomb:101'


def test_inactive_actor_and_outside_half_preserve_conflicting_evidence():
    match,events=game([event(29,'Bad Behaviour',ms=500,player=101,bad_behaviour={'card':{'name':'Red Card'}}),
                       event(30,'Pass',ms=622,player=101,location=[60,40],**{'pass':{}}),
                       event(31,'Pass',ms=2_100,player=102,location=[60,40],**{'pass':{}})],ends=(2_000,2_000))
    anchors=extract(match,events).items
    assert next(a for a in anchors if a.id.endswith('001e:actor')).status=='conflict'
    assert all(a.status=='conflict' for a in anchors if a.event_id.endswith('001f'))
