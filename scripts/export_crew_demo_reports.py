"""Exporta las crónicas del crew (TP246) a `web/public/data/crew/reports.json`, el fichero estático que lee la demo.

Uso: python scripts/export_crew_demo_reports.py INFORME.json[.gz] [...] --evaluation RESULTADOS.json --out FICHERO

Cada informe se valida con el modelo `CrewReport` y su sello (`report_sha256`); solo se exportan borradores IA que
pasaron el verificador (`crew_ai_draft_checked`). La evaluación de Foundry se toma de los resultados sellados por
`report_sha256` (fundamentación, coherencia y fluidez, de 1 a 5). No hace llamadas de red.
"""
import argparse, gzip, json, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend' / 'src'))
from timepitch.crew.models import CrewReport, seal_report  # noqa: E402

JUDGE_METRICS = ('groundedness', 'coherence', 'fluency')


def read_bytes(path: Path) -> bytes:
    raw = path.read_bytes()
    return gzip.decompress(raw) if raw[:2] == b'\x1f\x8b' else raw


def read_json(path: Path):
    return json.loads(read_bytes(path))


def main(argv=None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('reports', nargs='+', type=Path)
    parser.add_argument('--evaluation', type=Path, help='Sealed evaluation results (optional)')
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args(argv)
    scores = {}
    if args.evaluation:
        for row in read_json(args.evaluation)['rows']:
            metrics = row['metrics']
            if all(isinstance(metrics.get(m), dict) and metrics[m].get('score') is not None for m in JUDGE_METRICS):
                scores[row['report_sha256']] = {m: metrics[m]['score'] for m in JUDGE_METRICS}
    out = []
    for path in args.reports:
        report = CrewReport.model_validate_json(read_bytes(path))
        if seal_report(report).report_sha256 != report.report_sha256:
            raise SystemExit(f'{path}: report seal does not match')
        if report.provenance != 'crew_ai_draft_checked' or report.draft is None:
            raise SystemExit(f'{path}: not an AI draft checked by the verifier')
        models = sorted({s.model for s in report.steps if s.model})
        out.append({
            'trace_hash': report.source.trace_hash, 'locale': report.locale, 'engine': report.source.engine,
            'headline': report.draft.headline.text,
            'paragraphs': [[s.text for s in p.sentences] for p in report.draft.paragraphs],
            'coverage_notes': list(report.coverage_notes),
            'model': 'gpt-4.1-mini' if all(m.startswith('gpt-4.1-mini') for m in models) else ', '.join(models),
            'total_cost': str(report.total_cost), 'report_sha256': report.report_sha256,
            'evaluation': scores.get(report.report_sha256),
        })
    out.sort(key=lambda r: (r['trace_hash'], r['locale']))
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps({'version': 'crew-demo-reports-1', 'reports': out}, indent=1, ensure_ascii=False) + '\n',
                        encoding='utf-8', newline='\n')
    print(json.dumps([{k: r[k] for k in ('locale', 'engine', 'report_sha256', 'evaluation')} for r in out]))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
