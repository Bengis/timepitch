"""Offline freeze/denial contracts on owned trees; never execute GRF."""
import importlib
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import pytest
from grf_offline_guard import offline_only
from timepitch.grf.physical_wire import digest
from timepitch.grf.m1_verifier import read,sha
from test_grf_m1_resource_history import seed,put


def api():
    name='timepitch.grf.m1_resource_profile'
    assert importlib.util.find_spec(name),'Offline resource profile missing'
    return importlib.import_module(name)


@pytest.fixture
def tree(tmp_path,monkeypatch):
    m=api();h,record=seed(tmp_path)
    d=read(tmp_path/h.DESCRIPTOR)
    d['native_sha256']=sha(tmp_path/'native/old.pyd')
    build='research/engine-evaluation/2026-10-18-grf-clock-m1-worker/worker-build.json'
    d['build_manifest_sha256']=put(tmp_path,build,{'synthetic':True})
    d['static_sha256'][build]=d['build_manifest_sha256']
    descriptor=put(tmp_path,h.DESCRIPTOR,d);identity=digest(d)
    put(tmp_path,h.WITNESS,dict(schema_version='m1-worker-freeze-witness-1',profile_identity=identity,descriptor_sha256=descriptor))
    for n in (h.DESCRIPTOR,h.WITNESS):
        put(tmp_path,h.ARCHIVE+'/metadata/'+n,(tmp_path/n).read_bytes());record['metadata_sha256'][n]=sha(tmp_path/n)
    record['profile_identity']=identity;record_sha=put(tmp_path,h.ARCHIVE+'/record.json',record)
    for n in (h.ARCHIVE+'/binding.json',h.BINDING,h.ANCHOR):
        put(tmp_path,n,dict(schema_version='m1-resource-source-binding-1',profile_identity=identity,record_sha256=record_sha))
    addition='backend/src/timepitch/resource_profile.py'
    original=dict(d['source_sha256']);state=h.verify_resource_archive(tmp_path)
    put(tmp_path,addition,b'# synthetic new profile\n')
    report=dict(status='provisional',measured_verdict='passed',publication_complete=False,requires_executor_acceptance=True,
        admission=False,diagnostic_only=True,analysis_source_sha256=original,analysis_source_identity=digest(original),evidence_profile_identity=identity)
    for name in ('phase3-replay-audit.json','phase3-performance.json'):put(tmp_path,h.STUDY+'/'+name,report)
    acceptance=dict(schema_version='m1-resource-phase3-acceptance-1',phase=3,status='offline-validated',
        native_authorized=False,web_admitted=False,original_failed_attempt_admitted=False,
        full_audit_invocations=1,new_native_matches=0,new_real_reservations=0,heldout_opened=False,
        evidence_profile_identity=identity,analysis_source_identity=digest(original),
        report_sha256={n:sha(tmp_path/h.STUDY/n) for n in ('phase3-replay-audit.json','phase3-performance.json')},
        returned_verdict=dict(status='passed',publication_complete=True),history_after=state)
    put(tmp_path,h.STUDY+'/phase3-acceptance.json',acceptance)
    monkeypatch.setattr(m,'PHASE3_DIGEST',digest(acceptance))
    monkeypatch.setattr(m,'ADDITIONS',(addition,))
    monkeypatch.setattr(m,'EVIDENCE_PROFILE',identity)
    monkeypatch.setattr(m,'_prior_receipts',lambda root:{})
    return SimpleNamespace(m=m,h=h,root=tmp_path,record=record,original=d,addition=addition,acceptance=acceptance)


