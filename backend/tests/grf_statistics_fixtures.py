"""Synthetic statistics protocol fixtures, never native acceptance."""
from grf_fixtures import full_replay,full_request,DATASET
from timepitch.catalog.repository import CatalogRepository
from timepitch.grf.input import make_statistics_input
from timepitch.grf.models import GrfStatisticsReplay,GrfStatisticsSample,STATS_NATIVE_SHA256
from timepitch.grf.codec import grf_hash


def statistics_request(mirror=False):
    config=full_request().config
    if mirror:
        from grf_fixtures import request_fixture
        config=request_fixture(mirror=True).config
    return make_statistics_input(config,CatalogRepository(DATASET))


def native_event(seq=0,sample_index=2,**updates):
    value=dict(seq=seq,sample_index=sample_index,type='touch',kind='short_pass',stage='',team=0,actor_team=0,player=9,
        action_id=1,incident_id=0,function=1,touch_type=0,actual_time_ms=2100,match_time_ms=1800,phase=1,
        in_play=True,set_piece=False,own_goal=False,mirrored=False,ball_mirrored=False,
        actor_xy=[0.,0.],ball_xyz=[0.,0.,.1],raw_actor_xy=[0.,0.],raw_ball_xyz=[0.,0.,.1],
        score=[0,0],attack_direction=[1,-1],victim_team=-1,victim_player=-1)
    value.update(updates);return value


def statistics_replay(events=None,mirror=False,request=None):
    request=request or statistics_request(mirror)
    old=full_replay(request)
    # Correct readbacks for either side-scoped catalogue fixture.
    readbacks=[dict(side=p.side,slot=p.slot,attribute=k,base=v,effective=v) for p in request.players for k,v in p.attributes.items()]
    record=GrfStatisticsReplay(**{**old.model_dump(exclude={'schema_version','engine_version','input','native_binary_sha256','samples','trace_hash','attribute_readbacks'}),
        'input':request,'native_binary_sha256':STATS_NATIVE_SHA256,'attribute_readbacks':readbacks,
        'samples':[GrfStatisticsSample(**s.model_dump(),home_active=[True]*11,away_active=[True]*11,attack_direction=(1,-1)) for s in old.samples],
        'telemetry':dict(version='grf-native-events-1',events=events or [],emitted_count=len(events or []),overflowed=False)})
    record.trace_hash=grf_hash(record);return record
