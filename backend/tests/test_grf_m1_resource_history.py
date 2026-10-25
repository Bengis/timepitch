"""Immutable raw M1 history; synthetic trees, no native permission or loader."""
import hashlib,importlib,importlib.util,json,os
from pathlib import Path
import pytest
from grf_offline_guard import offline_only
from timepitch.grf.physical_wire import canonical,digest

def api():
    n='timepitch.grf.m1_resource_history'
    assert importlib.util.find_spec(n),'Resource archive reader missing'
    return importlib.import_module(n)

def put(root,name,value):
    raw=value if isinstance(value,bytes) else canonical(value)
    p=root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(raw)
    return hashlib.sha256(raw).hexdigest()

def seed(root):
    m=api();source={'backend/src/timepitch/example.py':put(root,'backend/src/timepitch/example.py',b'# raw\r\nx=1\r\n')}
    statics={'native/old.pyd':put(root,'native/old.pyd',b'not executable'),'.local/historical/raw.pyc':put(root,'.local/historical/raw.pyc',b'raw protected bytes')}
    d=dict(schema_version='m1-worker-profile-1',source_sha256=source,
        runtime_sha256={'runtime/python.exe':put(root,'runtime/python.exe',b'never executed')},static_sha256=statics,
        parent_sha256={'old/checkpoint.json':put(root,'old/checkpoint.json',b'{}')},
        inventories=[dict(root='backend/src/timepitch',pattern='*.py',members=list(source)),
            dict(root='native',pattern='*',members=['native/old.pyd']),dict(root='.local/historical',pattern='archive:*',members=['.local/historical/raw.pyc'])])
    raw_sha=put(root,m.DESCRIPTOR,d);put(root,m.WITNESS,dict(schema_version='m1-worker-freeze-witness-1',profile_identity=digest(d),descriptor_sha256=raw_sha))
    state=dict(schema_version='m1-ledger-1',runs={'M-observe-42':dict(state='failed')},terminal_failure=dict(id='M-observe-42',state='failed'),
        observe_proof=None,calibration_report=None,selection=None,heldout_opened=False)
    evidence={}
    for n in m.METADATA:
        if n in (m.DESCRIPTOR,m.WITNESS) or n.startswith(m.REPORTS+'/'):continue
        evidence[n]=put(root,n,state if n.endswith('/checkpoint.json') else b'{}')
    evidence[m.CAMPAIGN+'/evidence/M-observe-42/measurement.json']=put(root,m.CAMPAIGN+'/evidence/M-observe-42/measurement.json',dict(complete=False))
    for n in ('implementation-history.md','preflight.json','proposal.json'):put(root,m.REPORTS+'/'+n,b'{}')
    put(root,m.REPORTS+'/observation-report.json',dict(status='failed',admitted=False,authorization=dict(grant_sha256=digest({})),postcheck=dict(durable_files=evidence)))
    record=dict(schema_version='m1-resource-source-archive-1',profile_identity=digest(d),source_sha256=source,
        metadata_sha256={n:hashlib.sha256((root/n).read_bytes()).hexdigest() for n in m.METADATA},evidence_sha256=evidence,
        parent_snapshot=dict(used=42,maximum=76,candidates=6,candidate_limit=6,terminal_id='M-observe-42',heldout_opened=False))
    for group,folder in (('source_sha256','source'),('metadata_sha256','metadata')):
        for n in record[group]:put(root,m.ARCHIVE+'/'+folder+'/'+n,(root/n).read_bytes())
    h=put(root,m.ARCHIVE+'/record.json',record);binding=dict(schema_version='m1-resource-source-binding-1',profile_identity=digest(d),record_sha256=h)
    for n in (m.ARCHIVE+'/binding.json',m.BINDING,m.ANCHOR):put(root,n,binding)
    return m,record

def test_resource_archive_membership_and_crlf(tmp_path):
    m,r=seed(tmp_path);receipt=m.verify_resource_archive(tmp_path)
    assert receipt['source_count']==1 and receipt['metadata_count']==15
    assert (tmp_path/m.ARCHIVE/'source/backend/src/timepitch/example.py').read_bytes()==b'# raw\r\nx=1\r\n'
    assert not hasattr(m,'initialize_archive')