def test_resource_profile_binds_all_final_sources_and_evidence(tree):
    t=tree;m=t.m;r=m.freeze_resource_profile(t.root);d=read(t.root/m.PROFILE)
    assert r==m.verify_resource_profile(t.root)
    assert d['worker_status']=='offline-validated' and d['native_authorized'] is False and d['web_admitted'] is False
    assert d['source_sha256']=={**t.original['source_sha256'],t.addition:sha(t.root/t.addition)}
    assert d['runtime_sha256']==t.original['runtime_sha256']
    assert d['resource_policy']['limit_seconds']==600 and d['resource_policy']['limit_private_bytes']==536870912
    assert d['parent_snapshot']['used']==42 and d['parent_snapshot']['candidates']==6
    assert d['parent_snapshot']['files']=={**t.record['metadata_sha256'],**t.record['evidence_sha256']}
    assert d['parent_profile']==digest(t.original)
    assert d['native_sha256']==t.original['native_sha256']
    assert d['phase3_acceptance_sha256']==sha(t.root/t.h.STUDY/'phase3-acceptance.json')
    assert t.h.ARCHIVE+'/source/backend/src/timepitch/example.py' in d['static_sha256']


@pytest.mark.parametrize('target',['profile','witness','pending-profile','pending-witness'])
def test_lost_or_partial_witness_never_refrozen(tree,target):
    t=tree;m=t.m
    if target.startswith('pending'):
        path=t.root/(m.PROFILE if target.endswith('profile') else m.WITNESS)
        put(t.root,str(path.relative_to(t.root)).replace('\\','/'),b'{partial')
    else:
        m.freeze_resource_profile(t.root);path=t.root/(m.PROFILE if target=='profile' else m.WITNESS);path.unlink()
    before={p.relative_to(t.root).as_posix():sha(p) for p in t.root.rglob('*') if p.is_file()}
    with pytest.raises(ValueError):m.freeze_resource_profile(t.root)
    with pytest.raises(ValueError):m.verify_resource_profile(t.root)
    assert before=={p.relative_to(t.root).as_posix():sha(p) for p in t.root.rglob('*') if p.is_file()}


@pytest.mark.parametrize('mutation',['source','new_source','removed_source','parent','runtime','native','archive','phase3','report','profile','witness','new_static'])
def test_added_source_or_changed_parent_rejected(tree,mutation):
    t=tree;m=t.m;m.freeze_resource_profile(t.root)
    paths=dict(source=t.addition,new_source='backend/src/timepitch/extra.py',removed_source=t.addition,
        parent=t.h.CAMPAIGN+'/checkpoint.json',runtime='runtime/python.exe',native='native/old.pyd',
        archive=t.h.ARCHIVE+'/source/backend/src/timepitch/example.py',phase3=t.h.STUDY+'/phase3-acceptance.json',
        report=t.h.STUDY+'/phase3-performance.json',profile=m.PROFILE,witness=m.WITNESS,new_static='native/new.dll')
    path=t.root/paths[mutation]
    if mutation=='removed_source':path.unlink()
    else:put(t.root,paths[mutation],b'changed bytes')
    with pytest.raises(ValueError):m.verify_resource_profile(t.root)


@pytest.mark.parametrize('mutation',['accepted_source','new_source','acceptance','report','missing_acceptance'])
def test_invalid_phase3_inputs_cannot_be_frozen(tree,mutation):
    t=tree;m=t.m
    paths=dict(accepted_source='backend/src/timepitch/example.py',new_source='backend/src/timepitch/extra.py',
        acceptance=t.h.STUDY+'/phase3-acceptance.json',report=t.h.STUDY+'/phase3-performance.json',missing_acceptance=t.h.STUDY+'/phase3-acceptance.json')
    if mutation=='missing_acceptance':(t.root/paths[mutation]).unlink()
    else:put(t.root,paths[mutation],b'changed')
    with pytest.raises(ValueError):m.freeze_resource_profile(t.root)
    assert not (t.root/m.PROFILE).exists() and not (t.root/m.WITNESS).exists()


