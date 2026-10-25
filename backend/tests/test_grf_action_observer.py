"""Exercise the production observer header without starting a GRF environment."""
import json
import os
from pathlib import Path
import subprocess

import pytest

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / '.local/grf-native/source/gfootball-2.10.2/third_party/gfootball_engine/src'
VCVARS = Path('C:/Program Files (x86)/Microsoft Visual Studio/2017/Community/VC/Auxiliary/Build/vcvarsall.bat')
PATCH = ROOT / 'research/engine-evaluation/2026-10-17-grf-actions/native-actions.patch'
pytestmark = pytest.mark.skipif(not VCVARS.is_file() and os.getenv('TIMEPITCH_TEST_GRF_ACTION_OBSERVER') != '1',
                                reason='Pure observer fixture requires the existing VS2017/v141 compiler')


@pytest.fixture(scope='module')
def observer(tmp_path_factory):
    assert VCVARS.is_file(), 'The existing VS2017/v141 toolchain is required'
    build = tmp_path_factory.mktemp('action-observer')
    assert PATCH.is_file(), 'Native action observer patch is not implemented'
    lines = PATCH.read_text(encoding='utf-8').splitlines(keepends=True)
    begin = lines.index('+++ b/src/action_observation.hpp\n') + 1
    source = []
    for line in lines[begin:]:
        if line.startswith('--- '): break
        if line.startswith('@@ '): continue
        assert line.startswith('+'), 'Expected a new observer header in the reproducible patch'
        source.append(line[1:])
    header = ''.join(source)
    assert header, 'Missing observer implementation'
    working = SOURCE / 'action_observation.hpp'
    if working.is_file():
        assert working.read_text(encoding='utf-8') == header, 'Native source differs from its versioned observer patch'
    (build / 'action_observation.hpp').write_text(header, encoding='utf-8')
    fixture = Path(__file__).parent / 'fixtures/grf/action_observer_fixture.cpp'
    executable = build / 'observer.exe'
    command = (f'call "{VCVARS}" x64 >nul && cl.exe /nologo /std:c++14 /EHsc /W4 '
               f'/I"{build}" "{fixture}" /Fe:"{executable}" /Fo:"{build / "observer.obj"}"')
    result = subprocess.run(f'cmd.exe /d /s /c "{command}"', capture_output=True, timeout=120,
                            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    assert result.returncode == 0, result.stdout.decode(errors='replace') + result.stderr.decode(errors='replace')
    result = subprocess.run([str(executable)], capture_output=True, timeout=10,
                            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    assert result.returncode == 0, result.stderr.decode(errors='replace')
    return json.loads(result.stdout)


def test_only_successful_new_animation_binds_selected_command_origin(observer):
    assert observer['rejected_keeps_pass'] and observer['unchanged_animation_keeps_pass']
    assert observer['external_animation_unknown'] and observer['other_actor_unknown']


def test_all_emergency_alternatives_are_clearances(observer):
    assert observer['emergency_clearances'] == 3


def test_repeated_retention_does_not_create_passes_and_hand_release_is_retained(observer):
    assert observer['retained_roles'] == 24
    assert observer['releases'] == 1
    assert observer['retention_starts'] == observer['retention_ends'] == 1
    assert observer['release_before_end'] and observer['hand_release_is_pass']
    assert observer['drain_preserves_identity']


def test_unknown_release_control_deflection_and_accidental_remain_distinct(observer):
    assert observer['unknown_release'] and observer['role_mapping']
    assert observer['non_contact_role']


def test_duplicate_release_invalid_actor_and_bad_raw_sequence_fail_capture(observer):
    assert observer['duplicate_overflow'] and observer['invalid_actor_overflow']
    assert observer['raw_sequence_overflow']


def test_combined_raw_semantic_budget_and_request_limit_are_enforced(observer):
    assert observer['exact_combined_limit'] and observer['combined_overflow']
    assert observer['sixty_four_allowed'] and observer['sixty_five_overflow']


def test_disabled_capture_reset_and_retainer_transfer_do_not_leak_state(observer):
    assert observer['disabled_empty'] and observer['reset_disables']
    assert observer['transfer_closes_old'] and observer['reset_reason']
