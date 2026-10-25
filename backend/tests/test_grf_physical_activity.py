"""Opt-in tests exercise the same native activity policy used by real players."""
import json,os,subprocess
from pathlib import Path
import pytest
from grf_native_helpers import ROOT


@pytest.mark.skipif(os.getenv('TIMEPITCH_TEST_GRF_PHYSICAL')!='1',reason='Explicit native acceptance required')
def test_native_activity_rest_walk_hysteresis_and_urgent_exit():
    native=ROOT/'.local/grf-activity-native/Release'
    if not native.exists():native=ROOT/'.local/grf-physical-periods-native/Release'
    result=subprocess.run([str(ROOT/'.local/grf-spike/python/python.exe'),'-X','utf8',
        str(Path(__file__).parent/'fixtures/grf/physical_activity_fixture.py'),str(native)],capture_output=True,
        timeout=120,creationflags=subprocess.CREATE_NO_WINDOW)
    assert result.returncode==0,result.stderr.decode(errors='replace')[-3000:]
    data=json.loads(result.stdout)
    assert data['decisions'][0]=={'state':0,'velocity':6.0}
    assert data['decisions'][1]=={'state':0,'velocity':6.0}
    assert data['decisions'][2]=={'state':1,'velocity':0.0}
    assert data['decisions'][3]['state']==2 and data['decisions'][3]['velocity']==pytest.approx(2.2)
    assert data['decisions'][4]=={'state':3,'velocity':6.0}
    assert data['decisions'][5]=={'state':0,'velocity':6.0}
    assert data['decisions'][6]=={'state':0,'velocity':6.0}
    assert data['decisions'][7]=={'state':0,'velocity':6.0}
    assert data['unchanged_compressed'] and data['observed_activity']
    assert data['fatigue_decreased']
