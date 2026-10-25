"""Explicit real-model acceptance on a historical local match; no service/model startup."""
import asyncio
import json
from pathlib import Path
from contextlib import ExitStack
from .analysis import LocalAgentRunner
from .service import ExplanationService
from .models import ExplanationRequest, PROMPT_VERSION
from ..config import ROOT, DATASET, ADVANCED_DATASET
from ..catalog.repository import CatalogRepository
from ..simulation.engine import simulate_match, make_config
from ..matches.repository import MatchRepository
from ..runtime import RuntimeLease


def require_prepared(manager):
    from foundry_local.models import DeviceType
    info=manager.get_model_info('qwen2.5-1.5b',device=DeviceType.GPU)
    if info.id!='qwen2.5-1.5b-instruct-generic-gpu:4':
        raise RuntimeError('Model revision needs separate acceptance')
    if not any(model.id==info.id for model in manager.list_loaded_models()):
        raise RuntimeError('Load the prepared TimePitch model explicitly before acceptance')


async def _run_prepared(runner):
    catalog = CatalogRepository(DATASET,ADVANCED_DATASET)
    record = simulate_match(make_config(catalog, 'arsenal:2025', 'mancity:2025',seed=42), catalog)
    repository = MatchRepository(ROOT / '.local/agent-acceptance-grounded-2.sqlite')
    match = repository.create(record.config, 'acceptance'); repository.start(match.id, 'acceptance'); repository.finish(match.id, 'acceptance', record)
    service = ExplanationService(repository, lambda: runner, runner.model_id)
    results = []
    try:
        combinations = [('en', 'fan', window,None) for window in ('moment', 'halftime', 'fulltime')]
        combinations += [('en','analyst','fulltime','chance_quality_edge'),('es','fan','fulltime','territory_edge'),('es','analyst','fulltime','distance_leader')]
        for locale, mode, window, category in combinations:
            runner.preferred_category=category
            request = ExplanationRequest(window_id=window, revision=record.trace_hash, locale=locale, mode=mode)
            job = service.submit(match.id, 'acceptance', request)
            for _ in range(1500):
                await asyncio.sleep(.1)
                job = service.get(match.id, job.id, 'acceptance')
                if job.state != 'pending': break
            result = {'window': window, 'locale': locale, 'mode': mode, 'state': job.state,
                      'error': job.error, 'calls_reserved': job.calls_reserved, 'latency_ms': job.latency_ms,
                      'text': job.text, 'category': job.explanation.category if job.explanation else None,
                      'prompt_version':job.prompt_version,
                      'explanation':job.explanation.model_dump(mode='json') if job.explanation else None}
            results.append(result)
            print(json.dumps(result, ensure_ascii=True), flush=True)
            if category and (not job.explanation or job.explanation.category!=category):break
        assert repository.get_record(match.id, 'acceptance').trace_hash == record.trace_hash
        output = {'model_id': runner.model_id, 'tool_calls': runner.tool_calls, 'trace_hash': record.trace_hash,
                  'results': results, 'ready': len(results)==6 and all(r['state'] == 'ready' and r['prompt_version']==PROMPT_VERSION and r['calls_reserved']<=4 for r in results) and runner.tool_calls == 6}
        destination = ROOT / '.local/agent-acceptance-grounded-2.json'
        destination.write_text(json.dumps(output, indent=2, ensure_ascii=False), encoding='utf-8')
        return output['ready']
    finally: await service.close()


async def run_acceptance():
    with ExitStack() as leases:
        leases.enter_context(RuntimeLease(ROOT/'.local/agent-acceptance.lock'))
        leases.enter_context(RuntimeLease(ROOT/'.local/inference.lock'))
        runner=LocalAgentRunner()
        try:
            require_prepared(runner.transport.client.manager)
        except BaseException:
            await runner.close()
            raise
        return await _run_prepared(runner)


if __name__ == '__main__':
    raise SystemExit(0 if asyncio.run(run_acceptance()) else 1)
