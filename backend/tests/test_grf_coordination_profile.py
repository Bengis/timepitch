"""Offline integration and fixed research profile; never imports football."""
import copy
import importlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess

import pytest
from test_grf_action_gates import rows
from timepitch.grf.action_gates import evaluate_action_gates

ROOT=Path(__file__).resolve().parents[2]
STUDY=ROOT/'research/engine-evaluation/2026-10-18-grf-defensive-coordination'


def api():
    name='timepitch.grf.coordination_profile'
    assert importlib.util.find_spec(name),'Missing frozen coordination profile'
    return importlib.import_module(name)


def test_default_rejects_k1():
    assert not any(evaluate_action_gates(rows(candidate='k1'),expected=8).values())


def test_k1_does_not_require_c5_area_rejection():
    result=evaluate_action_gates(rows(candidate='k1'),expected=8,_research_candidate_id='k1')
    assert all(result.values())
    changed=rows(candidate='k1');changed[0]['policy_counters']['area_slide_rejected']=1
    assert not evaluate_action_gates(changed,expected=8,_research_candidate_id='k1')['policy']


def test_old_c4_c5_gate_outputs_unchanged():
    for candidate in ('c4','c5'):
        values=rows(candidate=candidate)
        assert evaluate_action_gates(values,expected=8)==evaluate_action_gates(values,expected=8,_research_candidate_id=None)
    with pytest.raises(ValueError):
        evaluate_action_gates(rows(),expected=8,_research_candidate_id='c6')


def test_coordination_counters_cannot_replace_base_policy():
    values=rows(candidate='k1')
    for r in values:
        r['coordination_counters']=r.pop('policy_counters')
    assert not any(evaluate_action_gates(values,expected=8,_research_candidate_id='k1').values())


def test_runtime_is_separate_from_original_policy():
    assert (STUDY/'native/coordination_runtime.hpp').is_file(),'Missing per-core integration runtime'
    assert (STUDY/'k1-policy.patch').is_file(),'Missing reproducible isolated integration patch'


def test_frozen_profile_requires_full_native_and_source_closure():
    m=api()
    with pytest.raises(ValueError):m.load_coordination_profile(ROOT/'backend/tests')


def test_native_player_identity_uses_real_stable_id():
    text=(STUDY/'native/coordination_adapter.hpp').read_text()
    assert 'p->GetStableID()' in text
    assert 'p->GetID()' not in text
    patch=(STUDY/'k1-policy.patch').read_text()
    assert 'CastPlayer()->GetStableID()' in patch


def test_isolated_projects_never_export_into_parent_tree():
    projects=list((ROOT/'.local/grf-coordination-native/build').glob('*.vcxproj'))
    assert len(projects)==12
    for p in projects:assert 'grf-c4-native' not in p.read_text(encoding='utf-8-sig').lower(),p.name
    assert (ROOT/'.local/grf-coordination-native/build/_gameplayfootball.dir/Release/objects.txt').is_file()


@pytest.fixture(scope='module')
def runtime(tmp_path_factory):
    if not (STUDY/'native/coordination_runtime.hpp').exists():return None
    build=tmp_path_factory.mktemp('coordination-runtime')
    fixture=ROOT/'backend/tests/fixtures/grf/coordination_runtime_fixture.cpp'
    return compile_fixture(build,fixture)


def compile_fixture(build,fixture):
    vcvars='C:/Program Files (x86)/Microsoft Visual Studio/2017/Community/VC/Auxiliary/Build/vcvarsall.bat'
    exe=build/'runtime.exe'
    command=f'call "{vcvars}" x64 >nul && cl.exe /nologo /std:c++14 /EHsc /W4 /WX /I"{STUDY / "native"}" /I"{build}" "{fixture}" /Fe:"{exe}" /Fo:"{build / "runtime.obj"}"'
    r=subprocess.run(f'cmd.exe /d /s /c "{command}"',capture_output=True,timeout=120,creationflags=subprocess.CREATE_NO_WINDOW)
    assert r.returncode==0,r.stdout.decode(errors='replace')+r.stderr.decode(errors='replace')
    return exe


def function(text,signature):
    start=text.index(signature);a=text.index('{',start);level=1;i=a+1
    while level:
        level+=(text[i]=='{')-(text[i]=='}');i+=1
    return text[start:i]


@pytest.fixture(scope='module')
def native_hooks(tmp_path_factory):
    build=tmp_path_factory.mktemp('coordination-native-hooks')
    adapter=(STUDY/'native/coordination_adapter.hpp').read_text()
    for name,signature in [('commit','inline void Commit('),('override','inline void Override('),('tick','inline void Tick(')]:
        (build/f'native-{name}.inc').write_text(function(adapter,signature))
    eliza=(ROOT/'.local/grf-coordination-native/source/src/onthepitch/player/controller/elizacontroller.cpp').read_text()
    begin=eliza.index('    bool k1Cover=false;');end=eliza.index('    inputVelocityFloat = RangeVelocity(',begin)
    (build/'native-eliza-hook.inc').write_text(eliza[begin:end])
    return compile_fixture(build,ROOT/'backend/tests/fixtures/grf/coordination_native_hook_fixture.cpp')


