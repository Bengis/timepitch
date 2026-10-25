"""Read-only parent accounting and a consumer of future M1 grants. No initializer."""
from contextlib import contextmanager
from dataclasses import dataclass
import hashlib
import os
from pathlib import Path
import threading

from .continuity_profile import (PROJECT_ROOT, RUN_ROOT, STUDY, load_continuity_profile,
                                 sha, read, plain, artifact)
from .physical_wire import canonical, digest

IDS = ('M-observe-42',)+tuple(f'm1/calibration/{i:02}' for i in range(1, 9))+tuple(
    f'm1/heldout/{i:02}' for i in range(1, 25))+('m1/R-selected', 'm1/W-local')
ANCHOR = '.local/grf-priority-continuity-authorization-initialized.json'
_held = threading.local()


def digest_bytes(data): return hashlib.sha256(data).hexdigest()


@contextmanager
def global_lock(project):
    """Same reservation lock as all predecessors, reentrant only on this thread."""
    root = Path(project).resolve(); key = str(root)
    counts = getattr(_held, 'counts', {}); _held.counts = counts
    if counts.get(key, 0):
        counts[key] += 1
        try: yield
        finally: counts[key] -= 1
    else:
        from .physical_campaign_budget import _lock
        with _lock(root/'.local/grf-physical-work/continuation-registration.json'):
            counts[key] = 1
            try: yield
            finally: del counts[key]


def parent_snapshot(project):
    """Verify the terminal 41-attempt history; never reload a drifted K1 profile."""
    root = Path(project).resolve()
    if root != PROJECT_ROOT.resolve(): raise ValueError('Canonical real parent history required')
    from .coordination_authorization import usage_locked, parent_snapshot as original_parent
    with global_lock(root):
        usage = usage_locked(root); state_path = root/'.local/grf-physical-work/coordination/checkpoint.json'; state = read(state_path)
        expected = {'K-observe-42': 'ready', 'k1/calibration/01': 'ready', 'k1/calibration/02': 'ready', 'k1/calibration/03': 'failed'}
        if (usage['used'], usage['maximum'], usage['candidates']) != (41, 72, 5) or {
            k: v['state'] for k, v in state['runs'].items()} != expected:
            raise ValueError('Original 41/72 and five candidates changed')
        if state['terminal_failure'] != dict(id='k1/calibration/03', state='failed') or state['heldout_opened'] or state['selection_sealed']:
            raise ValueError('K1 must remain terminal with heldout unopened')
        prior = original_parent(root)
        refs = dict(prior['files'])
        old_root = state_path.parent
        for name in ('checkpoint.json', 'events.jsonl', 'authorization.json', 'supplement.json'):
            refs[(old_root/name).relative_to(root).as_posix()] = sha(old_root/name)
        for name in ('coordination-registration.json', 'coordination-initialized.json', 'coordination-supersession.json'):
            p = old_root.parent/name; refs[p.relative_to(root).as_posix()] = sha(p)
        for name in ('.local/grf-coordination-authorization-initialized.json',
                     'research/engine-evaluation/2026-10-18-grf-defensive-coordination/phase5-authorization.json'):
            refs[name] = sha(root/name)
        return dict(used=41, maximum=72, candidates=5, terminal_id='k1/calibration/03', files=refs,
                    heldout_opened=False, selection_sealed=False, legacy_retired=True)


@dataclass(frozen=True)
class Authorization:
    profile_identity: str
    maximum: int
    candidate_limit: int
    grant_sha256: str


