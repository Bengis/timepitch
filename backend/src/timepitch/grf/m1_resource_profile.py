"""Exclusive offline resource freeze. Never a native grant or campaign entry."""
from pathlib import Path
from . import m1_resource_history as history,m1_resource_audit as audit
from .m1_verifier import artifact,read,sha,_files
from .m1_wire import write_exclusive
from .physical_wire import digest

STUDY=history.STUDY
PROFILE=STUDY+'/resource-profile.json'
WITNESS='.local/grf-m1-resource-profile-initialized.json'
EVIDENCE_PROFILE=audit.EVIDENCE_PROFILE
PHASE3_DIGEST='cbaf0942097286da365fad7546a37455f53eb381e946d2c072d32f6e1e977430'
ADDITIONS=('backend/src/timepitch/grf/m1_resource_profile.py','backend/tests/test_grf_m1_resource_profile.py')
RESOURCE_POLICY=dict(schema_version='m1-resource-budget-1',limit_seconds=600,limit_private_bytes=536870912,
    memory_scope='max-per-process; parent-Windows-lifetime-peak; child-observed-peak',clock_policy='m1-bounded-whistle-1')


def _prior_receipts(root):
    pins={'phase1-acceptance.json':audit.PHASE1_DIGEST,'phase2-acceptance.json':audit.PHASE2_DIGEST}
    result={}
    for name,pin in pins.items():
        path=artifact(root,STUDY+'/'+name)
        if digest(read(path))!=pin:raise ValueError('Prior accepted implementation changed')
        result[STUDY+'/'+name]=sha(path)
    for name,pin in (('offline-profile.json',audit.REFERENCE_SHA),('diagnosis.json',audit.DIAGNOSIS_SHA)):
        path=artifact(root,STUDY+'/'+name)
        if sha(path)!=pin:raise ValueError('Prior diagnostic reference changed')
        result[STUDY+'/'+name]=pin
    return result


def _phase3(root):
    accepted=read(artifact(root,STUDY+'/phase3-acceptance.json'))
    if digest(accepted)!=PHASE3_DIGEST:raise ValueError('Pinned executor acceptance changed')
    if (accepted['phase']!=3 or accepted['status']!='offline-validated' or
        any(accepted[k] is not False for k in ('native_authorized','web_admitted','original_failed_attempt_admitted','heldout_opened')) or
        accepted['full_audit_invocations']!=1 or accepted['new_native_matches']!=0 or accepted['new_real_reservations']!=0 or
        accepted['returned_verdict']['status']!='passed' or accepted['returned_verdict']['publication_complete'] is not True):
        raise ValueError('Completed offline-only executor acceptance required')
    if set(accepted['report_sha256'])!=set(audit.REPORT_NAMES):raise ValueError('Both provisional reports required')
    reports={}
    for name,pin in accepted['report_sha256'].items():
        path=artifact(root,STUDY+'/'+name)
        if sha(path)!=pin:raise ValueError('Accepted replay/performance report changed')
        r=read(path)
        if (r['status']!='provisional' or r['measured_verdict']!='passed' or r['publication_complete'] is not False or
            r['requires_executor_acceptance'] is not True or r['admission'] is not False or r['diagnostic_only'] is not True):
            raise ValueError('Diagnostic provisional reports required')
        reports[name]=r
    report=reports['phase3-replay-audit.json']
    if (report['evidence_profile_identity']!=EVIDENCE_PROFILE or accepted['evidence_profile_identity']!=EVIDENCE_PROFILE or
        digest(report['analysis_source_sha256'])!=accepted['analysis_source_identity'] or
        report['analysis_source_identity']!=accepted['analysis_source_identity']):raise ValueError('Phase3 source/evidence identity changed')
    return accepted,report


def _members(root,inventory):
    folder=artifact(root,inventory['root']);pattern=inventory['pattern']
    if pattern not in ('*.py','*','test_grf_m1_*.py','*.hpp','archive:*'):raise ValueError('Fixed inventory pattern required')
    # An unlisted linked directory can hide importable code even when rglob
    # does not descend into it. Check directories as well as measured files.
    for path in folder.rglob('*'):
        if path.is_dir() or path.is_symlink():artifact(root,path.relative_to(root).as_posix())
    raw=pattern=='archive:*'
    names=sorted(p.relative_to(root).as_posix() for p in folder.rglob('*' if raw else pattern)
        if p.is_file() and (raw or '__pycache__' not in p.parts and p.suffix!='.pyc'))
    for name in names:artifact(root,name)
    return names


