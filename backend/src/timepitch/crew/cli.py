"""python -m timepitch.crew run --local <source> <locale> --envelope <file> ...

A real run refuses unless a valid private envelope (CrewGrant) is given. The source is a
local TimePitch replay or a frozen FactPack JSON (for example one built with from_grf).
"""
import argparse
import asyncio
import json
import os
from pathlib import Path
import sys

from ..chronicles.models import FactPack
from .ledger import CrewLedger, EnvelopeRefused, load_grant
from .models import CrewBinding, default_binding
from .tracing import setup_tracing


def load_source(path: Path) -> FactPack:
    raw = Path(path).read_bytes()
    if len(raw) > 64 * 1024 * 1024:
        raise ValueError('Source exceeds bound')
    try:
        data = json.loads(raw)
    except ValueError:
        data = None
    if isinstance(data, dict) and data.get('fact_version') == 'chronicle-facts-1':
        return FactPack.model_validate_json(raw)
    from ..chronicles.facts import from_timepitch
    from ..simulation.replay import parse_replay, trace_hash
    record = parse_replay(raw)
    if trace_hash(record) != record.trace_hash:
        raise ValueError('Source trace changed')
    return from_timepitch(record)


async def _run(args) -> int:
    from .agents import CrewAgents, SendGate, bounded_client, chat_client
    from .workflow import CrewRuntime, run_crew
    binding = CrewBinding.model_validate_json(Path(args.binding).read_bytes()) if args.binding else default_binding()
    grant, grant_sha256 = load_grant(Path(args.envelope), binding, expected_sha256=args.envelope_sha256)
    if grant.purpose != 'crew':
        raise EnvelopeRefused('envelope_purpose')
    if args.locale not in grant.locales:
        raise EnvelopeRefused('locale_outside_envelope')
    pack = load_source(Path(args.local))
    ledger = CrewLedger(Path(args.ledger), grant, grant_sha256)
    tracer = setup_tracing(Path(args.trace_connection) if args.trace_connection else None)
    client = None
    try:
        gate = SendGate(ledger)
        client = bounded_client(binding, model_secret(args), gate)
        runtime = CrewRuntime(pack=pack, locale=args.locale, binding=binding, grant=grant, grant_sha256=grant_sha256,
                              ledger=ledger, gate=gate, agents=CrewAgents(chat_client(binding, client)), tracer=tracer)
        report = await run_crew(runtime)
        out = Path(args.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(report.model_dump_json(indent=2).encode())
        if os.name != 'nt':
            out.chmod(0o600)
        print(json.dumps({'provenance': report.provenance, 'report_sha256': report.report_sha256,
                          'total_cost': str(report.total_cost), 'requests': gate.admitted}))
        return 0
    finally:
        if client is not None:
            await client.close()
        ledger.close()
        tracer.shutdown()


def model_secret(args) -> str:
    """API key from the private key file, or an Entra token (--entra: DefaultAzureCredential)."""
    from .agents import entra_token, read_credential
    if getattr(args, 'entra', False):
        return entra_token()
    return read_credential(Path(args.credential))


async def _evaluate(args) -> int:
    from ..chronicles.models import FactPack
    from .agents import SendGate, bounded_client, read_credential
    from .evaluation import bounded_sdk, evaluate_report, judge_evaluators, log_to_project, seal_results
    from .models import CrewReport
    binding = CrewBinding.model_validate_json(Path(args.binding).read_bytes()) if args.binding else default_binding()
    grant, grant_sha256 = load_grant(Path(args.envelope), binding, expected_sha256=args.envelope_sha256)
    if grant.purpose != 'evaluation':
        raise EnvelopeRefused('envelope_purpose')
    pairs = [(CrewReport.model_validate_json(Path(r).read_bytes()), load_source(Path(p))) for r, p in args.pair]
    if any(report.locale not in grant.locales for report, _ in pairs):
        raise EnvelopeRefused('locale_outside_envelope')
    ledger = CrewLedger(Path(args.ledger), grant, grant_sha256)
    tracer = setup_tracing(Path(args.trace_connection) if args.trace_connection else None)
    gate = SendGate(ledger)
    client = None
    try:
        client = bounded_client(binding, read_credential(Path(args.credential)), gate)
        evaluators = judge_evaluators(binding, client.api_key)
        rows = []
        with bounded_sdk(client._client):
            for report, pack in pairs:
                rows.append(await evaluate_report(report=report, pack=pack, binding=binding, grant=grant, ledger=ledger,
                                                  gate=gate, tracer=tracer, evaluators=evaluators))
        results = seal_results(rows, binding, grant_sha256)
        out = Path(args.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(json.dumps(results, indent=1, ensure_ascii=False).encode())
        if os.name != 'nt':
            out.chmod(0o600)
        logged = None
        if args.project_endpoint:
            try:
                log_to_project(results, args.project_endpoint)
                logged = 'foundry_project'
            except Exception:
                logged = 'local_only'  # needs an Entra identity with access to the project
        print(json.dumps({'results_sha256': results['results_sha256'], 'total_cost': results['total_cost'],
                          'requests': gate.admitted, 'logged': logged or 'local_only'}))
        return 0
    finally:
        if client is not None:
            await client.close()
        ledger.close()
        tracer.shutdown()


def freeze_recorded(recording: Path, events: Path, out: Path) -> str:
    """Write the FactPack of a served GRF physical recording + sidecar; returns its fact hash."""
    from ..chronicles.models import canonical_bytes, fact_pack_hash
    from ..chronicles.recorded_facts import from_grf_recorded
    pack = from_grf_recorded(Path(recording).read_bytes(), Path(events).read_bytes())
    Path(out).write_bytes(canonical_bytes(pack))
    return fact_pack_hash(pack)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog='python -m timepitch.crew', description='TimePitch crew report (envelope required)')
    sub = parser.add_subparsers(dest='command', required=True)
    run = sub.add_parser('run', help='One crew report for a local saved source')
    run.add_argument('--local', required=True, metavar='SOURCE', help='TimePitch replay or frozen FactPack JSON')
    run.add_argument('locale', choices=['en', 'es'])
    run.add_argument('--envelope', help='Private CrewGrant JSON file (required for any run)')
    run.add_argument('--envelope-sha256', help='Expected sha256 of the envelope file')
    run.add_argument('--binding', help='CrewBinding JSON; defaults to the gpt-4.1-mini binding')
    run.add_argument('--credential', help='Private key file')
    run.add_argument('--entra', action='store_true', help='Entra token (DefaultAzureCredential) instead of a key file')
    run.add_argument('--ledger', help='Ledger SQLite path, for example under .local/crew/')
    run.add_argument('--out', help='Private report JSON path')
    run.add_argument('--trace-connection', help='Private Application Insights connection-string file (optional)')
    ev = sub.add_parser('evaluate', help='Foundry evaluations of CrewReports (evaluation envelope required)')
    ev.add_argument('--pair', nargs=2, action='append', required=True, metavar=('REPORT', 'FACTPACK'))
    ev.add_argument('--envelope', help='Private CrewGrant JSON with purpose=evaluation')
    ev.add_argument('--envelope-sha256')
    ev.add_argument('--binding')
    ev.add_argument('--credential')
    ev.add_argument('--ledger')
    ev.add_argument('--out', help='Private results JSON path')
    ev.add_argument('--trace-connection')
    ev.add_argument('--project-endpoint', help='Foundry project endpoint to log the run (needs an Entra identity)')
    freeze = sub.add_parser('freeze-recorded', help='Freeze a FactPack from a GRF recording and its events sidecar (no network)')
    freeze.add_argument('--recording', required=True)
    freeze.add_argument('--events', required=True)
    freeze.add_argument('--out', required=True)
    from .cloud import add_cloud_commands, run_cloud_command
    add_cloud_commands(sub)
    args = parser.parse_args(argv)
    if args.command in ('enqueue', 'job', 'fetch'):
        return run_cloud_command(args)
    if args.command == 'freeze-recorded':
        print(json.dumps({'fact_hash': freeze_recorded(args.recording, args.events, args.out)}))
        return 0
    needed = ('envelope', 'ledger', 'out') if getattr(args, 'entra', False) else ('envelope', 'credential', 'ledger', 'out')
    missing = [name for name in needed if not getattr(args, name)]
    if missing:
        print('Refused: a crew run needs ' + ', '.join('--' + m for m in missing) + '.', file=sys.stderr)
        return 2
    try:
        return asyncio.run(_evaluate(args) if args.command == 'evaluate' else _run(args))
    except EnvelopeRefused as exc:
        print('Refused by envelope: ' + exc.code, file=sys.stderr)
        return 2
    except Exception:
        print('Crew run stopped safely; inspect the private ledger before any retry.', file=sys.stderr)
        return 1