def _clock(project, profile, root):
    value = read(root/'clock.json')
    expected = {'schema_version', 'approved', 'design', 'design_sha256', 'source_sha256',
                'saved_c4_gameplay_unchanged', 'common_reference_candidate', 'boundary_tests', 'approval_ref'}
    if set(value) != expected or value['schema_version'] != 'm1-clock-acceptance-1' or value['approved'] is not True:
        raise ValueError('Separate approved clock deliverable required')
    if value['saved_c4_gameplay_unchanged'] is not True or value['common_reference_candidate'] is not True:
        raise ValueError('Clock changed saved C4 gameplay: revise design, control and costs first')
    if not value['design'].startswith('docs/superpowers/specs/') or sha(artifact(project, value['design'])) != value['design_sha256']:
        raise ValueError('Approved clock design identity')
    if canonical(value['source_sha256']) != canonical(plain(profile.document['clock_gate']['reference_source_sha256'])):
        raise ValueError('Common immutable clock source required')
    for name, h in value['source_sha256'].items():
        if sha(artifact(project, name)) != h: raise ValueError('Clock source changed')
    if canonical(value['boundary_tests']) != canonical(dict(long_open_play=True, pending_penalty=True, pending_restart=True)) or not value['approval_ref']:
        raise ValueError('Approved clock boundary tests required')


def validate_continuity_authorization(project, profile):
    project = Path(project).resolve(); root = project/RUN_ROOT
    if profile.project != project: raise ValueError('Profile project mismatch')
    try:
        grant = read(root/'authorization.json')  # Absence does not create even a lock/root.
        approval = read(root/'approval.json')
        expected_approval = dict(schema_version='m1-user-approval-1', maximum=76, candidate_limit=6, parent_used=41,
            run_ids=list(IDS), execute_phase=5, explicit_native=True, user_statement=approval.get('user_statement'))
        if canonical(approval) != canonical(expected_approval) or not isinstance(approval['user_statement'], str) or not approval['user_statement'].strip():
            raise ValueError('Explicit native Phase5 /76/6/linked IDs approval required')
        expected = dict(schema_version='m1-linked-authorization-1', profile_identity=profile.identity,
            maximum=76, parent_used=41, parent_candidates=5, candidate_limit=6, run_ids=list(IDS),
            approval_sha256=sha(root/'approval.json'), clock_sha256=sha(root/'clock.json'), parent_snapshot=plain(profile.document['parent']))
        if canonical(grant) != canonical(expected): raise ValueError('M1 approval, linked IDs, ceiling or sixth candidate mismatch')
        for path in (root/'supplement.json', root/'authorization-witness.json', project/ANCHOR):
            if canonical(read(path)) != canonical(grant): raise ValueError('Missing/changed permanent linked witness; never renew')
        with global_lock(project):
            if canonical(parent_snapshot(project)) != canonical(plain(profile.document['parent'])): raise ValueError('Terminal parent history changed')
            if load_continuity_profile(project).identity != profile.identity: raise ValueError('Frozen profile changed before authorization')
            _clock(project, profile, root)
        return Authorization(profile.identity, 76, 6, digest(grant))
    except (OSError, KeyError, TypeError, AttributeError) as e: raise ValueError('Missing/invalid linked M1 authorization; no reset') from e


def continuity_usage(project=PROJECT_ROOT):
    project = Path(project).resolve(); root = project/RUN_ROOT
    with global_lock(project):
        parent = parent_snapshot(project)
        if root.exists() or (project/ANCHOR).exists():
            return ContinuityLedger(project, load_continuity_profile(project)).usage()
        return dict(used=parent['used'], maximum=parent['maximum'], candidates=parent['candidates'], candidate_limit=5)


def payload_key(run_id):
    if run_id == 'M-observe-42': return 'calibration/01'
    if run_id not in IDS or run_id.endswith(('R-selected', 'W-local')): raise ValueError('Fixed M1 schedule only; legacy/repetition/product IDs forbidden')
    return '/'.join(run_id.split('/')[1:])


from .campaign_ledger import CampaignLedger,_exclusive,_replace


class ContinuityLedger(CampaignLedger):
    """Historical wrapper: the original grant verifier and lock are unchanged."""
    def __init__(self,project,profile):
        super().__init__(project,profile,validate_continuity_authorization)
