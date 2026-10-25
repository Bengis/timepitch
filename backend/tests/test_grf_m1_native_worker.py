"""Standalone C++ fixtures and static build only: never import a football core."""
import builtins
import importlib.util
import json
from copy import deepcopy
from pathlib import Path
import subprocess
import sys

import pytest

ROOT=Path(__file__).resolve().parents[2]
STUDY=ROOT/'research/engine-evaluation/2026-10-18-grf-clock-m1-worker'


def builder():
    p=STUDY/'build_worker.py'
    assert p.is_file(), 'Missing offline native worker builder'
    spec=importlib.util.spec_from_file_location('m1_worker_builder',p)
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
    return m


@pytest.fixture(autouse=True)
def no_grf(monkeypatch):
    old=builtins.__import__
    def guarded(name,*args,**kw):
        if name.split('.')[0] in ('gfootball','gfootball_engine','_gameplayfootball'):
            raise AssertionError('Native engine import forbidden')
        return old(name,*args,**kw)
    monkeypatch.setattr(builtins,'__import__',guarded)
    class NoNative:
        def find_spec(self,name,path=None,target=None):
            if name.split('.')[0] in ('gfootball','gfootball_engine','_gameplayfootball'):
                raise AssertionError('Native engine import forbidden')
            return None
    monkeypatch.setattr(sys,'meta_path',[NoNative(),*sys.meta_path])


@pytest.fixture(scope='module')
def fixture():return builder().build_fixtures()


def invoke(fixture,case):
    out=subprocess.run([str(fixture),case],capture_output=True,check=True,timeout=10)
    return json.loads(out.stdout)


@pytest.mark.parametrize('case',['fallback','natural','halftime','final','duplicate','wrong_phase',
 'wrong_time','disabled','pending','active_penalty','active_goal','natural_in_play','too_early','cap','changed_state'])
def test_close_state_machine_and_only_stop_play_effect(fixture,case):
    d=invoke(fixture,case)
    assert d['checked'] is True


@pytest.mark.parametrize('case',['identities','identity_duplicate','identity_team','observe','apply',
 'illegal_pairs','counter_overflow','policy_reset','frame_cap','transaction_cap','shared_memory','future_wait'])
def test_identity_map_and_full_policy_counter_invariants(fixture,case):
    assert invoke(fixture,case)['checked'] is True


@pytest.mark.parametrize('case',['epoch','six','overlap','prefix','zero','reset','overflow','same_frame'])
def test_epoch_recorder_has_bounded_source_records(fixture,case):
    d=invoke(fixture,case)
    assert d['version']=='m1-shot-context-2'
    if case=='epoch':
        assert [(f['row']['period'],f['row']['physics_ms']) for f in d['frames'] if f['row']['physics_ms']==1000]==[(1,1000),(2,1000)]
    elif case=='six':
        assert len(d['triggers'])==6 and len(d['frames'])==186
        assert len(d['observed_contacts'])==7 and d['triggers']==d['observed_contacts'][:6]
    elif case=='overlap':assert len(d['frames'])==36
    elif case=='prefix':
        assert d['complete'] is False and d['end_ms']==4100
        assert d['triggers'][0]['physics_ms']==4000 and len(d['frames'])==22
    elif case=='zero':assert not d['triggers'] and not d['frames']
    elif case=='reset':assert any(f['row']['relocation_id']==1 for f in d['frames'])
    elif case=='overflow':assert d['overflowed'] and not d['complete']
    elif case=='same_frame':assert not d['overflowed']


def test_builder_help_has_no_native_import_or_implicit_mode():
    m=builder()
    assert m.TARGET!=m.PARENT
    assert m.PARENT.as_posix().endswith('59be0bba9576806e')


def test_native_reset_initializes_both_successor_states():
    patch=(STUDY/'native-worker.patch').read_text(encoding='utf-8')
    assert 'shot_context = timepitch_shots::EpochShotContextRecorder();' in patch
    assert 'worker_period_closer = timepitch_worker::PeriodCloser();' in patch


def test_static_worker_receipt_has_new_binary_full_source_and_no_execution():
    p=STUDY/'worker-build.json'
    if not p.exists():pytest.skip('Static build not yet available')
    m=builder();d=json.loads(p.read_bytes())
    assert d['native_imported'] is False and d['native_core_created'] is False and d['matches_executed']==0
    assert d['native_binary_sha256']!='de424cb245f11c7c66ed4e7112363ed12308399dcb426a808587a62e9c2f447e'
    assert m.sha(ROOT/d['native_dir']/'_gameplayfootball.pyd')==d['native_binary_sha256']
    assert len(d['source_files'])==694 and len(d['projects'])==12 and len(d['dependencies'])==14
    assert all(m.sha(ROOT/n)==h for n,h in d['inputs'].items())


@pytest.mark.parametrize('tamper',['none','dll','input','execution','counter_type'])
def test_independent_static_verifier_rejects_changed_artifacts_and_flags(monkeypatch,tamper):
    path=STUDY/'verify_worker_build.py'
    assert path.exists(), 'Missing independent static verifier'
    spec=importlib.util.spec_from_file_location('m1_worker_verifier',path)
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
    if tamper in ('execution','counter_type'):
        original=m.read
        def altered(p):
            value=original(p)
            if Path(p)==STUDY/'worker-build.json':
                value=deepcopy(value)
                if tamper=='execution':value['native_imported']=True
                else:value['matches_executed']=False
            return value
        monkeypatch.setattr(m,'read',altered)
    elif tamper in ('dll','input'):
        original=m.sha
        def changed(p):
            p=Path(p)
            if tamper=='dll' and p.parent.name=='Release' and p.suffix=='.dll':return 'f'*64
            if tamper=='input' and p==STUDY/'native/period_close.hpp':return 'f'*64
            return original(p)
        monkeypatch.setattr(m,'sha',changed)
    if tamper=='none':assert m.verify_static_worker(ROOT)['source_files']==694
    else:
        with pytest.raises(ValueError):m.verify_static_worker(ROOT)
