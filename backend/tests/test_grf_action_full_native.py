"""Exactly four reserved phase-1 cases; captured replay over HTTP starts no new GRF."""
import json
import hashlib
import os
from pathlib import Path
import time
import pytest
from fastapi.testclient import TestClient
from timepitch.app import create_app
from timepitch.grf.action_validation import run_technical_case,RetainedResult,PROJECT_ROOT,STUDY
from timepitch.grf.models import EngineCapability
from timepitch.grf.process import GrfCancelled
from timepitch.grf.physical_codec import make_chunk_ref
from timepitch.grf.physical_wire import canonical,digest

pytestmark=pytest.mark.skipif(os.getenv('TIMEPITCH_TEST_GRF_CAMPAIGN')!='1',reason='Explicit cumulative full-match campaign required')
ROOT=PROJECT_ROOT/'.local/grf-physical-work/continuation'


def _api_acceptance(monkeypatch,*,cancel=False):
    saved=RetainedResult(ROOT/'evidence/T-actions/match')
    class StoredCapture:
        def capability(self):return EngineCapability(id='grf',available=True)
        def close(self):pass
        def run(self,request,cancelled):
            assert request==saved.manifest.input
            if cancel:raise GrfCancelled()
            return saved
    monkeypatch.delenv('TIMEPITCH_LOCAL_MODEL',raising=False)
    monkeypatch.setenv('TIMEPITCH_GRF_MODE','physical');monkeypatch.setenv('TIMEPITCH_GRF_PHYSICAL_TELEMETRY','actions-1')
    monkeypatch.setattr('timepitch.app.ActionProcess',lambda *args:StoredCapture())
    campaign=json.loads((PROJECT_ROOT/STUDY/'campaign.json').read_bytes())
    runtime=ROOT/('api-cancel' if cancel else 'api-full');base='http://127.0.0.1:8094'
    app=create_app(PROJECT_ROOT/campaign['dataset'],runtime)
    with TestClient(app,base_url=base,headers={'Origin':base}) as client:
        response=client.post('/api/grf/matches',json=saved.manifest.input.config.model_dump(mode='json'))
        assert response.status_code==202,response.text
        id=response.json()['id'];url=f'/api/grf/matches/{id}';deadline=time.monotonic()+180
        while time.monotonic()<deadline:
            job=client.get(url).json()
            if job['state'] in ('ready','failed'):break
            time.sleep(.05)
        assert job['state']==('failed' if cancel else 'ready'),job
        if cancel:
            for suffix in ('/replay','/replay/chunks/0','/statistics','/export'):assert client.get(url+suffix).status_code==404
            return dict(partial_publication='rejected')
        assert client.get(url+'/replay').json()==saved.manifest.model_dump(mode='json')
        summary=client.get(url+'/statistics');assert summary.status_code==200,summary.text
        expected=json.loads((saved.path/'summary.json').read_bytes())
        assert summary.json()==expected
        exported=0
        with client.stream('GET',url+'/export') as response:
            assert response.status_code==200
            for line in response.iter_lines():
                value=json.loads(line)
                if exported==0:assert value['manifest']==saved.manifest.model_dump(mode='json')
                else:
                    from timepitch.grf.action_models import ActionChunk
                    assert make_chunk_ref(ActionChunk.model_validate(value['chunk']))==saved.manifest.chunks[exported-1]
                exported+=1
        assert exported==len(saved.manifest.chunks)+1
        stranger=TestClient(app,base_url=base)
        try:
            for suffix in ('','/replay','/replay/chunks/0','/statistics','/export'):assert stranger.get(url+suffix).status_code==404
            assert stranger.get('/api/grf/matches').json()==[]
        finally:stranger.close()
        return dict(summary_sha256=digest(expected),exported_blocks=exported-1,owner_isolation=True,publication='atomic_ready')


def _report(case_id,acceptance,checks):
    folder=PROJECT_ROOT/STUDY;path=folder/'technical-report.json'
    report=json.loads(path.read_bytes()) if path.exists() else dict(schema_version='grf-action-full-acceptance-1',cases={})
    state=json.loads((ROOT/'checkpoint.json').read_bytes());entry=state['runs'].get(case_id,{})
    report['cases'][case_id]=dict(acceptance=acceptance,capture_state=entry.get('state','not_started'),
        evidence=entry.get('evidence',{}),checks=checks)
    parent=PROJECT_ROOT/state['campaign']['parent_checkpoint']
    parent_unchanged=parent.is_file() and hashlib.sha256(parent.read_bytes()).hexdigest()==state['campaign']['parent_sha256']
    report.update(accepted=len(report['cases'])==4 and all(c['acceptance']=='passed' for c in report['cases'].values()),
        prior_attempts=24,new_attempts=len(state['runs']),cumulative_attempts=24+len(state['runs']),maximum_attempts=70,
        calibration_candidates_used=3,calibration_started=False,heldout_started=False,demo_activated=False,
        parent_unchanged=parent_unchanged,scope='Phase1 complete native capture/resources/API only; no football plausibility acceptance')
    path.write_bytes(canonical(report)+b'\n')


@pytest.mark.parametrize('case_id',['T-control','T-actions','T-repeat','T-cancel'])
def test_reserved_full_native_case(case_id,monkeypatch):
    checks={}
    try:
        evidence=run_technical_case(case_id,ROOT)
        assert evidence['peak_private_bytes']>0 and evidence['peak_private_bytes']<=512*1024*1024
        if case_id=='T-cancel':
            assert evidence['cancellation_seconds']<=5 and evidence['publication']=='not_ready'
            checks=_api_acceptance(monkeypatch,cancel=True)
        else:
            saved=RetainedResult(ROOT/evidence['result_path']);m=saved.manifest
            assert len(m.periods)==2 and sum(p.duration_ms for p in m.periods)==m.duration_ms
            assert evidence['samples']<=75001 and evidence['readback_count']==66
            assert evidence['compressed_bytes']<=32*1024*1024 and evidence['expanded_bytes']<=256*1024*1024
            if case_id!='T-control':
                assert m.raw_event_count+m.semantic_event_count<=100000
                assert evidence['passive_equivalence']['samples']==evidence['samples']
            if case_id=='T-actions':checks=_api_acceptance(monkeypatch)
            if case_id=='T-repeat':assert evidence['reproduced_exactly'] is True
        _report(case_id,'passed',checks)
    except BaseException:
        _report(case_id,'failed',checks);raise
