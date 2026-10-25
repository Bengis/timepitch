from fastapi.testclient import TestClient
from timepitch.app import create_app
from grf_fixtures import DATASET
import threading
import time
from pathlib import Path
from timepitch.grf.physical_process import PhysicalResult
from timepitch.grf.models import EngineCapability
from grf_physical_fixtures import write_match


def test_physical_job_manifest_blocks_export_and_legacy_history_are_owner_scoped(tmp_path,monkeypatch):
    import shutil
    directory=tmp_path/'fixture';manifest=write_match(directory)
    class ControlledPhysical:
        def capability(self):return EngineCapability(id='grf',available=True)
        def close(self):pass
        def run(self,request,cancelled):
            assert request==manifest.input and not cancelled.is_set()
            result=PhysicalResult();result.manifest=manifest;result.count=len(manifest.chunks)
            for ref in manifest.chunks:shutil.copyfile(directory/f'{ref.index}.zlib',result.path/f'{ref.index}.zlib')
            return result
    monkeypatch.delenv('TIMEPITCH_LOCAL_MODEL',raising=False)
    monkeypatch.setenv('TIMEPITCH_GRF_MODE','physical')
    monkeypatch.setattr('timepitch.app.PhysicalProcess',lambda *args:ControlledPhysical())
    app=create_app(DATASET,tmp_path/'runtime');base='http://127.0.0.1:8078'
    with TestClient(app,base_url=base,headers={'Origin':base}) as client:
        assert client.get('/api/engines').json()[1]['clock_policy']=='physical-periods-1'
        response=client.post('/api/grf/matches',json=manifest.input.config.model_dump(mode='json'))
        assert response.status_code==202
        id=response.json()['id'];assert id.startswith('physical-')
        deadline=time.monotonic()+30
        while time.monotonic()<deadline:
            job=client.get(f'/api/grf/matches/{id}').json()
            if job['state'] in ('ready','failed'):break
            time.sleep(.02)
        assert job['state']=='ready',job
        assert client.get(f'/api/grf/matches/{id}/replay').json()['trace_hash']==manifest.trace_hash
        block=client.get(f'/api/grf/matches/{id}/replay/chunks/0')
        assert block.status_code==200 and len(block.json()['samples'])==1000
        export=client.get(f'/api/grf/matches/{id}/export')
        assert export.status_code==200 and export.headers['content-disposition'].endswith('.jsonl"')
        assert export.content.count(b'\n')==len(manifest.chunks)+1
        assert client.get('/api/grf/matches').json()[0]['id']==id
        assert client.post('/api/replays/import',content=export.content,headers={'Content-Type':'application/json'}).status_code in (413,422)
        stats=client.get(f'/api/grf/matches/{id}/statistics')
        assert stats.status_code==200
        summary=stats.json()
        assert summary['schema_version']=='grf-physical-statistics-1'
        assert summary['trace_hash']==manifest.trace_hash and len(summary['players'])==22
        assert summary['players'][0]['distance_kind']=='observed_complete'
        stranger=TestClient(app,base_url=base)
        try:
            for tail in ('','/replay','/replay/chunks/0','/export','/statistics'):
                assert stranger.get(f'/api/grf/matches/{id}{tail}').status_code==404
            assert stranger.get('/api/grf/matches').json()==[]
        finally:stranger.close()


def test_block_and_export_routes_are_owned_and_missing_is_404(tmp_path,monkeypatch):
    monkeypatch.delenv('TIMEPITCH_LOCAL_MODEL',raising=False)
    with TestClient(create_app(DATASET,tmp_path),base_url='http://127.0.0.1:8078') as client:
        assert client.get('/api/grf/matches/nonexistent/replay/chunks/0').status_code==404
        assert client.get('/api/grf/matches/nonexistent/export').status_code==404


def test_activity_response_preserves_activity_and_discriminates_effort(tmp_path,monkeypatch):
    """API serialization only; synthetic admitted records are not native acceptance."""
    from test_grf_physical_statistics import trace
    from grf_physical_fixtures import row
    from timepitch.grf.physical_models import ActivityInput,ActivitySettings,ActivityManifest,ActivityChunk,ACTIVITY_NATIVE_SHA256
    from timepitch.grf.physical_codec import make_chunk_ref,manifest_hash
    from timepitch.grf.codec import grf_input_hash
    manifest,chunks=trace([row(),row(1,100,elapsed=100)])
    request=ActivityInput.model_validate({**manifest.input.model_dump(),'settings':ActivitySettings().model_dump()})
    request.input_hash=grf_input_hash(request)
    block=ActivityChunk(index=0,samples=chunks[0].samples,activity=[[0]*22,[2]*22])
    record=ActivityManifest(**manifest.model_dump(exclude={'schema_version','engine_version','input','native_binary_sha256','chunks','trace_hash'}),
        input=request,native_binary_sha256=ACTIVITY_NATIVE_SHA256,chunks=[make_chunk_ref(block)])
    record.trace_hash=manifest_hash(record)
    monkeypatch.delenv('TIMEPITCH_LOCAL_MODEL',raising=False)
    app=create_app(DATASET,tmp_path)
    with TestClient(app,base_url='http://127.0.0.1:8078') as client:
        client.get('/api/engines');owner=client.cookies.get('timepitch_session').split('.')[0]
        def owned(id,who):
            if id!='physical-synthetic' or who!=owner:raise KeyError(id)
            return record
        monkeypatch.setattr(app.state.grf,'get_match',owned)
        monkeypatch.setattr(app.state.grf.physical_repository,'get_chunk',lambda id,who,index: block if owned(id,who) and index==0 else None)
        monkeypatch.setattr(app.state.grf.physical_repository,'iter_physical_chunks',lambda id,who: iter([block]) if owned(id,who) else iter([]))
        base='/api/grf/matches/physical-synthetic'
        assert client.get(base+'/replay').json()['schema_version']=='grf-activity-1'
        assert client.get(base+'/replay/chunks/0').json()['activity']==block.activity
        summary=client.get(base+'/statistics')
        assert summary.status_code==200 and summary.json()['experimental'] is True
        assert summary.json()['statistics_version']=='grf-physical-statistics-1'
        stranger=TestClient(app,base_url='http://127.0.0.1:8078')
        try:
            for suffix in ('/replay','/replay/chunks/0','/statistics'):assert stranger.get(base+suffix).status_code==404
        finally:stranger.close()
