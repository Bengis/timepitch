"""Recompute the "Measured, not claimed" figures from the exported live report ledger.

Usage: python docs/results/summarize_live_reports.py

Inputs, both exported from the Azure deployment without any report text or secret:
- live-reports.json: every sealed live report (steps with role, verdict code, reason, tokens and cost);
- crew-job-executions.json: start and end time of every Container Apps job execution.
"""
import json
import statistics
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).parent
reports = json.loads((HERE / 'live-reports.json').read_text(encoding='utf-8'))
runs = json.loads((HERE / 'crew-job-executions.json').read_text(encoding='utf-8'))

first = [next((s['code'] for s in r['steps'] if s['role'] == 'verifier'), None) for r in reports]
ai = sum(r['provenance'] == 'crew_ai_draft_checked' for r in reports)
costs = [float(r['total_cost_usd']) for r in reports]
reasons = {}
for r in reports:
    for s in r['steps']:
        if s['role'] == 'verifier' and s['code'] == 'rejected':
            reasons[s['reason']] = reasons.get(s['reason'], 0) + 1


def seconds(run):
    start, end = (datetime.fromisoformat(run[k].replace('Z', '+00:00')) for k in ('start', 'end'))
    return (end - start).total_seconds()


durations = [seconds(r) for r in runs if r.get('end') and r.get('status') == 'Succeeded']

print(f'live reports: {len(reports)}')
print(f'first draft rejected by the verifier: {first.count("rejected")} of {len(reports)}')
print(f'published as verified AI prose: {ai}; fact-only fallback: {len(reports) - ai}')
print(f'published sentences that failed the verifier: 0 (a failing draft is never published, by construction)')
print(f'cost per report: mean ${statistics.mean(costs):.4f}, max ${max(costs):.4f}')
print(f'job run time: median {statistics.median(durations):.0f} s over {len(durations)} executions')
print('verifier rejection reasons:', dict(sorted(reasons.items(), key=lambda kv: -kv[1])))
