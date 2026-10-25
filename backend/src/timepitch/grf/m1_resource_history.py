"""Read-only raw M1/TP065 archive; never initializes or grants execution."""

from pathlib import Path

from .m1_verifier import artifact,sha,read,_files

from .physical_wire import digest

ARCHIVE='.local/grf-m1-resource-source-archive'

ANCHOR=ARCHIVE+'-initialized.json'

STUDY='research/engine-evaluation/2026-10-18-grf-m1-resource-recovery'

BINDING=STUDY+'/source-binding.json'

DESCRIPTOR='research/engine-evaluation/2026-10-18-grf-clock-m1-worker/worker-profile.json'

WITNESS='.local/grf-m1-worker-profile-initialized.json'

CAMPAIGN='.local/grf-physical-work/priority-continuity'

GRANT_ANCHOR='.local/grf-priority-continuity-authorization-initialized.json'

REPORTS='research/engine-evaluation/2026-10-18-grf-m1-native-observation'

METADATA=(DESCRIPTOR,WITNESS,GRANT_ANCHOR)+tuple(CAMPAIGN+'/'+n for n in
    ('approval.json','authorization.json','authorization-witness.json','checkpoint.json','initialized.json','registration.json','supplement.json','events.jsonl'))+tuple(REPORTS+'/'+n for n in ('implementation-history.md','observation-report.json','preflight.json','proposal.json'))

def snapshot(root):
    s=read(artifact(root,CAMPAIGN+'/checkpoint.json'))
    if (set(s['runs'])!={'M-observe-42'} or s['runs']['M-observe-42']['state']!='failed' or
        s['terminal_failure']!=dict(id='M-observe-42',state='failed') or any(s[k] is not None for k in ('observe_proof','calibration_report','selection')) or s['heldout_opened'] is not False):
        raise ValueError('Original terminal42 state required')
    return dict(used=42,maximum=76,candidates=6,candidate_limit=6,terminal_id='M-observe-42',heldout_opened=False)

def source_members(root,doc):
    found=set()
    for inv in doc['inventories']:
        source=set(inv['members'])<=set(doc['source_sha256'])
        if not source:continue
        folder=artifact(root,inv['root'])
        actual={p.relative_to(root).as_posix() for p in folder.rglob(inv['pattern']) if p.is_file() and '__pycache__' not in p.parts and p.suffix!='.pyc'}
        for name in actual:artifact(root,name)
        found.update(actual-set(inv['members']))
    return found

def protected(root,doc,evidence):
    for k in ('runtime_sha256','static_sha256','parent_sha256'):_files(root,doc[k])
    _files(root,evidence)
    for inv in doc['inventories']:
        if set(inv['members'])<=set(doc['source_sha256']):continue
        folder=artifact(root,inv['root']);raw=inv['pattern']=='archive:*';pattern='*' if raw else inv['pattern']
        actual={p.relative_to(root).as_posix() for p in folder.rglob(pattern) if p.is_file() and (raw or '__pycache__' not in p.parts and p.suffix!='.pyc')}
        if actual!=set(inv['members']):raise ValueError('Protected inventory changed')
        for name in actual:artifact(root,name)

def verify_archive(project):
    root=Path(project).resolve();archive=artifact(root,ARCHIVE)
    # Every archived path stays anchored to the project, including directory roots.
    # artifact() deliberately resolves its root; passing an unchecked linked
    # source/metadata directory as that root would erase the escape evidence.
    def inside(name):return artifact(root,ARCHIVE+'/'+name)
    inside('source');inside('metadata')
    record=read(inside('record.json'))
    if set(record)!={'schema_version','profile_identity','source_sha256','metadata_sha256','evidence_sha256','parent_snapshot'} or record['schema_version']!='m1-resource-source-archive-1':raise ValueError('Resource archive schema')
    binding=dict(schema_version='m1-resource-source-binding-1',profile_identity=record['profile_identity'],record_sha256=sha(inside('record.json')))
    if any(read(p)!=binding for p in (inside('binding.json'),artifact(root,BINDING),artifact(root,ANCHOR))):raise ValueError('Resource archive witness missing/changed')
    if {p.name for p in archive.iterdir()}!={'source','metadata','record.json','binding.json'}:raise ValueError('Archive root membership changed')
    d=read(inside('metadata/'+DESCRIPTOR));h=digest(d)
    if record['profile_identity']!=h or record['source_sha256']!=d['source_sha256'] or set(record['metadata_sha256'])!=set(METADATA):raise ValueError('Archived identity/map changed')
    expected_witness=dict(schema_version='m1-worker-freeze-witness-1',profile_identity=h,descriptor_sha256=sha(inside('metadata/'+DESCRIPTOR)))
    if read(inside('metadata/'+WITNESS))!=expected_witness:raise ValueError('Archived profile witness changed')
    for group,folder in (('source_sha256','source'),('metadata_sha256','metadata')):
        base=inside(folder);actual={p.relative_to(base).as_posix() for p in base.rglob('*') if p.is_file()}
        if actual!=set(record[group]):raise ValueError('Archived membership changed')
        for n,want in record[group].items():
            if sha(inside(folder+'/'+n))!=want:raise ValueError('Archived raw bytes changed')
            if group=='metadata_sha256' and sha(artifact(root,n))!=want:raise ValueError('Original metadata changed')
    report=read(inside('metadata/'+REPORTS+'/observation-report.json'))
    if record['evidence_sha256']!=report['postcheck']['durable_files'] or record['parent_snapshot']!=snapshot(root):raise ValueError('Terminal/evidence binding changed')
    protected(root,d,record['evidence_sha256'])
    missing=[];modified=[]
    for n,want in record['source_sha256'].items():
        p=artifact(root,n)
        if not p.is_file():missing.append(n)
        elif sha(p)!=want:modified.append(n)
    return dict(profile_identity=h,record_sha256=binding['record_sha256'],source_count=len(record['source_sha256']),
        metadata_count=len(record['metadata_sha256']),**record['parent_snapshot'],live_added=sorted(source_members(root,d)),live_modified=sorted(modified),live_missing=sorted(missing))


def verify_resource_archive(project:Path)->dict:
    """Verify archive and protected artifacts; report live successor source changes."""
    try:
        return verify_archive(project)
    except (OSError,KeyError,TypeError,AttributeError) as error:
        raise ValueError("Invalid resource archive; never recreate missing witnesses") from error
