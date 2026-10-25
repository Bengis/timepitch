import asyncio
from pathlib import Path
import pytest
from timepitch.catalog.repository import CatalogRepository
from timepitch.simulation.engine import simulate_match, make_config
from timepitch.matches.repository import MatchRepository
from timepitch.agents.models import ExplanationRequest
from timepitch.agents.models import ExplanationJob
from timepitch.agents.service import ExplanationService, ExplanationQueueFull, ExplanationBudgetExceeded
from timepitch.agents.provider import LocalModelTimeout
from timepitch.agents.tools import MatchTools, build_windows


@pytest.fixture(scope='module')
def record():
    catalog = CatalogRepository(Path(__file__).resolve().parents[2] / 'research/data-audit/2026-10-16/derived/coverage.sqlite')
    return simulate_match(make_config(catalog, 'arsenal:2003', 'mancity:2017'), catalog)


class ScriptedRunner:
    def __init__(self, fail=False, bad=False): self.fail, self.bad, self.calls, self.handoff = fail, bad, 0, []
    async def analyze(self, window, tools, reserve):
        if self.fail: raise ConnectionError('offline')
        reserve(2); self.calls += 2
        facts = tools.read_window()
        assert facts['events'] and facts['metrics']
        reserve(1); self.calls += 1
        return {'window_id': window.id, 'revision': window.revision, 'category': 'overview', 'side': None,
                'event_ids': [window.event_ids[-1]], 'player_keys': [], 'score': {'home': 99, 'away': 0} if self.bad else window.score.model_dump()}
    async def narrate(self, analysis, locale, mode, reserve):
        self.handoff.append(analysis); reserve(1); self.calls += 1
        return {**analysis.model_dump(exclude={'side'}), 'locale': locale, 'mode': mode, 'variant': 0}


def store(tmp_path, record):
    repo = MatchRepository(tmp_path / 'runtime.sqlite'); job = repo.create(record.config, 'owner'); repo.start(job.id, 'owner'); repo.finish(job.id, 'owner', record)
    return repo, job.id


async def ready(service, job):
    for _ in range(100):
        value = service.get(job.match_id, job.id, 'owner')
        if value.state != 'pending': return value
        await asyncio.sleep(.01)
    pytest.fail('Explanation never finished')


def test_workflow_handoff_cache_persisted_budget_and_owner(tmp_path, record):
    async def run():
        repo, match_id = store(tmp_path, record); runner = ScriptedRunner(); service = ExplanationService(repo, lambda: runner, 'test-model')
        try:
            for window in ('moment', 'halftime', 'fulltime'):
                request = ExplanationRequest(window_id=window, revision=record.trace_hash, locale='en', mode='fan')
                job = service.submit(match_id, 'owner', request)
                result = await ready(service, job)
                assert result.state == 'ready' and result.provenance == 'local_ai'
                assert result.explanation.category == runner.handoff[-1].category
                assert service.submit(match_id, 'owner', request).id == job.id
            assert runner.calls == 12
            with pytest.raises(KeyError): service.get(match_id, job.id, 'intruder')
            with pytest.raises(KeyError): service.submit(match_id, 'intruder', request)
            assert repo.get_record(match_id, 'owner').trace_hash == record.trace_hash
        finally: await service.close()
        reopened = ExplanationService(repo, lambda: ScriptedRunner(), 'test-model')
        try: assert reopened.submit(match_id, 'owner', request).id == job.id
        finally: await reopened.close()
    asyncio.run(run())


def test_unavailable_model_is_labelled_and_can_recover_once_without_changing_match(tmp_path, record):
    async def run():
        repo, match_id = store(tmp_path, record); runner = ScriptedRunner(fail=True); service = ExplanationService(repo, lambda: runner, 'test-model')
        try:
            request = ExplanationRequest(window_id='fulltime', revision=record.trace_hash, locale='es', mode='analyst')
            result = await ready(service, service.submit(match_id, 'owner', request))
            assert result.state == 'unavailable' and result.provenance == 'deterministic_fallback'
            runner.fail = False
            result = await ready(service, service.submit(match_id, 'owner', request.model_copy(update={'retry': True})))
            assert result.state == 'ready' and result.calls_reserved == 4
            assert repo.get_record(match_id, 'owner').trace_hash == record.trace_hash
        finally: await service.close()
    asyncio.run(run())