@pytest.mark.parametrize('name',['source','source_extra','source_missing','metadata','metadata_extra','record','internal','anchor','binding','descriptor','original_witness','runtime','native','parent','state','evidence','root_extra'])
def test_lost_archive_never_reinitialized(tmp_path,name):
    m,_=seed(tmp_path)
    paths=dict(source=m.ARCHIVE+'/source/backend/src/timepitch/example.py',source_extra=m.ARCHIVE+'/source/extra.py',source_missing=m.ARCHIVE+'/source/backend/src/timepitch/example.py',
        metadata=m.ARCHIVE+'/metadata/'+m.DESCRIPTOR,metadata_extra=m.ARCHIVE+'/metadata/extra.json',record=m.ARCHIVE+'/record.json',internal=m.ARCHIVE+'/binding.json',anchor=m.ANCHOR,binding=m.BINDING,
        descriptor=m.DESCRIPTOR,original_witness=m.WITNESS,runtime='runtime/python.exe',native='native/old.pyd',parent='old/checkpoint.json',state=m.CAMPAIGN+'/checkpoint.json',
        evidence=m.CAMPAIGN+'/evidence/M-observe-42/measurement.json',root_extra=m.ARCHIVE+'/unexpected')
    target=tmp_path/paths[name]
    if name in ('source_missing','anchor'):target.unlink()
    else:put(tmp_path,paths[name],b'changed')
    with pytest.raises(ValueError):m.verify_resource_archive(tmp_path)
    if name=='anchor':assert not target.exists()

def test_current_terminal_history_bound(tmp_path):
    m,_=seed(tmp_path);s=m.verify_resource_archive(tmp_path)
    assert (s['used'],s['maximum'],s['candidates'],s['candidate_limit'])==(42,76,6,6)
    assert s['terminal_id']=='M-observe-42' and not s['heldout_opened']

def test_live_changes_reported_without_rebinding(tmp_path):
    m,_=seed(tmp_path);first=m.verify_resource_archive(tmp_path)
    put(tmp_path,'backend/src/timepitch/new.py',b'new');put(tmp_path,'backend/src/timepitch/example.py',b'changed live')
    s=m.verify_resource_archive(tmp_path)
    assert s['profile_identity']==first['profile_identity'] and s['record_sha256']==first['record_sha256']
    assert s['live_added']==['backend/src/timepitch/new.py'] and s['live_modified']==['backend/src/timepitch/example.py']
    (tmp_path/'backend/src/timepitch/example.py').unlink();assert m.verify_resource_archive(tmp_path)['live_missing']==['backend/src/timepitch/example.py']

def test_historical_raw_archive_membership_is_exact(tmp_path):
    m,_=seed(tmp_path);m.verify_resource_archive(tmp_path)
    put(tmp_path,'.local/historical/new.pyc',b'even ignored-looking bytes are protected')
    with pytest.raises(ValueError):m.verify_resource_archive(tmp_path)

@pytest.mark.parametrize('path',['../escape','x/../escape','C:/escape','x\\escape','/absolute'])
def test_archive_paths_cannot_escape(tmp_path,path):
    m=api()
    with pytest.raises(ValueError):m.artifact(tmp_path,path)

@pytest.mark.parametrize('folder',['source','metadata'])
def test_archive_directory_links_cannot_escape_even_with_identical_bytes(tmp_path,folder):
    project=tmp_path/'project';m,_=seed(project)
    original=project/m.ARCHIVE/folder;outside=tmp_path/'relocated-identical-bytes'
    # Both endpoints are owned by this synthetic test before the directory move.
    assert original.resolve().is_relative_to(tmp_path.resolve())
    assert outside.resolve().is_relative_to(tmp_path.resolve())
    original.rename(outside)
    os.symlink(outside,original,target_is_directory=True)
    with pytest.raises(ValueError,match='path/symlink escape'):m.verify_resource_archive(project)
