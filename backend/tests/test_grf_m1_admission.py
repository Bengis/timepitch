"""Successor freeze/admission contracts; never import or start native GRF."""
import copy
import json
import shutil
from pathlib import Path
import pytest
from grf_offline_guard import offline_only
from grf_m1_fixtures import synthetic_launch,put


@pytest.fixture
def unfrozen(tmp_path,monkeypatch):
    from timepitch.grf import m1_profile as m,m1_verifier as v
    seed=tmp_path/'seed';_,_,d=synthetic_launch(seed)
    for name in {*d['source_sha256'],*d['runtime_sha256'],*d['static_sha256'],*d['parent_sha256'],v.STUDY+'/clock-compatibility.json'}:
        source=seed/name;target=tmp_path/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source,target)
    monkeypatch.setattr(m,'gather_worker_inputs',lambda project:copy.deepcopy(d))
    return tmp_path,d


def test_freeze_is_immutable_offline_and_creates_no_campaign(unfrozen):
    from timepitch.grf import m1_profile as m,m1_verifier as v
    root,d=unfrozen;p=m.freeze_worker_profile(root)
    assert p.identity==m.load_worker_profile(root).identity and p.document['native_authorized'] is False
    assert p.document['worker_status']=='offline-validated' and not (root/v.RUN_ROOT).exists()
    assert not (root/v.ANCHOR).exists()
    with pytest.raises(ValueError):m.freeze_worker_profile(root)
    with pytest.raises(TypeError):p.document['native_authorized']=True
    value=p.payload('calibration/01');value['players'].clear()
    assert len(p.payload('calibration/01')['players'])==22


@pytest.mark.parametrize('change',['missing_witness','corrupt_witness','new_source','source','runtime','build','legacy','compatibility'])
def test_successor_rejects_mutation_and_never_renews(unfrozen,change):
    from timepitch.grf import m1_profile as m,m1_verifier as v
    root,d=unfrozen;m.freeze_worker_profile(root)
    if change=='missing_witness':(root/v.WITNESS).unlink()
    elif change=='corrupt_witness':put(root,v.WITNESS,{})
    elif change=='new_source':(root/'backend/src/timepitch/new.py').write_bytes(b'# added')
    elif change in ('source','runtime','build'):
        group={'source':'source_sha256','runtime':'runtime_sha256','build':'static_sha256'}[change]
        (root/next(iter(d[group]))).write_bytes(b'changed')
    elif change=='legacy':
        doc=json.loads((root/v.FREEZE).read_bytes());doc['schema_version']='m1-continuity-profile-1';put(root,v.FREEZE,doc)
    else:put(root,v.STUDY+'/clock-compatibility.json',dict(status='compatible',forged=True))
    with pytest.raises(ValueError):m.load_worker_profile(root)
    with pytest.raises(ValueError):m.freeze_worker_profile(root)


def test_bad_compatibility_cannot_be_frozen(unfrozen):
    from timepitch.grf import m1_profile as m,m1_verifier as v
    root,d=unfrozen;put(root,v.STUDY+'/clock-compatibility.json',{'status':'blocked'})
    with pytest.raises(ValueError):m.freeze_worker_profile(root)
    assert not (root/v.RUN_ROOT).exists()


@pytest.mark.parametrize('missing',['authorization.json','approval.json','supplement.json','authorization-witness.json','anchor'])
def test_partial_grant_is_denied_without_initializing_or_renewing(tmp_path,missing):
    from timepitch.grf import m1_profile as m,m1_authorization as a,m1_verifier as v
    campaign,_,_=synthetic_launch(tmp_path);profile=m.load_worker_profile(tmp_path)
    path=tmp_path/v.ANCHOR if missing=='anchor' else campaign/missing;path.unlink()
    with pytest.raises(ValueError):a.validate_worker_authorization(tmp_path,profile)
    assert not path.exists()


def test_arbitrary_executor_or_factory_is_not_a_public_argument(tmp_path):
    from timepitch.grf.m1_campaign import run_m1_stage
    for kw in ({'executor':lambda:None},{'factory':lambda:None},{'process_factory':lambda:None}):
        with pytest.raises(TypeError):run_m1_stage(tmp_path,'observe',**kw)


def test_real_entry_does_not_create_campaign_or_load_native(monkeypatch):
    from timepitch.grf import m1_campaign as campaign
    from timepitch.grf.m1_verifier import PROJECT,RUN_ROOT,ANCHOR
    assert not (PROJECT/RUN_ROOT).exists() and not (PROJECT/ANCHOR).exists()
    calls=[]
    def forbidden(*args):calls.append(args);raise AssertionError('No executor before approval')
    monkeypatch.setattr(campaign,'_measure_reserved',forbidden)
    with pytest.raises(ValueError):campaign.run_m1_stage(PROJECT,'observe')
    assert calls==[]
    assert not (PROJECT/RUN_ROOT).exists() and not (PROJECT/ANCHOR).exists()


