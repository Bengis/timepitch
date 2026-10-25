"""Pure M1 fixture: no engine, native import or simulated football match."""
from copy import deepcopy
import hashlib
import json
import os
import re
from pathlib import Path
import subprocess

import pytest

ROOT = Path(__file__).resolve().parents[2]
STUDY = ROOT / 'research/engine-evaluation/2026-10-18-grf-priority-continuity'
HEADER = STUDY / 'native/marking_continuity.hpp'
FIXTURE = ROOT / 'backend/tests/fixtures/grf/marking_continuity_fixture.cpp'
BOOST = ROOT / '.local/grf-native/build-v141/vcpkg_installed/x64-windows/include'
VCVARS = Path('C:/Program Files (x86)/Microsoft Visual Studio/2017/Community/VC/Auxiliary/Build/vcvarsall.bat')
COMPILER = Path('C:/Program Files (x86)/Microsoft Visual Studio/2017/Community/VC/Tools/MSVC/14.16.27023/bin/Hostx64/x64/cl.exe')


def sha(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def compile_fixture():
    """Only a standalone executable, versioned by header+fixture source bytes."""
    assert HEADER.is_file() and FIXTURE.is_file(), 'Missing pure marking policy/JSON fixture'
    prior_compiler = json.loads((ROOT / 'research/engine-evaluation/2026-10-18-grf-defensive-coordination/k1-replay-build.json').read_bytes())
    assert sha(COMPILER) == prior_compiler['compiler_sha256'], 'Existing approved v141 compiler changed'
    source_hash = hashlib.sha256(HEADER.read_bytes() + FIXTURE.read_bytes()).hexdigest()
    folder = ROOT / '.local/grf-priority-continuity-native/provenance/pure' / source_hash[:16]
    folder.mkdir(parents=True, exist_ok=True)
    executable = folder / 'marking.exe'; manifest = folder / 'build.json'
    if manifest.exists():
        value = json.loads(manifest.read_bytes())
        assert value['source_hash'] == source_hash and value['executable_sha256'] == sha(executable)
        for name, expected in value['include_sha256'].items(): assert sha(name) == expected
        return executable
    command = ('call "' + str(VCVARS) + '" x64 >nul && cl.exe /nologo /std:c++14 /EHsc /O2 /MD '
        '/fp:precise /W4 /WX /showIncludes /DBOOST_BIND_GLOBAL_PLACEHOLDERS '
        '/I"' + str(HEADER.parent) + '" /I"' + str(BOOST) + '" "' + str(FIXTURE) +
        '" /Fe:"' + str(executable) + '" /Fo:"' + str(folder / 'marking.obj') + '"')
    env = dict(os.environ, VSLANG='1033')
    if (folder / 'compile.log').exists():
        for index in range(1, 100):
            previous = folder / ('failed-compile-' + str(index) + '.log')
            if not previous.exists():
                with previous.open('xb') as f: f.write((folder / 'compile.log').read_bytes())
                break
    if executable.exists():
        partial = folder / ('unregistered-' + sha(executable) + '.exe')
        if not partial.exists():
            with partial.open('xb') as f: f.write(executable.read_bytes())
    build = subprocess.run('cmd.exe /d /s /c "' + command + '"', cwd=folder, capture_output=True, timeout=90, env=env)
    (folder / 'compile.log').write_bytes(build.stdout + build.stderr)
    assert build.returncode == 0, (build.stdout + build.stderr).decode(errors='replace')[-6000:]
    includes = {}
    for line in (build.stdout + build.stderr).decode('cp1252', errors='replace').splitlines():
        if line.startswith(('Note:', 'Nota:')):
            match = re.search(r'[A-Za-z]:[\\/].*', line)
            if match is None: continue
            path = Path(match.group()).resolve()
            includes[str(path)] = sha(path)
    assert includes and str(HEADER.resolve()) in includes
    assert not any('gfootball_engine' in n or n.endswith('game_env.hpp') for n in includes)
    dep_command = 'call "' + str(VCVARS) + '" x64 >nul && dumpbin.exe /DEPENDENTS "' + str(executable) + '"'
    dep = subprocess.run('cmd.exe /d /s /c "' + dep_command + '"', capture_output=True, timeout=30, env=env)
    (folder / 'dependencies.log').write_bytes(dep.stdout + dep.stderr)
    assert dep.returncode == 0
    assert not any(word in dep.stdout.lower() for word in (b'gameplayfootball', b'boost_python', b'sdl'))
    value = dict(schema_version='grf-marking-pure-build-1', source_hash=source_hash,
        source_sha256={str(HEADER.relative_to(ROOT)): sha(HEADER), str(FIXTURE.relative_to(ROOT)): sha(FIXTURE)},
        executable=str(executable.relative_to(ROOT)), executable_sha256=sha(executable),
        include_sha256=includes, command=command, compile_log_sha256=sha(folder / 'compile.log'),
        dependencies_log_sha256=sha(folder / 'dependencies.log'), exit_code=0,
        native_imported=False, native_core_created=False)
    manifest.write_bytes((json.dumps(value, indent=2, ensure_ascii=False) + '\n').encode('utf-8'))
    return executable


@pytest.fixture(scope='module')
def policy():
    return compile_fixture() if HEADER.is_file() and FIXTURE.is_file() else None


def scenario():
    players = [dict(id=i, team=0 if i < 100 else 1, active=True, keeper=i == 0,
                    manual=False, ball_contest=False, position=xy)
               for i, xy in [(0, [-54, 0]), (1, [2, 0]), (2, [7, 0]), (3, [10, 0]),
                             (100, [0, 0]), (101, [10, 5]), (102, [15, 5])]]
    x = dict(time_ms=1000, team=0, period=1, relocation_id=0, dynamic_side=-1,
             guard_eligible=True, own_ids=[0, 1, 2, 3], players=players, threat_ids=[100],
             quality=[[1], [.1], [.9], [.2]], actual_prior_marks=[dict(owner=1, target=100)])
    context = dict(initialized=True, team=0, period=1, relocation_id=0, dynamic_side=-1, eligible=True)
    return dict(input=x, context=context)


def run(policy, request, *, raw=None):
    assert policy is not None, 'Missing pure marking policy/JSON fixture'
    body = raw if raw is not None else json.dumps(request, allow_nan=True).encode()
    result = subprocess.run([str(policy)], input=body, capture_output=True, timeout=5,
                            creationflags=subprocess.CREATE_NO_WINDOW)
    assert result.returncode == 0, result.stderr.decode(errors='replace')
    assert len(result.stdout) <= 65536
    return json.loads(result.stdout, parse_constant=lambda _: pytest.fail('Nonfinite result'))


def at(request, id): return next(p for p in request['input']['players'] if p['id'] == id)


def native_request(tx, context=None):
    """One observed snapshot; caller must supply witnessed context or use reference_only."""
    x = tx['input']; own = [(i, p) for i, p in enumerate(p for p in x['players'] if p['team'] == x['team']) if p['active']]
    result = dict(input=dict(time_ms=x['time_ms'], team=x['team'], period=x['period'],
        relocation_id=tx['relocation_id'], dynamic_side=x['dynamic_side'],
        guard_eligible=x['play_eligible'] and x['defending'], own_ids=[p['id'] for _, p in own],
        players=[{k: p[k] for k in ('id', 'team', 'active', 'keeper', 'manual', 'ball_contest', 'position')} for p in x['players']],
        threat_ids=x['threat_ids'], quality=[x['quality'][i] for i, _ in own], actual_prior_marks=tx['actual_prior_marks']))
    if context is not None: result['context'] = context
    return result


def test_cold_kompany_henry_returns_14_to_9(policy):
    from test_grf_marking_audit import transaction
    r = native_request(transaction(), dict(initialized=False, team=-1, period=0, relocation_id=0, dynamic_side=0, eligible=False))
    d = run(policy, r)
    assert d['valid'] and [14, 9] in d['pairs'] and [18, 9] not in d['pairs']
    assert d['pairs'] == d['reference_pairs']


@pytest.mark.parametrize('old,new,want', [(2, 6.001, 1), (2.0001, 7, 2), (2, 6, 2)])
def test_guard_boundaries(policy, old, new, want):
    r = scenario(); at(r, 1)['position'] = [old, 0]; at(r, 2)['position'] = [new, 0]
    before = deepcopy(r); d = run(policy, r)
    assert d['valid'] and d['reference_pairs'] == [[2, 100]] and d['pairs'] == [[want, 100]]
    assert r == before


@pytest.mark.parametrize('field', ['manual', 'ball_contest'])
@pytest.mark.parametrize('actor', [1, 2])
def test_override_actors_keep_c4_pool_but_disable_guard(policy, actor, field):
    r = scenario(); at(r, actor)[field] = True
    d = run(policy, r); assert d['valid'] and d['pairs'] == d['reference_pairs'] == [[2, 100]]


@pytest.mark.parametrize('reset', ['cold', 'period', 'side', 'relocation', 'previous_ineligible', 'guard_disabled'])
def test_context_reset_or_disabled_is_exact_c4(policy, reset):
    r = scenario()
    if reset == 'cold': r['context'] = dict(initialized=False, team=-1, period=0, relocation_id=0, dynamic_side=0, eligible=False)
    elif reset == 'period': r['input']['period'] = 2
    elif reset == 'side': r['input']['dynamic_side'] = 1
    elif reset == 'relocation': r['input']['relocation_id'] = 1
    elif reset == 'previous_ineligible': r['context']['eligible'] = False
    else: r['input']['guard_eligible'] = False
    d = run(policy, r); assert d['valid'] and d['pairs'] == d['reference_pairs'] == [[2, 100]]


def test_prior_owner_cannot_be_reclaimed_from_higher_threat(policy):
    r = scenario(); x = r['input']; x['threat_ids'] = [100, 101]
    x['quality'] = [[1, 1], [.9, .1], [.1, .9], [0, 0]]
    at(r, 101)['position'] = [0, 0]; x['actual_prior_marks'] = [dict(owner=1, target=101)]
    d = run(policy, r); assert d['valid'] and d['pairs'] == [[1, 100], [2, 101]]
    assert any(reason['code'] == 'owner_consumed' for reason in d['reasons'])


def test_guard_reports_downstream_change_without_global_optimization(policy):
    r = scenario(); x = r['input']; x['threat_ids'] = [100, 101]
    x['quality'] = [[1, 1], [.1, .9], [.9, .1], [0, 0]]
    d = run(policy, r)
    assert d['valid'] and d['reference_pairs'] == [[2, 100], [1, 101]]
    assert d['pairs'] == [[1, 100], [2, 101]]


def test_native_ties_use_own_id_order_and_opponent_keeper_is_retained(policy):
    r = scenario(); x = r['input']; x['own_ids'] = [0, 2, 1, 3]
    x['quality'] = [[1], [.5], [.5], [.5]]; x['actual_prior_marks'] = []
    at(r, 100)['keeper'] = True
    d = run(policy, r); assert d['valid'] and d['pairs'] == [[2, 100]]
    assert run(policy, r) == d


def test_fewer_available_players_assigns_prefix(policy):
    r = scenario(); x = r['input']; x['own_ids'] = [0, 1]; x['threat_ids'] = [100, 101, 102]
    at(r, 2)['active'] = at(r, 3)['active'] = False
    x['quality'] = [[1, 1, 1], [.5, .5, .5]]; x['actual_prior_marks'] = []
    d = run(policy, r); assert d['valid'] and d['pairs'] == [[1, 100]]


def test_inactive_previous_owner_and_no_blanket_hold(policy):
    r = scenario(); at(r, 1)['active'] = False
    r['input']['own_ids'] = [0, 2, 3]; r['input']['quality'] = [[1], [.9], [.2]]
    assert run(policy, r)['pairs'] == [[2, 100]]
    r = scenario(); r['input']['time_ms'] = 1001; at(r, 1)['position'] = [2.1, 0]
    assert run(policy, r)['pairs'] == [[2, 100]]


def test_mirror_equivalence(policy):
    r = scenario(); first = run(policy, r)
    r['input']['dynamic_side'] = r['context']['dynamic_side'] = 1
    for p in r['input']['players']: p['position'] = [-v for v in p['position']]
    d = run(policy, r); assert d['valid'] and d['pairs'] == first['pairs']


@pytest.mark.parametrize('bad', ['ids', 'own_ids', 'qshape', 'nonfinite', 'wrong_team', 'prior_duplicate', 'missing_prior', 'context_team'])
def test_incoherent_input_fails_without_pairs(policy, bad):
    r = scenario(); x = r['input']
    if bad == 'ids': x['players'][1]['id'] = 0
    elif bad == 'own_ids': x['own_ids'][1] = 0
    elif bad == 'qshape': x['quality'][1] = []
    elif bad == 'nonfinite': x['quality'][1][0] = float('nan')
    elif bad == 'wrong_team': at(r, 100)['team'] = 0
    elif bad == 'prior_duplicate': x['actual_prior_marks'].append(dict(owner=1, target=101))
    elif bad == 'missing_prior': x.pop('actual_prior_marks')
    else: r['context']['team'] = 1
    d = run(policy, r); assert not d['valid'] and d['pairs'] == []


@pytest.mark.parametrize('body', [b'{' * 70000, b'{"input":{}}', b'[' * 40 + b']' * 40], ids=['oversize', 'missing-fields', 'deep'])
def test_bounded_invalid_json(policy, body):
    d = run(policy, {}, raw=body); assert not d['valid'] and d['pairs'] == []


def test_reference_only_does_not_invent_missing_context(policy):
    r = scenario(); r.pop('context'); r['reference_only'] = True
    d = run(policy, r); assert d['valid'] and d['pairs'] == d['reference_pairs'] == [[2, 100]]
    r.pop('reference_only'); assert not run(policy, r)['valid']