def test_consistent_historical_replacement_cannot_replace_accepted_phase3_archive(tree):
    t=tree;m=t.m;h=t.h
    name=h.REPORTS+'/preflight.json'
    replacement=b'{"synthetic":"replacement history"}'
    put(t.root,name,replacement);put(t.root,h.ARCHIVE+'/metadata/'+name,replacement)
    record=read(t.root/h.ARCHIVE/'record.json');record['metadata_sha256'][name]=sha(t.root/name)
    record_sha=put(t.root,h.ARCHIVE+'/record.json',record)
    binding=dict(schema_version='m1-resource-source-binding-1',profile_identity=digest(t.original),record_sha256=record_sha)
    for n in (h.ARCHIVE+'/binding.json',h.BINDING,h.ANCHOR):put(t.root,n,binding)
    # Internally consistent, but not the raw history accepted by phase3.
    current=h.verify_resource_archive(t.root)
    assert current['record_sha256']!=t.acceptance['history_after']['record_sha256']
    assert h.snapshot(t.root)==record['parent_snapshot']
    with pytest.raises(ValueError,match='Accepted archive'):m.freeze_resource_profile(t.root)
    assert not (t.root/m.PROFILE).exists() and not (t.root/m.WITNESS).exists()


def test_old_grant_and_new_descriptor_cannot_start_native(tree):
    from timepitch.grf import m1_verifier as wire
    from timepitch.grf.m1_campaign import run_m1_stage
    from timepitch.grf.m1_process import M1Process
    from timepitch.grf.m1_authorization import validate_worker_authorization,WorkerLedger
    t=tree;m=t.m;m.freeze_resource_profile(t.root)
    before=(t.root/t.h.CAMPAIGN/'checkpoint.json').read_bytes()
    # Place the resource descriptor in the old launch slot, with a matching
    # witness. Even self-consistent metadata is not the worker schema/grant.
    put(t.root,wire.FREEZE,(t.root/m.PROFILE).read_bytes())
    d=read(t.root/wire.FREEZE)
    put(t.root,wire.WITNESS,dict(schema_version='m1-worker-freeze-witness-1',profile_identity=digest(d),descriptor_sha256=sha(t.root/wire.FREEZE)))
    profile=SimpleNamespace(project=t.root,identity=digest(d))
    all_before={p.relative_to(t.root).as_posix():sha(p) for p in t.root.rglob('*') if p.is_file()}
    with pytest.raises(ValueError):wire.prepare_launch(t.root,t.root/wire.RUN_ROOT,'M-observe-42',{})
    with pytest.raises(ValueError):wire.verify_launch(t.root,t.root/wire.RUN_ROOT,'M-observe-42',{})
    with pytest.raises(ValueError):M1Process(profile,t.root/wire.RUN_ROOT,'M-observe-42')
    with pytest.raises(ValueError):validate_worker_authorization(t.root,profile)
    with pytest.raises(ValueError):WorkerLedger(t.root,profile)
    for stage in ('observe','calibration','heldout'):
        with pytest.raises(ValueError):run_m1_stage(t.root,stage)
    assert (t.root/t.h.CAMPAIGN/'checkpoint.json').read_bytes()==before
    assert all_before=={p.relative_to(t.root).as_posix():sha(p) for p in t.root.rglob('*') if p.is_file()}


def test_failed_observe_cannot_be_reused_or_relabelled(tree):
    t=tree;m=t.m;m.freeze_resource_profile(t.root)
    path=t.root/t.h.CAMPAIGN/'checkpoint.json';state=read(path)
    state['runs']['M-observe-42']['state']='ready';state['terminal_failure']=None
    put(t.root,path.relative_to(t.root).as_posix(),state)
    with pytest.raises(ValueError):m.verify_resource_profile(t.root)


def test_successor_does_not_renew_candidate_or_attempt_budget(tree):
    t=tree;m=t.m
    before={n:sha(t.root/n) for n in t.record['metadata_sha256']}
    m.freeze_resource_profile(t.root);m.verify_resource_profile(t.root)
    assert before=={n:sha(t.root/n) for n in before}
    d=read(t.root/m.PROFILE)
    assert (d['parent_snapshot']['used'],d['parent_snapshot']['maximum'],d['parent_snapshot']['candidates'],d['parent_snapshot']['candidate_limit'])==(42,76,6,6)
    assert not any(hasattr(m,n) for n in ('run','authorize','reserve','initialize_campaign','reset'))