@pytest.mark.parametrize('field,value',[('explicit_native',1),('execute_phase',5.0),('maximum',76.0),('candidate_limit',6.0)])
def test_native_approval_types_are_exact_even_if_linked_hashes_are_updated(tmp_path,field,value):
    from timepitch.grf import m1_profile as m,m1_authorization as a,m1_verifier as v
    campaign,_,_=synthetic_launch(tmp_path);profile=m.load_worker_profile(tmp_path)
    approval=v.read(campaign/'approval.json');approval[field]=value;put(campaign,'approval.json',approval)
    grant=v.read(campaign/'authorization.json');grant['approval_sha256']=v.sha(campaign/'approval.json')
    for name in ('authorization.json','supplement.json','authorization-witness.json'):put(campaign,name,grant)
    put(tmp_path,v.ANCHOR,grant)
    with pytest.raises(ValueError):a.validate_worker_authorization(tmp_path,profile)


@pytest.mark.parametrize('change',['none','missing_witness','extra_source','changed_source'])
def test_phase3_raw_archive_membership_and_witnesses(tmp_path,change):
    from timepitch.grf import m1_profile as m,m1_verifier as v
    shutil.copytree(v.PROJECT/m.PHASE3_ARCHIVE,tmp_path/m.PHASE3_ARCHIVE)
    for name in (m.PHASE3_WITNESS,m.PHASE3_BINDING,v.STUDY+'/phase3-acceptance.json'):
        target=tmp_path/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(v.PROJECT/name,target)
    if change=='missing_witness':(tmp_path/m.PHASE3_WITNESS).unlink()
    elif change=='extra_source':(tmp_path/m.PHASE3_ARCHIVE/'source/extra.py').write_bytes(b'# unexpected')
    elif change=='changed_source':(tmp_path/m.PHASE3_ARCHIVE/'source/backend/src/timepitch/grf/m1_verifier.py').write_bytes(b'# changed')
    if change=='none':assert m.verify_phase3_archive(tmp_path)['source_count']==150
    else:
        with pytest.raises(ValueError):m.verify_phase3_archive(tmp_path)


def test_equivalence_projection_excludes_only_research_envelope():
    from types import SimpleNamespace
    from grf_action_fixtures import action_trace
    from timepitch.grf.m1_models import M1Manifest
    from timepitch.grf.physical_codec import manifest_hash
    from timepitch.grf.m1_campaign import compare_m1_control
    old,chunks=action_trace()
    identity=dict(run_id='M-observe-42',mode='observe',input_hash=old.input.input_hash,native_sha256='b'*64,
        profile_identity='a'*64,build_manifest_sha256='c'*64)
    new=M1Manifest(**old.model_dump(exclude={'schema_version','engine_version','native_binary_sha256','trace_hash'}),
        native_binary_sha256='b'*64,worker_identity=identity,close_receipts=[{},{}])
    new.trace_hash=manifest_hash(new)
    result=SimpleNamespace(manifest=new,chunks=lambda:iter(chunks));control=SimpleNamespace(manifest=old,chunks=lambda:iter(chunks))
    assert compare_m1_control(control,result)['samples']==3
    new.score=(1,0);new.trace_hash=manifest_hash(new)
    with pytest.raises(ValueError):compare_m1_control(control,result)


@pytest.mark.parametrize('mutation',['lost_witness','added_member','added_bytecode'])
def test_frozen_historical_closure_stays_protected(unfrozen,mutation):
    from timepitch.grf import m1_profile as m,m1_verifier as v
    root,d=unfrozen
    folder='.local/synthetic-archive';witness=folder+'-initialized.json'
    put(root,folder+'/source/original.json',{'synthetic':True});put(root,witness,{'witness':True})
    m._seal_archive_closure(root,d['static_sha256'],d['inventories'],[folder],[witness])
    m.freeze_worker_profile(root)
    if mutation=='lost_witness':(root/witness).unlink()
    elif mutation=='added_bytecode':
        cache=root/folder/'source/__pycache__/unexpected.pyc';cache.parent.mkdir();cache.write_bytes(b'not an archived member')
    else:put(root,folder+'/source/added.json',{'unexpected':True})
    with pytest.raises(ValueError):m.load_worker_profile(root)
