"""Compile the versioned defensive observer as a pure C++ component, never GRF."""
import json
import os
from pathlib import Path
import subprocess
import pytest

ROOT=Path(__file__).resolve().parents[2]
PATCH=ROOT/'research/engine-evaluation/2026-10-17-grf-physical-validation/native-defensive-probe.patch'
SOURCE=ROOT/'.local/grf-defense-native/source/src/defensive_observer.hpp'
VCVARS=Path('C:/Program Files (x86)/Microsoft Visual Studio/2017/Community/VC/Auxiliary/Build/vcvarsall.bat')
pytestmark=pytest.mark.skipif(not VCVARS.is_file() and os.getenv('TIMEPITCH_TEST_GRF_DEFENSE_OBSERVER')!='1',
    reason='Pure defensive observer fixture requires the existing VS2017/v141 compiler')


@pytest.fixture(scope='module')
def observer(tmp_path_factory):
    assert VCVARS.is_file(),'Existing VS2017/v141 compiler required'
    assert PATCH.is_file(),'Missing passive defensive observer patch'
    lines=PATCH.read_text(encoding='utf-8').splitlines(keepends=True)
    start=lines.index('+++ b/src/defensive_observer.hpp\n')+1;header=[]
    for line in lines[start:]:
        if line.startswith('--- '):break
        if line.startswith('@@ '):continue
        assert line.startswith('+'),'Expected complete new observer header'
        header.append(line[1:])
    header=''.join(header);assert header
    if SOURCE.exists():assert SOURCE.read_text(encoding='utf-8')==header
    build=tmp_path_factory.mktemp('defensive-observer')
    (build/'defensive_observer.hpp').write_text(header,encoding='utf-8')
    executable=build/'observer.exe'
    fixture=Path(__file__).parent/'fixtures/grf/defensive_observer_fixture.cpp'
    command=(f'call "{VCVARS}" x64 >nul && cl.exe /nologo /std:c++14 /EHsc /W4 '
        f'/I"{build}" "{fixture}" /Fe:"{executable}" /Fo:"{build / "observer.obj"}"')
    result=subprocess.run(f'cmd.exe /d /s /c "{command}"',capture_output=True,timeout=120,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
    assert result.returncode==0,result.stdout.decode(errors='replace')+result.stderr.decode(errors='replace')
    result=subprocess.run([str(executable)],capture_output=True,timeout=10,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
    assert result.returncode==0,result.stderr.decode(errors='replace')
    return json.loads(result.stdout)


def test_disabled_observer_and_outside_windows_do_not_collect(observer):
    assert observer['disabled'] and observer['window_bounds']


def test_cached_evaluation_keeps_its_original_time_and_explicit_unavailable_fields(observer):
    assert observer['stale_time'] and observer['unavailable'] and observer['skipped']


def test_rejected_slide_is_not_selected_and_same_animation_is_not_new_execution(observer):
    assert observer['rejected_slide'] and observer['same_animation']


def test_slide_proposal_attempt_and_selection_survive_later_evaluations_separately(observer):
    assert observer['proposal_survives'] and observer['selected_slide_survives']


def test_reset_and_different_window_clear_old_identities(observer):
    assert observer['reset'] and observer['new_window']


def test_bad_windows_repeated_enable_and_actor_limits_fail_observation(observer):
    assert observer['bad_windows']==5 and observer['double_enable'] and observer['actor_capacity']


def test_nonfinite_and_field_capacity_fail_without_rewriting_existing_record(observer):
    assert observer['nonfinite'] and observer['field_capacity']


def test_snapshot_does_not_consume_or_modify_native_decision_cache(observer):
    assert observer['read_only_snapshot'] and observer['complete_evaluation']


def test_non_eliza_request_does_not_inherit_previous_evaluation_identity(observer):
    assert observer['request_identity']
