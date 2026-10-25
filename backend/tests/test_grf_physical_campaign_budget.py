"""Durable cumulative reservations; these tests never start a football process."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import importlib
import importlib.util
import json
from pathlib import Path
import threading
import pytest

H='a'*64
N='b'*64


def api(tmp_path,monkeypatch):
    name='timepitch.grf.physical_campaign_budget'
    assert importlib.util.find_spec(name) is not None,'Missing durable physical campaign budget'
    module=importlib.import_module(name)
    monkeypatch.setattr(module,'PROJECT_ROOT',tmp_path)
    return module


def setup_campaign(tmp_path):
    parent=tmp_path/'.local/grf-physical-work/benchmark/checkpoint.json'
    parent.parent.mkdir(parents=True)
    prior=dict(identity='original',candidate_bindings={'c1':H,'c2':H,'c3':H},
        runs=[dict(key=f'c{c}/calibration/{i:02}',status='ready',input_hash=H)
              for c in (1,2,3) for i in range(1,9)])
    parent.write_bytes(json.dumps(prior).encode())
    campaign=dict(schema_version='grf-physical-campaign-1',parent_checkpoint=parent.relative_to(tmp_path).as_posix(),
        parent_sha256=hashlib.sha256(parent.read_bytes()).hexdigest(),max_native_matches=70,max_candidates=5,
        technical={id:dict(input_hash=H,native_sha256=N,maximum_ms=7440000)
                   for id in ('T-control','T-actions','T-repeat','T-cancel')})
    return parent,tmp_path/'.local/grf-physical-work/continuation',campaign


def spec(m,id='T-actions',**updates):
    group=('technical' if id.startswith('T-') else 'calibration' if '/calibration/' in id else
           'heldout' if '/heldout/' in id else 'repetition' if id=='R-selected' else 'web')
    return m.RunSpec(**dict(id=id,group=group,input_hash=H,native_sha256=N,maximum_ms=7440000,**updates))


def test_preserves_parent_bytes_and_24_attempts(tmp_path,monkeypatch):
    parent,root,campaign=setup_campaign(tmp_path);before=parent.read_bytes();m=api(tmp_path,monkeypatch)
    m.initialize_continuation(parent,campaign,root,approved=True)
    m.reserve_run(root,spec(m))
    state=json.loads((root/'checkpoint.json').read_text())
    assert len(state['prior_runs'])==24 and state['prior_candidates']=={'c1':H,'c2':H,'c3':H}
    assert len(state['runs'])==1 and state['runs']['T-actions']['state']=='reserved'
    assert parent.read_bytes()==before


def test_missing_registration_or_other_root_rejected_before_child(tmp_path,monkeypatch):
    parent,root,campaign=setup_campaign(tmp_path);m=api(tmp_path,monkeypatch);launched=[]
    def attempt(where):
        m.reserve_run(where,spec(m));launched.append(True)
    with pytest.raises(ValueError):attempt(root)
    with pytest.raises(ValueError):m.initialize_continuation(parent,campaign,root,approved=False)
    m.initialize_continuation(parent,campaign,root,approved=True)
    with pytest.raises(ValueError):attempt(root.with_name('fresh-budget'))
    (root.parent/'continuation-registration.json').unlink()
    with pytest.raises(ValueError):attempt(root)
    assert not launched


def test_two_writers_reserve_once(tmp_path,monkeypatch):
    parent,root,campaign=setup_campaign(tmp_path);m=api(tmp_path,monkeypatch)
    m.initialize_continuation(parent,campaign,root,approved=True);barrier=threading.Barrier(2)
    def writer():
        barrier.wait()
        try:m.reserve_run(root,spec(m));return 'reserved'
        except ValueError:return 'consumed'
    with ThreadPoolExecutor(2) as pool:results=list(pool.map(lambda _:writer(),range(2)))
    assert sorted(results)==['consumed','reserved']
    assert len(json.loads((root/'checkpoint.json').read_text())['runs'])==1


def test_failure_and_cancel_consume_id(tmp_path,monkeypatch):
    parent,root,campaign=setup_campaign(tmp_path);m=api(tmp_path,monkeypatch)
    m.initialize_continuation(parent,campaign,root,approved=True)
    for id,status in [('T-actions','failed'),('T-cancel','cancelled')]:
        m.reserve_run(root,spec(m,id));m.finish_run(root,id,state=status,evidence={'reason':'intent consumed'})
        with pytest.raises(ValueError):m.reserve_run(root,spec(m,id))
        with pytest.raises(ValueError):m.finish_run(root,id,state='ready',evidence={})
    assert len(json.loads((root/'checkpoint.json').read_text())['runs'])==2


def test_limit_70_and_five_candidates(tmp_path,monkeypatch):
    parent,root,campaign=setup_campaign(tmp_path);m=api(tmp_path,monkeypatch)
    m.initialize_continuation(parent,campaign,root,approved=True)
    ids=['T-control','T-actions','T-repeat','T-cancel']
    ids += [f'c{c}/calibration/{i:02}' for c in (4,5) for i in range(1,9)]
    ids += [f'selected/heldout/{i:02}' for i in range(1,25)]+['R-selected','W-local']
    for id in ids:m.reserve_run(root,spec(m,id))
    state=json.loads((root/'checkpoint.json').read_text())
    assert len(state['prior_runs'])+len(state['runs'])==70
    assert set(state['candidate_bindings'])=={'c1','c2','c3','c4','c5'}
    for extra in ('T-actions-reroll','c6/calibration/01','selected/heldout/25'):
        with pytest.raises(ValueError):m.reserve_run(root,spec(m,extra))
    invalid=campaign|{'max_native_matches':71}
    with pytest.raises(ValueError):m.initialize_continuation(parent,invalid,root,approved=True)


def test_deleted_continuation_cannot_auto_initialize(tmp_path,monkeypatch):
    parent,root,campaign=setup_campaign(tmp_path);m=api(tmp_path,monkeypatch)
    m.initialize_continuation(parent,campaign,root,approved=True);m.reserve_run(root,spec(m))
    (root/'checkpoint.json').unlink()
    with pytest.raises(ValueError):m.initialize_continuation(parent,campaign,root,approved=True)
    with pytest.raises(ValueError):m.reserve_run(root,spec(m))


def test_ready_reuse_checks_identity_and_artifact_bytes(tmp_path,monkeypatch):
    parent,root,campaign=setup_campaign(tmp_path);m=api(tmp_path,monkeypatch)
    m.initialize_continuation(parent,campaign,root,approved=True)
    artifact=root/'evidence/T-actions';artifact.mkdir(parents=True)
    (artifact/'manifest.json').write_bytes(b'validated by the full-result consumer')
    evidence=dict(result_path='evidence/T-actions',files={'manifest.json':hashlib.sha256((artifact/'manifest.json').read_bytes()).hexdigest()})
    m.reserve_run(root,spec(m));m.finish_run(root,'T-actions',state='ready',evidence=evidence)
    reused=m.reserve_run(root,spec(m));assert reused.reused and reused.result_path==artifact
    changed=m.RunSpec('T-actions','technical','c'*64,N,7440000)
    with pytest.raises(ValueError):m.reserve_run(root,changed)
    (artifact/'manifest.json').write_bytes(b'altered')
    with pytest.raises(ValueError):m.reserve_run(root,spec(m))


def test_parent_mutation_or_unapproved_spec_stops_reservation(tmp_path,monkeypatch):
    parent,root,campaign=setup_campaign(tmp_path);m=api(tmp_path,monkeypatch)
    m.initialize_continuation(parent,campaign,root,approved=True)
    invalid=[m.RunSpec('T-actions','technical',H,'c'*64,7440000),
             m.RunSpec('T-actions','technical',H,N,7440001),m.RunSpec('../escape','technical',H,N,7440000)]
    for value in invalid:
        with pytest.raises(ValueError):m.reserve_run(root,value)
    parent.write_bytes(parent.read_bytes()+b' ')
    with pytest.raises(ValueError):m.reserve_run(root,spec(m))


def test_modified_checkpoint_cannot_erase_consumed_attempts(tmp_path,monkeypatch):
    parent,root,campaign=setup_campaign(tmp_path);m=api(tmp_path,monkeypatch)
    m.initialize_continuation(parent,campaign,root,approved=True);m.reserve_run(root,spec(m))
    path=root/'checkpoint.json';state=json.loads(path.read_text());state['runs']={};state['prior_runs']=[]
    path.write_bytes(json.dumps(state).encode())
    with pytest.raises(ValueError):m.reserve_run(root,spec(m))


def test_crash_between_checkpoint_and_registration_fails_closed(tmp_path,monkeypatch):
    parent,root,campaign=setup_campaign(tmp_path);m=api(tmp_path,monkeypatch)
    m.initialize_continuation(parent,campaign,root,approved=True);original=m.os.replace
    def fail_registration(source,destination):
        if Path(destination).name=='continuation-registration.json':raise OSError('simulated interrupted durable write')
        return original(source,destination)
    monkeypatch.setattr(m.os,'replace',fail_registration)
    with pytest.raises(OSError):m.reserve_run(root,spec(m))
    monkeypatch.setattr(m.os,'replace',original)
    assert 'T-actions' in json.loads((root/'checkpoint.json').read_text())['runs']
    with pytest.raises(ValueError):m.reserve_run(root,spec(m))