def test_false_analysis_is_rejected_before_narration(tmp_path, record):
    async def run():
        repo, match_id = store(tmp_path, record); runner = ScriptedRunner(bad=True); service = ExplanationService(repo, lambda: runner, 'test-model')
        try:
            request = ExplanationRequest(window_id='fulltime', revision=record.trace_hash, locale='en', mode='fan')
            result = await ready(service, service.submit(match_id, 'owner', request))
            assert result.state == 'rejected' and result.provenance == 'deterministic_fallback'
            assert runner.handoff == []
            with pytest.raises(ValueError): service.submit(match_id, 'owner', request.model_copy(update={'revision': 'old'}))
        finally: await service.close()
    asyncio.run(run())


def test_tools_refuse_other_match_window_and_arbitrary_events(record):
    tools = MatchTools('owned', record, build_windows(record)[0])
    for call in (lambda: tools.get_events('other', []), lambda: tools.get_events('owned', ['invented']),
                 lambda: tools.get_metrics('owned', 'other'),lambda:tools.get_statistics('other',tools.window.id),
                 lambda:tools.get_statistics('owned','other')):
        with pytest.raises(ValueError): call()
    tools.read_window()
    with pytest.raises(ValueError): tools.read_window()


@pytest.mark.parametrize('version', ['legacy', 'spatial'])
def test_windows_never_include_later_actions_scores_or_full_motion(record, version):
    if version == 'legacy':
        from test_replay_versions import legacy_record
        record = legacy_record()
    for window in build_windows(record):
        elapsed = [e for e in record.events if e.t1_ms <= window.end_ms]
        assert window.score.home == sum(e.type == 'goal' and e.side == 'home' for e in elapsed)
        assert window.score.away == sum(e.type == 'goal' and e.side == 'away' for e in elapsed)
        assert window.metrics.home.shots == sum(e.type == 'shot' and e.side == 'home' for e in elapsed)
        assert window.metrics.home.possession_ms+window.metrics.away.possession_ms == window.end_ms
        facts = MatchTools('owned', record, window).read_window()
        assert len(facts['events']) <= 4
        assert all(e['t1_ms'] <= window.end_ms for e in facts['events'])
        assert 'motion' not in facts and 'frame_after' not in str(facts)
        assert 'distance' not in facts['metrics']['home']
        projection=facts['statistics']
        assert len(projection['facts'])<=4
        assert 'plots' not in projection and 'motion' not in projection
        assert all(len(fact['event_ids'])<=4 and len(fact['sample_ranges'])<=4 for fact in projection['facts'])


def test_queue_is_bounded_and_timeout_is_an_unavailable_fallback(tmp_path, record):
    class SlowRunner(ScriptedRunner):
        async def analyze(self, window, tools, reserve):
            await released.wait()
            raise LocalModelTimeout('offline timeout')
    async def run():
        nonlocal released
        released = asyncio.Event()
        repo, match_id = store(tmp_path, record); service = ExplanationService(repo, lambda: SlowRunner(), 'test-model')
        requests = [ExplanationRequest(window_id=w, revision=record.trace_hash, locale=locale, mode='fan')
                    for locale in ('en', 'es') for w in ('moment', 'halftime', 'fulltime')]
        try:
            jobs = [service.submit(match_id, 'owner', request) for request in requests[:5]]
            with pytest.raises(ExplanationQueueFull): service.submit(match_id, 'owner', requests[-1])
            released.set()
            for job in jobs:
                result = await ready(service, job)
                assert result.state == 'unavailable' and result.error == 'LocalModelTimeout'
                assert result.window.id == job.window.id and result.locale == job.locale
        finally: await service.close()
    released = None
    asyncio.run(run())


def test_an_extra_roundtrip_cannot_exceed_persisted_budget(tmp_path, record):
    async def run():
        repo, match_id = store(tmp_path, record); service = ExplanationService(repo, lambda: ScriptedRunner(), 'test-model')
        try:
            request = ExplanationRequest(window_id='fulltime', revision=record.trace_hash, locale='en', mode='fan')
            job = await ready(service, service.submit(match_id, 'owner', request))
            assert job.calls_reserved == 4
            # Even an in-flight provider callback cannot spend after completion.
            with pytest.raises(ExplanationBudgetExceeded): service._reserve(job, 'owner', 1)
            job.state = 'pending'
            with pytest.raises(ExplanationBudgetExceeded): service._reserve(job, 'owner', 1)
            assert service.get(match_id, job.id, 'owner').calls_reserved == 4
        finally: await service.close()
    asyncio.run(run())


