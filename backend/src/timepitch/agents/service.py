import asyncio
from hashlib import sha256
import json
import secrets
from time import perf_counter
from .models import ExplanationJob, GroundedAnalysis, GroundedExplanation, PROMPT_VERSION
from .tools import build_windows, MatchTools
from .validation import validate_analysis, validate_explanation
from .narration import render_narration, fallback_text
from .provider import ModelOutputError
from ..chronicles.usage import reserved_chronicles


class ExplanationQueueFull(ValueError): pass
class ExplanationBudgetExceeded(ValueError): pass


class ExplanationService:
    def __init__(self, repository, runner_factory, model):
        self.repo, self.runner_factory, self.model = repository, runner_factory, model
        self.runner = None
        self.tasks = set()
        self.gate = asyncio.Lock()
        with self.repo.connection() as conn:
            conn.execute('''CREATE TABLE IF NOT EXISTS explanations (
                id TEXT PRIMARY KEY,cache_key TEXT UNIQUE,match_id TEXT NOT NULL,owner TEXT NOT NULL,
                revision TEXT NOT NULL,locale TEXT NOT NULL,mode TEXT NOT NULL,body TEXT NOT NULL)''')
            conn.execute('DELETE FROM explanations WHERE match_id NOT IN (SELECT id FROM matches)')
            for row in conn.execute('SELECT id,body FROM explanations').fetchall():
                job = ExplanationJob.model_validate_json(row['body'])
                if job.state == 'pending':
                    job.state, job.error = 'unavailable', 'interrupted'
                    job.text = fallback_text(job.locale)
                    conn.execute('UPDATE explanations SET body=? WHERE id=?', (job.model_dump_json(), job.id))

    def get(self, match_id, job_id, owner):
        with self.repo.connection() as conn:
            row = conn.execute('''SELECT e.body FROM explanations e JOIN matches m ON e.match_id=m.id AND e.owner=m.owner
                WHERE e.id=? AND e.match_id=? AND e.owner=?''', (job_id, match_id, owner)).fetchone()
        if row is None: raise KeyError(job_id)
        return ExplanationJob.model_validate_json(row['body'])

    def submit(self, match_id, owner, request):
        record = self.repo.get_record(match_id, owner)
        if request.revision != record.trace_hash: raise ValueError('Stale match revision')
        window = next(w for w in build_windows(record) if w.id == request.window_id)
        cache_key = sha256(json.dumps([owner, match_id, window.id, window.revision, request.locale,
            request.mode, self.model, PROMPT_VERSION]).encode()).hexdigest()
        with self.repo.connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            row = conn.execute('SELECT body FROM explanations WHERE cache_key=?', (cache_key,)).fetchone()
            if row:
                job = ExplanationJob.model_validate_json(row['body'])
                if not request.retry or job.state not in ('unavailable', 'rejected') or job.attempts >= 2 or job.calls_reserved != 0:
                    return job
                job.state, job.error, job.attempts, job.text = 'pending', None, 2, ''
            else:
                job = ExplanationJob(id=secrets.token_urlsafe(18), match_id=match_id, window=window,
                    locale=request.locale,mode=request.mode,state='pending',provenance='deterministic_fallback',model=self.model,prompt_version=PROMPT_VERSION)
            if len(self.tasks) >= 5: raise ExplanationQueueFull('Local explanation queue is full')
            conn.execute('''INSERT INTO explanations VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(cache_key) DO UPDATE SET body=excluded.body''',
                (job.id, cache_key, match_id, owner, request.revision, request.locale, request.mode, job.model_dump_json()))
        task = asyncio.create_task(self._run(job, record, owner))
        self.tasks.add(task)
        def done(task):
            self.tasks.discard(task)
            if not task.cancelled(): task.exception()
        task.add_done_callback(done)
        return job

    def _save(self, job, owner):
        with self.repo.connection() as conn:
            conn.execute('UPDATE explanations SET body=? WHERE id=? AND owner=?', (job.model_dump_json(), job.id, owner))

    def _reserve(self, job, owner, count):
        if type(count) is not int or count < 1: raise ExplanationBudgetExceeded()
        if job.state != 'pending': raise ExplanationBudgetExceeded('Explanation is no longer active')
        with self.repo.connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            rows = conn.execute('''SELECT body FROM explanations WHERE match_id=? AND owner=? AND revision=? AND locale=?''',
                (job.match_id, owner, job.window.revision, job.locale)).fetchall()
            saved = [ExplanationJob.model_validate_json(row['body']) for row in rows]
            current=next((item for item in saved if item.id==job.id),None)
            if current is None or current.state!='pending': raise ExplanationBudgetExceeded('Explanation is no longer active')
            distributed=reserved_chronicles(conn,owner,job.match_id,job.window.revision,job.locale)
            total = distributed+sum(item.calls_reserved for item in saved)
            window_total = (distributed if job.window.id=='fulltime' else 0)+sum(item.calls_reserved for item in saved if item.window.id == job.window.id)
            if total + count > 12 or window_total + count > 4 or job.calls_reserved + count > 4:
                raise ExplanationBudgetExceeded('Model roundtrip budget exhausted')
            job.calls_reserved = current.calls_reserved+count
            conn.execute('UPDATE explanations SET body=? WHERE id=? AND owner=?', (job.model_dump_json(), job.id, owner))

    async def _run(self, job, record, owner):
        started = perf_counter()
        try:
            async with self.gate:
                if self.runner is None: self.runner = await asyncio.to_thread(self.runner_factory)
                reserve = lambda count: self._reserve(job, owner, count)
                tools = MatchTools(job.match_id, record, job.window)
                analysis = GroundedAnalysis.model_validate(await self.runner.analyze(job.window, tools, reserve))
                if tools.calls != 1: raise ModelOutputError('Analysis did not read authorized evidence')
                if not validate_analysis(analysis, record, job.window).accepted: raise ModelOutputError('Analysis failed grounding')
                explanation = GroundedExplanation.model_validate(await self.runner.narrate(analysis, job.locale, job.mode, reserve))
                if explanation.locale != job.locale or explanation.mode != job.mode or not validate_explanation(explanation, analysis, record, job.window).accepted:
                    raise ModelOutputError('Narration failed grounding')
                job.explanation,job.text,job.state,job.provenance=explanation,render_narration(explanation,job.window.statistics),'ready','local_ai'
        except asyncio.CancelledError:
            job.state, job.error, job.text = 'unavailable', 'interrupted', fallback_text(job.locale)
            raise
        except (ModelOutputError, ValueError) as error:
            job.state, job.error, job.text = 'rejected', type(error).__name__, fallback_text(job.locale)
        except Exception as error:
            job.state, job.error, job.text = 'unavailable', type(error).__name__, fallback_text(job.locale)
        finally:
            job.latency_ms = round((perf_counter() - started) * 1000, 1)
            self._save(job, owner)

    async def close(self):
        tasks = list(self.tasks)
        for task in tasks: task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        if self.runner is not None and hasattr(self.runner, 'close'):
            await self.runner.close()
