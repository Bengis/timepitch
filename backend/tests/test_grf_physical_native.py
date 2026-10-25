"""Physical stepping is tested against the real native engine, not mocks."""
import json
import os
from pathlib import Path
import subprocess
from functools import lru_cache
import pytest
from grf_native_helpers import ROOT,run_native_input
from grf_statistics_fixtures import statistics_request

pytestmark=pytest.mark.skipif(os.getenv('TIMEPITCH_TEST_GRF_PHYSICAL')!='1',reason='Explicit physical native acceptance required')
NATIVE=Path(os.getenv('TIMEPITCH_PHYSICAL_NATIVE_DIR',ROOT/'.local/grf-physical-native/Release'))


@lru_cache
def physical_case(case):
    assert (NATIVE/'_gameplayfootball.pyd').is_file(), 'Prepared native binary required'
    request=statistics_request().model_dump_json().encode('utf-8') if case=='clock' else b''
    result=subprocess.run([str(ROOT/'.local/grf-spike/python/python.exe'),'-X','utf8',
        str(Path(__file__).parent/'fixtures/grf/physical_native_fixture.py'),str(NATIVE),case],
        input=request,capture_output=True,timeout=120,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
    assert result.returncode==0,result.stderr.decode('utf-8',errors='replace')[-3000:]
    assert len(result.stdout)<8*1024*1024
    return json.loads(result.stdout)


def test_physics_clock_advances_100_ms():
    result=physical_case('clock');samples=result['samples']
    assert samples[0]['physics_ms']==0
    assert [s['physics_ms'] for s in samples]==list(range(0,3100,100))
    assert all(0<=b['effective_ms']-a['effective_ms']<=100 for a,b in zip(samples,samples[1:]))
    assert len(result['readbacks'])==66
    live=[(a,b) for a,b in zip(samples,samples[1:]) if a['in_play'] and b['in_play'] and not a['set_piece'] and not b['set_piece']]
    assert live
    assert all(b['effective_ms']-a['effective_ms']==100 for a,b in live)
    assert result['reset']['physics_ms']==result['reset']['effective_ms']==0
    assert all(len(s['home_xy'])==len(s['away_xy'])==11 for s in samples)


def test_fixed_step_observes_dead_ball():
    samples=physical_case('restart')['samples']
    stopped=[s for s in samples if not s['in_play']]
    assert stopped, 'Wrapper must not skip all dead-ball observations'
    assert all(b['physics_ms']-a['physics_ms']==100 for a,b in zip(samples,samples[1:]))
    assert all(b['actual_time_ms']-a['actual_time_ms']==100 for a,b in zip(samples,samples[1:]))
    incidents=[s for s in stopped if s['restart_cause']=='corner']
    assert incidents and all(s['restart_id']>0 for s in incidents)
    assert len({s['restart_id'] for s in incidents})<len(incidents)
    paused=[(a,b) for a,b in zip(samples,samples[1:]) if not a['in_play'] and not b['in_play']]
    pending=[(a,b) for a,b in zip(samples,samples[1:]) if a['in_play'] and b['in_play'] and a['set_piece'] and b['set_piece']]
    assert paused and pending
    assert all(b['effective_ms']==a['effective_ms'] for a,b in paused+pending)


def test_restart_discontinuity_not_movement():
    samples=physical_case('restart')['samples']
    relocations=[s for s in samples[1:] if s['discontinuity']]
    assert relocations, 'Native ResetSituation must be explicit'
    assert all(s['relocation_id']>0 for s in relocations)
    assert all(len(s['home_active'])==len(s['home_xy']) for s in samples)
    assert all(s['attack_direction'] in ([1,-1],[-1,1]) for s in samples)
    assert all(not s['segment_eligible'] for s in relocations)
    for a,b in zip(samples,samples[1:]):
        if b['relocation_id']!=a['relocation_id']:
            assert b['discontinuity'] and not b['segment_eligible']


def test_instrumentation_preserves_compressed_observations():
    request=statistics_request()
    old=run_native_input(request,ROOT/'.local/grf-stats-native/Release')
    new=run_native_input(request,NATIVE)
    assert new['samples']==old['samples']
    assert new['telemetry']==old['telemetry']
    assert new['attribute_readbacks']==old['attribute_readbacks']
    assert new['duration_ms']==old['duration_ms']


def test_restart_identity_is_current_at_every_tick_alignment():
    for offset in range(10):
        samples=physical_case(f'boundary_{offset}')['samples']
        transitions=[(a,b) for a,b in zip(samples,samples[1:]) if a['in_play'] and not b['in_play']]
        assert transitions
        for a,b in transitions:
            assert b['restart_id']>a['restart_id'], (offset,b)
            assert b['restart_cause']=='corner', (offset,b)


def test_physical_run_repeats_in_independent_processes():
    first=physical_case('restart')
    physical_case.cache_clear()
    assert physical_case('restart')==first