def test_closed_observation_selection_constructs_metric_fields_on_server(record):
    import json
    window=build_windows(record)[-1]
    tools=MatchTools('owned',record,window)
    facts=tools.read_window()
    assert len(json.dumps(facts).encode())<16*1024
    assert 'plots' not in facts and 'motion' not in facts
    for item in facts['observations']:
        selected=tools.select_observation(item['id'])
        assert selected.revision==record.trace_hash and selected.score==window.score
        if item['id'].startswith('metric:'):
            assert selected.metric_id is not None
            assert selected.sample_ranges or selected.event_ids
    with pytest.raises(ValueError):tools.select_observation('invented-observation')


def test_old_prompt_text_and_shared_budget_survive_prompt_upgrade(tmp_path,record):
    async def run():
        import json
        repo,match_id=store(tmp_path,record)
        runner=ScriptedRunner()
        service=ExplanationService(repo,lambda:runner,'test-model')
        windows=build_windows(record)
        old_ids=[]
        with repo.connection() as db:
            for i,window in enumerate(windows):
                old=ExplanationJob(id=f'old-{i}',match_id=match_id,window=window,locale='en',mode='fan',state='ready',
                    provenance='local_ai',model='test-model',calls_reserved=4,text='Original saved explanation')
                body=old.model_dump(mode='json');body.pop('prompt_version');body['window'].pop('statistics')
                db.execute('INSERT INTO explanations VALUES(?,?,?,?,?,?,?,?)',
                    (old.id,f'old-cache-{i}',match_id,'owner',record.trace_hash,'en','fan',json.dumps(body)))
                old_ids.append(old.id)
        try:
            for id in old_ids:
                job=service.get(match_id,id,'owner')
                assert job.prompt_version=='grounded-1' and job.text=='Original saved explanation'
                assert job.window.statistics is None
            request=ExplanationRequest(window_id='fulltime',revision=record.trace_hash,locale='en',mode='fan')
            current=await ready(service,service.submit(match_id,'owner',request))
            assert current.prompt_version=='grounded-2'
            assert current.state=='rejected' and current.calls_reserved==0 and runner.calls==0
            with repo.connection() as db:
                total=sum(json.loads(r[0])['calls_reserved'] for r in db.execute('SELECT body FROM explanations'))
            assert total==12
            assert service.get(match_id,old_ids[-1],'owner').text=='Original saved explanation'
        finally:await service.close()
    asyncio.run(run())


def test_real_acceptance_requires_pinned_already_loaded_model():
    from types import SimpleNamespace
    from timepitch.agents.acceptance import require_prepared
    pinned='qwen2.5-1.5b-instruct-generic-gpu:4'
    class ReadOnlyManager:
        def __init__(self,id,loaded):self.id,self.loaded=id,loaded
        def get_model_info(self,*args,**kwargs):return SimpleNamespace(id=self.id)
        def list_loaded_models(self):return [SimpleNamespace(id=id) for id in self.loaded]
    with pytest.raises(RuntimeError,match='explicitly'):
        require_prepared(ReadOnlyManager(pinned,[]))
    with pytest.raises(RuntimeError,match='revision'):
        require_prepared(ReadOnlyManager('other-model',['other-model']))
    require_prepared(ReadOnlyManager(pinned,[pinned]))


def test_prompt_upgrade_cannot_spend_eight_calls_in_one_window(tmp_path,record):
    async def run():
        repo,match_id=store(tmp_path,record)
        runner=ScriptedRunner();service=ExplanationService(repo,lambda:runner,'test-model')
        window=build_windows(record)[-1]
        old=ExplanationJob(id='old-fulltime',match_id=match_id,window=window,locale='en',mode='fan',
            state='ready',provenance='local_ai',model='test-model',calls_reserved=4,text='Saved original')
        with repo.connection() as db:
            db.execute('INSERT INTO explanations VALUES(?,?,?,?,?,?,?,?)',
                (old.id,'old-prompt-cache',match_id,'owner',record.trace_hash,'en','fan',old.model_dump_json()))
        try:
            request=ExplanationRequest(window_id='fulltime',revision=record.trace_hash,locale='en',mode='fan')
            current=await ready(service,service.submit(match_id,'owner',request))
            assert current.state=='rejected' and current.calls_reserved==0 and runner.calls==0
            other=await ready(service,service.submit(match_id,'owner',request.model_copy(update={'window_id':'halftime'})))
            assert other.state=='ready' and other.calls_reserved==4
            assert service.get(match_id,old.id,'owner').text=='Saved original'
        finally:await service.close()
    asyncio.run(run())