def test_linked_descriptor_or_witness_root_rejected(tree,tmp_path):
    t=tree;m=t.m
    # artifact() must be anchored to the project, never to a resolved link.
    folder=t.root/Path(m.PROFILE).parent
    original=t.root/'elsewhere';folder.rename(original);folder.symlink_to(original,target_is_directory=True)
    with pytest.raises(ValueError):m.freeze_resource_profile(t.root)


def test_freeze_write_failure_leaves_consumed_witness(tree,monkeypatch):
    t=tree;m=t.m;original=m.write_exclusive
    def fail(path,*args,**kwargs):
        if path==t.root/m.PROFILE:raise OSError('synthetic disk failure')
        return original(path,*args,**kwargs)
    monkeypatch.setattr(m,'write_exclusive',fail)
    with pytest.raises(OSError):m.freeze_resource_profile(t.root)
    assert (t.root/m.WITNESS).exists()
    with pytest.raises(ValueError):m.freeze_resource_profile(t.root)


def test_source_race_during_seal_cannot_be_accepted_or_refrozen(tree,monkeypatch):
    t=tree;m=t.m;original=m.write_exclusive
    def change(path,*args,**kwargs):
        original(path,*args,**kwargs)
        if path==t.root/m.PROFILE:put(t.root,t.addition,b'# race after gather\n')
    monkeypatch.setattr(m,'write_exclusive',change)
    with pytest.raises(ValueError):m.freeze_resource_profile(t.root)
    assert (t.root/m.WITNESS).exists() and (t.root/m.PROFILE).exists()
    with pytest.raises(ValueError):m.freeze_resource_profile(t.root)


def test_unlisted_linked_source_directory_rejected(tree):
    t=tree;m=t.m;m.freeze_resource_profile(t.root)
    outside=t.root/'unlisted';outside.mkdir();(outside/'hidden.py').write_bytes(b'never imported')
    (t.root/'backend/src/timepitch/hidden').symlink_to(outside,target_is_directory=True)
    with pytest.raises(ValueError):m.verify_resource_profile(t.root)


def test_real_resource_successor_does_not_authorize_any_entry():
    """Read-only real refusal, before/after an optional offline resource freeze."""
    from timepitch.grf import m1_verifier as wire,m1_resource_history as h
    from timepitch.grf.m1_campaign import run_m1_stage
    from timepitch.grf.m1_process import M1Process
    from timepitch.grf.m1_authorization import validate_worker_authorization,WorkerLedger
    root=wire.PROJECT;record=read(root/h.ARCHIVE/'record.json')
    protected={**record['metadata_sha256'],**record['evidence_sha256']}
    before={n:sha(wire.artifact(root,n)) for n in protected}
    assert before==protected
    resource=root/api().PROFILE
    identity=digest(read(resource)) if resource.exists() else '0'*64
    profile=SimpleNamespace(project=root,identity=identity)
    payload=read(root/wire.FREEZE)['payloads']['calibration/01']
    for run_id in ('M-observe-42','m1/calibration/01','m1/heldout/01'):
        with pytest.raises(ValueError):wire.prepare_launch(root,root/wire.RUN_ROOT,run_id,payload)
        with pytest.raises(ValueError):wire.verify_launch(root,root/wire.RUN_ROOT,run_id,payload)
        with pytest.raises(ValueError):M1Process(profile,root/wire.RUN_ROOT,run_id)
    with pytest.raises(ValueError):validate_worker_authorization(root,profile)
    with pytest.raises(ValueError):WorkerLedger(root,profile)
    for stage in ('observe','calibration','heldout'):
        with pytest.raises(ValueError):run_m1_stage(root,stage)
    assert before=={n:sha(wire.artifact(root,n)) for n in protected}
    assert h.snapshot(root)==record['parent_snapshot']
