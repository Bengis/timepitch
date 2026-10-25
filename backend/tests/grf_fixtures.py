"""Synthetic protocol fixtures. These are not GRF match acceptance."""
from pathlib import Path
from timepitch.catalog.repository import CatalogRepository
from timepitch.simulation.engine import make_config

DATASET = Path(__file__).resolve().parents[2] / 'research/data-audit/2026-10-16/derived/coverage.sqlite'


def request_fixture(mirror=False):
    from timepitch.grf.input import make_grf_input
    catalog = CatalogRepository(DATASET)
    config = make_config(catalog, 'arsenal:2003', 'arsenal:2003' if mirror else 'mancity:2017', 42)
    return make_grf_input(config, catalog)


def replay_fixture(request=None):
    from timepitch.grf.models import GrfReplay, NATIVE_SHA256
    from timepitch.grf.codec import grf_hash
    request = request or request_fixture()
    samples = [dict(index=i, engine_step=step, score=[0, 0], owner_team=0, owner_slot=9,
                    game_mode=0, home_xy=[[-.5 + j*.04, .1] for j in range(11)],
                    away_xy=[[.5-j*.04, -.1] for j in range(11)], ball_xyz=[0., 0., .1])
               for i, step in enumerate((-1, 0, 3000))]
    readbacks = [dict(side=p.side, slot=p.slot, attribute=name, base=value, effective=value)
                 for p in request.players for name, value in p.attributes.items()]
    replay = GrfReplay(input=request, native_binary_sha256=NATIVE_SHA256,
                       attribute_readbacks=readbacks, duration_ms=200, samples=samples)
    replay.trace_hash = grf_hash(replay)
    return replay


# Synthetic full-match observations for service/contract tests, never native acceptance.
from timepitch.grf.input import make_full_match_input
from timepitch.grf.models import GrfFullMatchReplay,GrfMatchSample,MATCH_NATIVE_SHA256
from timepitch.grf.codec import grf_hash

def full_request():
    return make_full_match_input(request_fixture().config,CatalogRepository(DATASET))


def full_replay(request=None):
    request=request or full_request()
    base=replay_fixture()
    samples=[]
    for index in range(3003):
        step=index-1
        samples.append(GrfMatchSample(**{**base.samples[0].model_dump(),'index':index,'engine_step':step},
            match_time_ms=max(0,step)*1800,actual_time_ms=1900+index*100,
            phase=1 if step<1500 else 2,in_play=True,set_piece=False))
    record=GrfFullMatchReplay(input=request,native_binary_sha256=MATCH_NATIVE_SHA256,
        attribute_readbacks=base.attribute_readbacks,duration_ms=(len(samples)-1)*100,
        steps_left=4200-samples[-1].engine_step,samples=samples,halftime_sample_index=1501)
    record.trace_hash=grf_hash(record)
    return record
