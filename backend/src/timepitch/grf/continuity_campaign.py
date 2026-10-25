"""Prepared M1 schedule. Offline entry points have no native execution adapter."""
import argparse
import json
from pathlib import Path

from .continuity_profile import PROJECT_ROOT, RUN_ROOT, load_continuity_profile, plain, read
from .continuity_budget import (ContinuityLedger, validate_continuity_authorization, continuity_usage,
                                payload_key, digest)
from .action_gates import evaluate_action_gates, GATES


def evaluate_continuity_gates(rows, *, expected):
    """Reuse unchanged C4 absolute/policy gates, preserving M1 output identities."""
    failed = dict.fromkeys((*GATES, 'marking', 'guard_exercised'), False)
    if type(expected) is not int or expected not in (8, 24): raise ValueError('Complete original eight or24 fixtures required')
    try:
        if any(r['candidate_id'] != 'm1' for r in rows): return failed
        # Only the input to the C4 validator is projected. Its old thresholds,
        # 22-player coverage, pooled20-player distances, counters and resource
        # checks stay unchanged. Stored rows/reports always identify M1.
        base = evaluate_action_gates([dict(r, candidate_id='c4') for r in rows], expected=expected)
        valid = base['all_completed'] and all(r['complete'] is True and r['marking_valid'] is True and
            type(r['illegal_ownership']) is int and r['illegal_ownership'] == 0 and
            type(r['guard_events']) is int and 0 <= r['guard_events'] <= 2**63-1 for r in rows)
        return dict(**base, marking=bool(valid), guard_exercised=bool(valid and (expected == 24 or sum(r['guard_events'] for r in rows) > 0)))
    except (KeyError, TypeError, ValueError): return failed


def execute_stage(store, profile, stage, *, executor):
    """Future executor boundary, tested only with synthetic tmp_path ledgers."""
    if not callable(executor): raise ValueError('Explicit admitted execution adapter required')
    with store.locked():
        state = store.assert_stage(stage)
        if stage == 'heldout': store.seal_selection()
        if stage == 'calibration' and state['calibration_report'] is not None: return state['calibration_report']
        ids = ['M-observe-42'] if stage == 'observe' else [f'm1/{stage}/{i:02}' for i in range(1, (8 if stage == 'calibration' else 24)+1)]
        values = []
        for run_id in ids:
            # The ledger verifies profile/authorization/terminal parent again
            # under the same global lock before every irreversible claim.
            payload = profile.payload(payload_key(run_id)); reservation = store.reserve(run_id, payload)
            if reservation['reused']: values.append(reservation['row']); continue
            try:
                value = executor(run_id, payload)
                if not isinstance(value, dict) or value.get('complete') is not True: raise ValueError('Incomplete native result stops the study')
                result = store.finish(run_id, value); values.append(result)
            except BaseException as error:
                current = store._load()['runs'][run_id]
                if current['state'] == 'reserved':
                    store.finish(run_id, dict(complete=False, error_type=type(error).__name__, error=str(error)[-2000:]), failed=True)
                raise
        if stage == 'observe':
            try: store.accept_observation(values[0])
            except BaseException as error: store.stop(error); raise
            return dict(stage=stage, equivalent=True, rows=values, profile_identity=profile.identity)
        gates = evaluate_continuity_gates(values, expected=len(ids))
        report = dict(schema_version='m1-research-stage-1', stage=stage, profile_identity=profile.identity,
                      rows=values, gates=gates, qualified=all(gates.values()), publication='research-only-no-web')
        if stage == 'calibration': store.record_calibration(report)
        return report


def run_continuity_stage(project=PROJECT_ROOT, stage=None, *, executor=None):
    if stage not in ('observe', 'calibration', 'heldout'): raise ValueError('Explicit fixed M1 stage required')
    profile = load_continuity_profile(project)
    validate_continuity_authorization(project, profile)
    if profile.document['execution_adapter'] != 'admitted-frozen-native' or executor is None:
        raise ValueError('Native execution adapter is not admitted in offline Phase4; separate integration/approval required')
    if stage == 'heldout':
        selection = read(Path(project)/RUN_ROOT/'phase6-approval.json')
        if (selection.get('execute_phase') != 6 or selection.get('profile_identity') != profile.identity or
            selection.get('explicit_native') is not True or not selection.get('user_statement')):
            raise ValueError('Separate explicit Phase6 selection required')
    return execute_stage(ContinuityLedger(project, profile), profile, stage, executor=executor)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--status', action='store_true')
    group.add_argument('--stage', choices=('observe', 'calibration', 'heldout'))
    args = parser.parse_args()
    if args.status:
        print(json.dumps(dict(usage=continuity_usage(), native_execution=False,
            blockers=['separate clock design/approval/boundary tests', 'explicit linked76/6 grant', 'native executor integration/admission']), sort_keys=True))
    else: print(json.dumps(run_continuity_stage(stage=args.stage), sort_keys=True))


if __name__ == '__main__': main()
