from concurrent.futures import ThreadPoolExecutor
import threading
from .repository import MatchRepository
from ..simulation.engine import simulate_match, validate_trace, _prepare
from ..simulation.models import ENGINE_VERSION, RULES_VERSION, RATINGS_VERSION
from ..simulation.replay_models import MatchRecordV2


class QueueFullError(RuntimeError): pass


class MatchService:
    def __init__(self, catalog, repository: MatchRepository):
        self.catalog, self.repository = catalog, repository
        self._slots = threading.BoundedSemaphore(5)
        self._worker = ThreadPoolExecutor(max_workers=1, thread_name_prefix='timepitch-match')

    def create_match(self, config, owner_session):
        _prepare(config, self.catalog)
        if not self._slots.acquire(blocking=False):
            raise QueueFullError('One match is active and four are queued')
        try:
            job = self.repository.create(config, owner_session)
            self._worker.submit(self._run, job, owner_session)
            return job
        except Exception:
            self._slots.release()
            raise

    def _run(self, job, owner):
        try:
            if not self.repository.start(job.id, owner): return
            record = simulate_match(job.config, self.catalog)
            if validate_trace(record, self.catalog): raise ValueError('Invalid generated trace')
            self.repository.finish(job.id, owner, record)
        except Exception:
            self.repository.fail(job.id, owner, 'simulation_failed')
        finally:
            self._slots.release()

    def import_match(self, record, owner):
        engine, rules = ('engine-2', 'rules-2') if isinstance(record, MatchRecordV2) else (ENGINE_VERSION, RULES_VERSION)
        if (record.dataset_version != self.catalog.dataset_version or record.engine_version != engine
                or record.rules_version != rules or record.ratings_version != RATINGS_VERSION):
            raise ValueError('Incompatible replay version')
        state, teams = _prepare(record.config, self.catalog)
        if record.home_name != teams['home'].name or record.away_name != teams['away'].name:
            raise ValueError('Replay team names differ from historical catalogue')
        expected = {p.key: (p.name, p.role, p.side) for p in state.snapshot().players}
        actual = {p.key: (p.name, p.role, p.side) for p in record.initial_frame.players}
        if actual != expected: raise ValueError('Replay player identities differ from historical catalogue')
        if validate_trace(record, self.catalog): raise ValueError('Replay integrity or consistency failed')
        job = self.repository.create(record.config, owner)
        self.repository.start(job.id, owner)
        self.repository.finish(job.id, owner, record)
        return self.repository.get_job(job.id, owner)

    def get_match(self, match_id, owner_session):
        return self.repository.get_record(match_id, owner_session)

    def close(self):
        self._worker.shutdown(wait=True, cancel_futures=True)
