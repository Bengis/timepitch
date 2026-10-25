"""One linked supplement to the immutable 37 attempts. Never starts native code."""
import hashlib
import os
from pathlib import Path
from types import SimpleNamespace
from . import physical_campaign_budget as old
from .coordination_profile import STUDY,DESCRIPTOR,RUN_ROOT,load_coordination_profile,sha,read as _read
from .coordination_evidence import verify_source_archive
from .physical_wire import canonical,digest
from .coordination_budget import IDS,_exclusive,CoordinationLedger

APPROVAL=STUDY+'/phase5-authorization.json'
STATEMENT='Sí, apruebo el techo de 72 intentos, la sustitución de IDs y la quinta plaza de candidata. Empieza la fase 5.'
ANCHOR='.local/grf-coordination-authorization-initialized.json'


def read(path):
    try:return _read(path)
    except OSError as e:raise ValueError('Missing linked authorization metadata; never reset') from e


def _paths(project):
    root=project/RUN_ROOT
    return root,project/ANCHOR,root.parent/'coordination-supersession.json'


def supersession_present(project):
    root,anchor,supplement=_paths(project)
    return any(p.exists() for p in (project/APPROVAL,root,anchor,supplement,
        root.parent/'coordination-registration.json',root.parent/'coordination-initialized.json'))


def reject_legacy_reservation(project):
    if supersession_present(project):raise ValueError('Legacy schedule superseded by approved K1 supplement; no more legacy reservations')


def parent_snapshot(project):
    """Caller holds the existing global lock for every consequential use."""
    from .defensive_probe_budget import _extension_usage_locked
    project=Path(project).resolve();proof=verify_source_archive(project)
    root=project/'.local/grf-physical-work/continuation';state=old._load(root,root.parent/'continuation-registration.json')
    usage=_extension_usage_locked(root,state)
    expected=set(old.TECHNICAL)|{f'c4/calibration/{i:02}' for i in range(1,9)}
    if (usage['used']!=37 or usage['maximum']!=71 or usage['candidates']!=4 or len(state['prior_runs'])!=24 or
        set(state['runs'])!=expected or set(state['candidate_bindings'])!={'c1','c2','c3','c4'} or
        any(r['state']=='reserved' for r in state['runs'].values())):raise ValueError('Original37/candidates4 history changed')
    paths=[root/'checkpoint.json',project/state['campaign']['parent_checkpoint'],root.with_name('defensive-probe')/'checkpoint.json']
    paths += [p for p in root.parent.glob('*.json') if not p.name.startswith('coordination-')]
    return dict(used=37,candidates=4,maximum=71,campaign_identity=state['identity'],
        consumed_ids=sorted(state['runs']),superseded_ids=sorted(set(old.RUN_GROUPS)-set(state['runs'])),
        archive_binding_sha256=proof['binding_sha256'],files={p.relative_to(project).as_posix():sha(p) for p in sorted(set(paths))})


def _approval(project):
    value=read(project/APPROVAL)
    if value!=dict(schema_version='grf-coordination-user-approval-1',user_statement=STATEMENT,
        maximum=72,parent_used=37,candidate_limit=5,substitute_ids=True,execute_phase=5):raise ValueError('Explicit phase5 approval/72/IDs/fifth slot required')
    return sha(project/APPROVAL)


def verify_supersession(root,grant):
    """Read-only, portable, no recursive lock and no mutable-parent rebinding."""
    project=old.PROJECT_ROOT.resolve();root=Path(root).resolve();expected,anchor,supplement=_paths(project)
    try:
        if root!=expected.resolve():raise ValueError('Canonical linked root required')
        record=dict(root=str(root),authorization=grant)
        if read(anchor)!=record or read(supplement)!=record:raise ValueError('Missing/changed permanent supersession witness')
        if read(root/'supplement.json')!=record:raise ValueError('Linked append-only supplement changed')
        if (grant['approval_ref']!=APPROVAL or grant['approval_sha256']!=_approval(project) or
            grant['descriptor_sha256']!=sha(project/DESCRIPTOR) or grant['profile_identity']!=digest(read(project/DESCRIPTOR)) or
            grant['parent_snapshot']!=parent_snapshot(project)):raise ValueError('Linked approval/profile/parent archive changed')
    except (OSError,KeyError,TypeError) as e:raise ValueError('Missing linked supersession; never recreate it') from e


def register_coordination_authorization(root,approval_ref,parent_hashes,max_total=72):
    """Initialize exactly once after code/profile freeze; partial writes block renewal."""
    project=old.PROJECT_ROOT.resolve();root=Path(root).resolve();expected,anchor,supplement=_paths(project)
    if root!=expected.resolve() or approval_ref!=APPROVAL or type(max_total) is not int or max_total!=72:
        raise ValueError('Approved canonical coordination supplement required')
    with old._lock(root.parent/'continuation-registration.json'):
        approval_sha256=_approval(project);parent=parent_snapshot(project)
        if parent_hashes!=parent:raise ValueError('Original parent hashes changed before registration')
        profile=load_coordination_profile(project)
        if any(p.exists() for p in (root,anchor,supplement,root.parent/'coordination-registration.json',root.parent/'coordination-initialized.json')):
            grant=read(root/'authorization.json');verify_supersession(root,grant)
            # Verify the existing mutable ledger too; no reinitialization after data loss.
            store=object.__new__(CoordinationLedger);store.root=root;store.profile=profile;store.grant=grant;store._load()
            return grant
        grant=dict(schema_version='grf-coordination-authorization-1',profile_identity=profile.identity,native_sha256=profile.native_sha256,
            descriptor_sha256=sha(project/DESCRIPTOR),maximum=72,parent_used=37,parent_candidates=4,candidate_limit=5,
            run_ids=list(IDS),approval_ref=APPROVAL,approval_sha256=approval_sha256,parent_snapshot=parent)
        record=dict(root=str(root),authorization=grant)
        # Independent, exclusive witnesses precede the mutable root. A crash cannot grant free attempts.
        _exclusive(anchor,record);_exclusive(supplement,record)
        root.mkdir();_exclusive(root/'supplement.json',record);_exclusive(root/'authorization.json',grant)
        state=dict(schema_version='grf-coordination-ledger-1',grant_sha256=digest(grant),runs={},observe_proof=None,
            selection_sealed=False,heldout_opened=False,terminal_failure=None)
        # First journal entry, rather than an empty/replaceable grant ledger.
        event=dict(seq=0,previous=hashlib.sha256(b'').hexdigest(),event=dict(type='linked_authorization',parent_used=37),checkpoint=digest(state))
        with (root/'events.jsonl').open('xb') as f:f.write(canonical(event)+b'\n');f.flush();os.fsync(f.fileno())
        _exclusive(root/'checkpoint.json',state)
        receipt=dict(root=str(root),grant_sha256=digest(grant),checkpoint_sha256=digest(state),events_sha256=sha(root/'events.jsonl'))
        for name in ('coordination-registration.json','coordination-initialized.json'):_exclusive(root.parent/name,receipt)
        verify_supersession(root,grant);return grant


def usage_locked(project):
    root=Path(project)/RUN_ROOT;grant=read(root/'authorization.json');verify_supersession(root,grant)
    store=object.__new__(CoordinationLedger);store.root=root;store.profile=SimpleNamespace(project=project,identity=grant['profile_identity']);store.grant=grant
    state=store._load()
    return dict(original_used=37,extension_used=len(state['runs']),used=37+len(state['runs']),maximum=72,candidates=5 if state['runs'] else 4)