def _gather(root):
    state=history.verify_resource_archive(root)
    if state['profile_identity']!=EVIDENCE_PROFILE or state['live_missing']:raise ValueError('Original complete resource archive required')
    old=read(artifact(root,history.ARCHIVE+'/metadata/'+history.DESCRIPTOR))
    record=read(artifact(root,history.ARCHIVE+'/record.json'))
    accepted,report=_phase3(root);extra=_prior_receipts(root)
    if state['record_sha256']!=accepted['history_after']['record_sha256']:
        raise ValueError('Accepted archive record changed since phase3')
    sources=audit._source_inventory(root,old);approved=report['analysis_source_sha256']
    if set(sources)!=set(approved)|set(ADDITIONS):raise ValueError('Only the two declared phase4 source additions are allowed')
    if any(sources[n]!=pin for n,pin in approved.items()):raise ValueError('Measured phase3 source changed')
    if history.snapshot(root)!={k:accepted['history_after'][k] for k in history.snapshot(root)}:
        raise ValueError('Accepted terminal state changed')
    inventories=[]
    for inv in old['inventories']:
        members=_members(root,inv)
        if not set(inv['members'])<=set(old['source_sha256']) and set(members)!=set(inv['members']):
            raise ValueError('Protected inventory changed')
        inventories.append(dict(inv,members=members))
    archive_inventory=dict(root=history.ARCHIVE,pattern='archive:*')
    archive_inventory['members']=_members(root,archive_inventory);inventories.append(archive_inventory)
    for name in (*audit.REPORT_NAMES,'phase3-acceptance.json','source-binding.json'):
        extra[STUDY+'/'+name]=sha(artifact(root,STUDY+'/'+name))
    for name in (history.ANCHOR,*archive_inventory['members']):extra[name]=sha(artifact(root,name))
    static={**old['static_sha256'],**extra}
    parents={**record['metadata_sha256'],**record['evidence_sha256']}
    return dict(schema_version='m1-resource-profile-1',worker_status='offline-validated',native_authorized=False,web_admitted=False,
        parent_profile=EVIDENCE_PROFILE,resource_policy=dict(RESOURCE_POLICY),source_sha256=sources,
        runtime_sha256=old['runtime_sha256'],static_sha256=static,parent_sha256=old['parent_sha256'],inventories=inventories,
        parent_snapshot=dict(history.snapshot(root),files=parents),native_sha256=old['native_sha256'],
        build_manifest_sha256=old['build_manifest_sha256'],archive_binding_sha256=sha(artifact(root,history.BINDING)),
        replay_audit_sha256=sha(artifact(root,STUDY+'/phase3-replay-audit.json')),
        performance_sha256=sha(artifact(root,STUDY+'/phase3-performance.json')),
        phase3_acceptance_sha256=sha(artifact(root,STUDY+'/phase3-acceptance.json')))


def _verify(project):
    root=Path(project).resolve();path=artifact(root,PROFILE);witness=artifact(root,WITNESS)
    document=read(path);identity=digest(document)
    expected=dict(schema_version='m1-resource-freeze-witness-1',profile_identity=identity,descriptor_sha256=sha(path))
    if read(witness)!=expected:raise ValueError('Lost/changed resource freeze witness; never refreeze')
    if document!=_gather(root):raise ValueError('Offline resource profile/closure changed')
    for group in ('source_sha256','runtime_sha256','static_sha256','parent_sha256'):_files(root,document[group])
    _files(root,document['parent_snapshot']['files'])
    return dict(profile_identity=identity,descriptor_sha256=expected['descriptor_sha256'],worker_status='offline-validated',
        native_authorized=False,web_admitted=False,source_count=len(document['source_sha256']),
        runtime_count=len(document['runtime_sha256']),static_count=len(document['static_sha256']),
        parent_snapshot={k:v for k,v in document['parent_snapshot'].items() if k!='files'})


def verify_resource_profile(project:Path)->dict:
    """Read-only verification; no native admission, allocation or recovery."""
    try:return _verify(project)
    except (OSError,KeyError,TypeError,AttributeError) as failure:
        raise ValueError('Invalid offline resource profile; never recreate witnesses') from failure


def freeze_resource_profile(project:Path)->dict:
    """Exclusive one-way initialization; any partial seal remains consumed."""
    root=Path(project).resolve();path=artifact(root,PROFILE);witness=artifact(root,WITNESS)
    if path.exists() or witness.exists():raise ValueError('Resource freeze already attempted; never refreeze')
    document=_gather(root);identity=digest(document)
    witness.parent.mkdir(parents=True,exist_ok=True);path.parent.mkdir(parents=True,exist_ok=True)
    write_exclusive(witness,dict(schema_version='m1-resource-freeze-witness-1',profile_identity=identity,descriptor_sha256=identity),8*1024*1024)
    write_exclusive(path,document,8*1024*1024)
    return verify_resource_profile(root)
