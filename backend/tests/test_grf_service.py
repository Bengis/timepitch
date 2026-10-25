import threading,time
import pytest
from grf_fixtures import request_fixture,replay_fixture,full_replay,DATASET
from timepitch.catalog.repository import CatalogRepository
from timepitch.grf.models import EngineCapability
from timepitch.grf.repository import GrfRepository
from timepitch.grf.process import GrfTimeout,GrfCancelled
from timepitch.grf.service import GrfService
from timepitch.matches.service import QueueFullError


class ControlledRunner:
    def __init__(self,block=False,fail=False):self.block=block;self.fail=fail;self.entered=threading.Event();self.release=threading.Event()
    def capability(self):return EngineCapability(id='grf',available=True)
    def run(self,request,cancelled):
        self.entered.set()
        while self.block and not self.release.wait(.01):
            if cancelled.is_set():raise GrfCancelled()
        if self.fail:self.fail=False;raise GrfTimeout()
        from grf_statistics_fixtures import statistics_replay
        return statistics_replay(request=request)
    def close(self):self.release.set()


def terminal(service,job):
    deadline=time.monotonic()+5
    while time.monotonic()<deadline:
        got=service.repository.get_job(job.id,'owner')
        if got.state in ('failed','ready'):return got
        time.sleep(.01)
    pytest.fail('GRF test job did not complete')


def test_five_slots_timeout_release_and_next_job_success(tmp_path):
    runner=ControlledRunner(block=True,fail=True)
    service=GrfService(CatalogRepository(DATASET),GrfRepository(tmp_path/'grf.sqlite'),runner)
    config=request_fixture().config
    try:
        jobs=[service.create_match(config,'owner') for _ in range(5)]
        assert runner.entered.wait(2)
        with pytest.raises(QueueFullError):service.create_match(config,'owner')
        runner.release.set()
        assert terminal(service,jobs[0]).error=='native_timeout'
        assert all(terminal(service,j).state=='ready' for j in jobs[1:])
        assert terminal(service,service.create_match(config,'owner')).state=='ready'
    finally:service.close()


def test_shutdown_resolves_active_and_queued_jobs_and_rejects_new_jobs(tmp_path):
    runner=ControlledRunner(block=True)
    service=GrfService(CatalogRepository(DATASET),GrfRepository(tmp_path/'grf.sqlite'),runner)
    config=request_fixture().config
    jobs=[service.create_match(config,'owner') for _ in range(5)]
    assert runner.entered.wait(2)
    service.close()
    assert all(service.repository.get_job(j.id,'owner').state=='failed' for j in jobs)
    with pytest.raises(GrfCancelled):service.create_match(config,'owner')