@pytest.mark.parametrize('case',['cover','observe','priority','keeper_attack','atomic','mirror_source'])
def test_actual_native_hook_and_commit_bodies(native_hooks,case):
    r=subprocess.run([str(native_hooks),case],capture_output=True,timeout=5)
    assert r.returncode==0,r.stderr.decode()
    assert json.loads(r.stdout)==dict(case=case,passed=True)


def test_original_keeper_and_attacking_code_is_byte_identical():
    old=ROOT/'.local/grf-c4-native/source';new=ROOT/'.local/grf-coordination-native/source'
    name='src/onthepitch/player/controller/elizacontroller.cpp'
    a=(old/name).read_text();b=(new/name).read_text()
    start='void ElizaController::GetOnTheBallCommands('
    assert a[a.index(start):]==b[b.index(start):]
    keeper='    goalieStrategy.CalculateIfBallIsBoundForGoal'
    end='  bool forceMagnet'
    assert a[a.index(keeper):a.index(end,a.index(keeper))]==b[b.index(keeper):b.index(end,b.index(keeper))]
    for name in ('src/onthepitch/player/controller/strategies/offtheball/goalie_default.cpp','src/onthepitch/player/controller/playercontroller.cpp'):
        assert (old/name).read_bytes()==(new/name).read_bytes()


@pytest.mark.parametrize('case',['atomic','observe','override','cover','lineage','reset','windows','context','guard','mirror','bounds','availability','exposure'])
def test_real_runtime_invariants(runtime,case):
    assert runtime is not None,'Missing native runtime'
    r=subprocess.run([str(runtime),case],capture_output=True,timeout=5)
    assert r.returncode==0,r.stderr.decode()
    result=json.loads(r.stdout)
    assert result['case']==case and result['passed'] is True


def test_optimized_pure_replay_build_is_pinned_separately():
    path=STUDY/'k1-replay-build.json'
    assert path.is_file(),'Missing native-flag pure replay build'
    build=json.loads(path.read_text())
    assert all(flag in build['command'] for flag in ('/O2','/Ob2','/MD','/fp:precise','/std:c++14'))


def test_native_priority_override_is_not_an_ordinary_hunt():
    patch=(STUDY/'k1-policy.patch').read_text()
    assert 'if (k1PriorityOverride)' in patch
    assert 'bool k1PriorityOverride=forceMagnet;' in patch


def test_frozen_closure_also_binds_python_and_grf_wrapper_runtime():
    value=json.loads((STUDY/'coordination.json').read_text(encoding='utf-8'))
    assert 'runtime_sha256' in value,'Native worker interpreter/packages are not frozen'
    files=value['runtime_sha256']
    assert value['python'] in files
    assert any(name.endswith('/gfootball/env/football_env_core.py') for name in files)
    assert len(files)>=1000


@pytest.mark.parametrize('target',['source','native_header','binary','python'])
def test_real_frozen_profile_rejects_artifact_hash_drift(monkeypatch,target):
    m=api();value=m.read(ROOT/m.DESCRIPTOR)
    path={'source':ROOT/'backend/src/timepitch/grf/coordination_measurement.py',
        'native_header':STUDY/'native/coordination_runtime.hpp',
        'binary':ROOT/m.NATIVE/'Release/_gameplayfootball.pyd','python':ROOT/value['python']}[target].resolve()
    real=m.sha
    monkeypatch.setattr(m,'sha',lambda p:'f'*64 if Path(p).resolve()==path else real(p))
    with pytest.raises(ValueError):m.load_coordination_document(ROOT)


@pytest.mark.parametrize('field',['caps','payloads','policy'])
def test_frozen_profile_rejects_changed_descriptor_settings(monkeypatch,field):
    m=api();real=m.read
    def changed(path):
        value=real(path)
        if Path(path).resolve()==(ROOT/m.DESCRIPTOR).resolve():
            if field=='caps':value[field]['child_seconds']=601
            elif field=='policy':value[field]['hold_ms']=799
            else:value[field]['heldout/24']['config']['seed']+=1
        return value
    monkeypatch.setattr(m,'read',changed)
    with pytest.raises(ValueError):m.load_coordination_document(ROOT)


def test_final_profile_is_immutable_and_full_payload_access_returns_copy():
    from dataclasses import FrozenInstanceError
    p=api().load_coordination_profile(ROOT)
    assert len(p.payloads)==32 and p.id=='k1'
    with pytest.raises(FrozenInstanceError):p.id='k2'
    with pytest.raises(TypeError):p.payloads['calibration/01']['players'][0]['slot']=99
    with pytest.raises(ValueError):p.settings.rest_radius_m=99
    modified=p.payload('calibration/01');modified['players'][0]['slot']=99
    assert p.payload('calibration/01')['players'][0]['slot']!=99
