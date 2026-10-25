import os,threading
import pytest
from grf_fixtures import DATASET
from grf_statistics_fixtures import statistics_request
from timepitch.grf.process import GrfProcess
from timepitch.config import GRF_PYTHON,GRF_NATIVE_DIR
from timepitch.grf.statistics import build_grf_statistics
from grf_native_helpers import ROOT,run_native_input

pytestmark=pytest.mark.skipif(os.getenv('TIMEPITCH_TEST_GRF')!='1',reason='Explicit GRF native acceptance not requested')


def test_real_native_selected_players_attributes_seed_and_repeat():
    runner=GrfProcess(GRF_PYTHON,GRF_NATIVE_DIR)
    if not runner.capability().available:pytest.skip('GRF native runtime unavailable')
    before=DATASET.stat().st_mtime_ns
    request=statistics_request()
    try:
        first=runner.run(request,threading.Event())
        repeat=runner.run(request,threading.Event())
        assert first.trace_hash==repeat.trace_hash
        assert first.telemetry.events==repeat.telemetry.events and first.telemetry.events
        assert build_grf_statistics(first)==build_grf_statistics(repeat)
        assert len(build_grf_statistics(first).goals)==sum(first.samples[-1].score)
        assert len(first.attribute_readbacks)==66
        assert first.samples[0].engine_step==-1 and first.samples[-1].engine_step<4200
        assert first.samples[-1].match_time_ms>=5400000
        assert {s.phase for s in first.samples}=={1,2}
        assert first.samples[first.halftime_sample_index].phase==2
        assert first.completion_reason=='full_time'
        assert first.input.config==request.config
        from timepitch.grf.input import make_statistics_input
        from timepitch.catalog.repository import CatalogRepository
        other=make_statistics_input(request.config.model_copy(update={'seed':43}),CatalogRepository(DATASET))
        changed=runner.run(other,threading.Event())
        assert changed.input.config.seed==43 and changed.trace_hash!=first.trace_hash
        assert changed.samples!=first.samples
        from timepitch.grf.input import make_full_match_input
        old_request=make_full_match_input(request.config,CatalogRepository(DATASET))
        old=run_native_input(old_request,ROOT/'.local/grf-match-native/Release')
        disabled=run_native_input(old_request,GRF_NATIVE_DIR)
        extra={'home_active','away_active','attack_direction'}
        common=[s.model_dump(mode='json',exclude=extra) for s in first.samples]
        assert old['samples']==common==disabled['samples'], 'Telemetry changed native gameplay observations'
        assert DATASET.stat().st_mtime_ns==before
    finally:runner.close()
