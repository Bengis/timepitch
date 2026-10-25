"""Real period API: physical units, restarts and explicit halftime."""
import json
import os
from pathlib import Path
import subprocess
import pytest
from grf_native_helpers import ROOT

pytestmark=pytest.mark.skipif(os.getenv('TIMEPITCH_TEST_GRF_PHYSICAL')!='1',reason='Explicit native acceptance required')


@pytest.mark.parametrize('case',['clock','corner','goal','penalty'])
def test_native_physical_periods_preserve_ticks_waits_and_score(case):
    native=Path(os.getenv('TIMEPITCH_PERIOD_NATIVE_DIR',ROOT/'.local/grf-physical-periods-native/Release'))
    if not native.exists():native=ROOT/'.local/grf-physical-native/Release' # RED against preceding capability
    result=subprocess.run([str(ROOT/'.local/grf-spike/python/python.exe'),'-X','utf8',
        str(Path(__file__).parent/'fixtures/grf/physical_period_fixture.py'),str(native),case],
        capture_output=True,timeout=120,creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
    assert result.returncode==0,result.stderr.decode('utf-8',errors='replace')[-3000:]
    data=json.loads(result.stdout);samples=data['samples']
    assert data['duration_factor']==1
    assert all(b['physics_ms']-a['physics_ms']==100 for a,b in zip(samples,samples[1:]))
    assert all(b['match_time_ms']-a['match_time_ms']==100 for a,b in zip(samples,samples[1:]))
    if case=='clock':
        assert samples[-1]['physics_ms']==samples[-1]['match_time_ms']==10000
        assert all(0<value<=1 for value in data['fatigue'])
    else:
        cause={'corner':'corner','goal':'goal','penalty':'penalty'}[case]
        waiting=[s for s in samples if s['restart_cause']==cause and s['restart_active']]
        assert waiting
        ordinary={'corner':15000,'goal':30000,'penalty':45000}[case]
        assert max(s['physics_ms']-s['restart_start_ms'] for s in waiting)>=ordinary-100
        assert data['halftime']['phase']==2 and data['halftime']['discontinuity']
        assert data['halftime']['physics_ms']==samples[-1]['physics_ms']
        assert data['halftime']['effective_ms']==samples[-1]['effective_ms']
        assert data['halftime']['score']==samples[-1]['score']
