"""Compile the policy from the versioned patch; never import a football core."""
import json
import os
from pathlib import Path
import subprocess

import pytest

ROOT = Path(__file__).resolve().parents[2]
STUDY = ROOT / 'research/engine-evaluation/2026-10-17-grf-defensive-calibration'
VCVARS = Path('C:/Program Files (x86)/Microsoft Visual Studio/2017/Community/VC/Auxiliary/Build/vcvarsall.bat')


def patch_views():
    patch = STUDY / 'c4-policy.patch'
    assert patch.is_file(), 'C4 defensive policy patch is not implemented'
    views = {}
    for line in patch.read_text(encoding='utf-8').splitlines(keepends=True):
        if line.startswith('+++ b/'):
            name = line[6:].strip()
            views[name] = ''
        elif line.startswith(('--- ', '@@ ')):
            continue
        elif line.startswith(('+', ' ')):
            views[name] += line[1:]
    return views


def function(text, signature):
    start = text.index(signature)
    brace = text.index('{', start)
    depth = 1
    end = brace + 1
    while depth:
        depth += (text[end] == '{') - (text[end] == '}')
        end += 1
    return text[start:end]


@pytest.fixture(scope='module')
def policy(tmp_path_factory):
    assert VCVARS.is_file(), 'The approved PC requires VS2017/v141; no compiler skip'
    build = tmp_path_factory.mktemp('defensive-policy')
    views = patch_views()
    for name in ('defensive_policy.hpp', 'timepitch_policy_config.hpp'):
        (build / name).write_text(views['src/' + name], encoding='utf-8')
    fixture = Path(__file__).parent / 'fixtures/grf/defensive_policy_fixture.cpp'
    exe = build / 'policy.exe'
    command = (f'call "{VCVARS}" x64 >nul && cl.exe /nologo /std:c++14 /EHsc /W4 '
               f'/I"{build}" "{fixture}" /Fe:"{exe}" /Fo:"{build / "policy.obj"}"')
    result = subprocess.run(f'cmd.exe /d /s /c "{command}"', capture_output=True, timeout=120,
                            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    assert result.returncode == 0, result.stdout.decode(errors='replace') + result.stderr.decode(errors='replace')
    return exe


def run(policy, name):
    result = subprocess.run([str(policy), name], capture_output=True, timeout=10,
                            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    assert result.returncode == 0, result.stdout.decode(errors='replace') + result.stderr.decode(errors='replace')
    assert result.stdout.strip() == b'PASS'


def test_marking_floor_and_eligibility_boundaries(policy):
    run(policy, 'marking')


def test_slide_routes_area_and_score_boundaries(policy):
    run(policy, 'slide')


def test_nonfinite_and_out_of_range_inputs_stay_invalid(policy):
    run(policy, 'invalid')


def test_actual_native_slide_hook_preserves_fallbacks(policy):
    template = Path(__file__).parent / 'fixtures/grf/defensive_slide_hook_fixture.cpp'
    assert template.is_file(), 'Missing pure native call-site fixture'
    views = patch_views()
    body = function(views['src/onthepitch/player/controller/playercontroller.cpp'],
                    'void PlayerController::_SlidingCommand(')
    build = policy.parent
    fixture = build / 'slide-hook.cpp'
    fixture.write_text(template.read_text().replace('// NATIVE_SLIDE_FUNCTION', body), encoding='utf-8')
    exe = build / 'slide-hook.exe'
    command = (f'call "{VCVARS}" x64 >nul && cl.exe /nologo /std:c++14 /EHsc /W4 '
               f'/I"{build}" "{fixture}" /Fe:"{exe}" /Fo:"{build / "slide-hook.obj"}"')
    result = subprocess.run(f'cmd.exe /d /s /c "{command}"', capture_output=True, timeout=120,
                            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    assert result.returncode == 0, result.stdout.decode(errors='replace') + result.stderr.decode(errors='replace')
    run(exe, 'slide-hook')


def test_counters_reset_and_snapshots_do_not_mutate(policy):
    run(policy, 'counters')


def test_rejected_sliding_preserves_native_fallback_order():
    views = patch_views()
    controller = views['src/onthepitch/player/controller/playercontroller.cpp']
    slide = function(controller, 'void PlayerController::_SlidingCommand(')
    # The only queue operation remains the original append after the policy gate.
    assert slide.count('commandQueue.') == 1
    assert slide.index('if (!policyDecision.allow) return;') < slide.index('commandQueue.push_back(command);')
    assert slide.count('CouldWinABallDuelLikeliness()') == 1
    assert 'static_cast<float>(team->GetDynamicSide())' in slide
    assert slide.index('ballDist > 0.7f') < slide.index('intervention_policy.Slide(')
    assert slide.index('_oppPlayer->TouchPending()') < slide.index('intervention_policy.Slide(')
    # No change at all in Eliza's caller/queued alternatives or referee.
    assert set(views) == {'src/defensive_policy.hpp', 'src/timepitch_policy_config.hpp',
                          'src/game_env.hpp', 'src/game_env.cpp', 'ai.cpp',
                          'src/onthepitch/player/controller/playercontroller.cpp'}


def test_native_hooks_use_existing_context_and_readonly_getter():
    views = patch_views()
    mark = function(views['src/onthepitch/player/controller/playercontroller.cpp'],
                    'void PlayerController::AddDefensiveComponent(')
    assert mark.count('GetReactionTime_ms()') == 1
    assert mark.count('GetMentalImage(') == 1
    assert 'oppToGoalDistance, bias' in mark
    assert 'opponent->IsActive(), teamHasBestPossession' in mark
    assert mark.index('intervention_policy.Marking(') < mark.index('desiredPosition = desiredPosition * (1.0f - bias)')
    getter = function(views['ai.cpp'], 'bp::dict probe_intervention_state() const')
    for forbidden in ('ContextHolder', 'GetGame', 'GetMatch', 'Drain', 'Step', 'Random', '.Marking(', '.Slide(', '.Reset('):
        assert forbidden not in getter
    assert 'intervention_policy.Snapshot()' in getter
    assert '.def("probe_intervention_state", &GameEnv_Python::probe_intervention_state)' in views['ai.cpp']
    reset = function(views['src/game_env.cpp'], 'void GameEnv::reset(')
    assert reset.count('intervention_policy.Reset();') == 1
    assert reset.index('StartMatch(animations);') < reset.index('intervention_policy.Reset();')
    assert 'timepitch_policy::PolicyState intervention_policy;' in views['src/game_env.hpp']


def test_fixed_config_and_frozen_build_identity():
    views = patch_views()
    assert '"c4-marking-1"' in views['src/timepitch_policy_config.hpp']
    build_path = STUDY / 'c4-build.json'
    assert build_path.is_file(), 'Pure policy precedes compilation; phase completion requires its real build'
    import hashlib
    build = json.loads(build_path.read_text())
    profile = json.loads((STUDY / 'c4-profile.json').read_text())
    assert build['native_binary_sha256'] == profile['native_sha256']
    assert profile['build_manifest_sha256'] == hashlib.sha256(build_path.read_bytes()).hexdigest()
    assert build['patch_sha256'] == hashlib.sha256((STUDY / 'c4-policy.patch').read_bytes()).hexdigest()
    assert profile['policy'] == {'marking_floor': 0.85, 'threat_radius_m': 30.0, 'own_area_duel_floor': 0.70}
    import struct
    assert profile['expected_float32_bits'] == {
        key: struct.unpack('<I', struct.pack('<f', value))[0] for key, value in profile['policy'].items()}
    for name in ('src/defensive_policy.hpp', 'src/timepitch_policy_config.hpp'):
        assert build['source_hashes'][name]['base_sha256_lf'] is None
        assert build['source_hashes'][name]['sha256_lf'] == hashlib.sha256(views[name].encode()).hexdigest()
    assert build['previous_native_binary_sha256'] == '58c6c3ff43ae37ecad3519cc77d3ebcbc7039bc8ff02e0c3ba56b7463e4d6633'
    assert build['public_admission'] is False and profile['native_runtime_verified'] is False
    assert len(build['dependencies']) == 14
    assert build['native_match_attempts'] == build['core_creations'] == 0
    local = ROOT / build['binary_output']
    if local.exists():
        assert hashlib.sha256((local / '_gameplayfootball.pyd').read_bytes()).hexdigest() == profile['native_sha256']
        assert {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in local.glob('*.dll')} == build['dependencies']
