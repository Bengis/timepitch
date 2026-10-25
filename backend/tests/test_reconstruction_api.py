import importlib
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from historical_analysis_support import event
from historical_support import PILOT, records, write_source
from test_historical_import import build,repo


def built(tmp_path):
    _,events=records()
    events=events[:2]+[event(10,'Half Start'),event(11,'Half End',ms=61_000),
                       event(12,'Half Start',period=2),event(13,'Half End',period=2,ms=2_000),
                       event(30,'Pass',ms=59_950,player=101,location=[60,40],duration=.2,
                             **{'pass':{'end_location':[61,40]}})]
    build(write_source(tmp_path/'source',events=events),tmp_path/'data')
    dataset=repo(tmp_path/'data')
    module=importlib.import_module('timepitch.reconstruction.build')
    profile=importlib.import_module('timepitch.reconstruction.models').MotionProfile()
    root=tmp_path/'motion'
    result=module.build_reconstruction(dataset,PILOT,root/str(PILOT),profile)
    module.seal_catalog(dataset,root)
    repository=importlib.import_module('timepitch.reconstruction.repository').ReconstructionRepository(root)
    return dataset,repository,result


def test_segments_are_repeatable_order_independent_and_do_not_duplicate_boundary_anchors(tmp_path):
    dataset,r,manifest=built(tmp_path)
    b=r.get_segment(PILOT,1,1);a=r.get_segment(PILOT,1,0)
    assert a==r.get_segment(PILOT,1,0) and b==r.get_segment(PILOT,1,1)
    assert a.frames[-1].period_ms<60_000 and b.frames[0].period_ms==60_000
    assert len({v.id for v in a.anchors+b.anchors})==len(a.anchors+b.anchors)
    second=tmp_path/'repeat'
    module=importlib.import_module('timepitch.reconstruction.build')
    profile=importlib.import_module('timepitch.reconstruction.models').MotionProfile()
    again=module.build_reconstruction(dataset,PILOT,second,profile)
    assert manifest==again
    assert (second/'1-0.json').read_bytes()==(r.root/str(PILOT)/'1-0.json').read_bytes()


def test_missing_and_corrupt_motion_never_prevent_reading_historical_facts(tmp_path):
    dataset,r,manifest=built(tmp_path)
    from timepitch.api.historical import historical_router
    app=FastAPI();app.include_router(historical_router(dataset,enabled=True,reconstruction=r))
    with TestClient(app) as client:
        assert client.get(f'/api/historical/matches/{PILOT}/reconstruction').status_code==200
        assert client.get(f'/api/historical/matches/{PILOT}/reconstruction/segments/1/99').status_code==404
        assert client.get(f'/api/historical/matches/{PILOT}/reconstruction/segments/0/0').status_code==422
        assert client.get(f'/api/historical/matches/{PILOT}/reconstruction/segments/1/-1').status_code==422
        path=r.root/str(PILOT)/'1-0.json';path.write_bytes(b'corrupt')
        assert client.get(f'/api/historical/matches/{PILOT}/reconstruction/segments/1/0').status_code==503
        assert client.get(f'/api/historical/matches/{PILOT}').status_code==200
    plain=FastAPI();plain.include_router(historical_router(dataset,enabled=True))
    with TestClient(plain) as client:
        assert client.get(f'/api/historical/matches/{PILOT}/reconstruction').status_code==503
        assert client.get(f'/api/historical/matches/{PILOT}/statistics?period=1&at_ms=0').status_code==200


def test_get_only_reads_prebuilt_motion_without_model_download_or_native_work(tmp_path,monkeypatch):
    dataset,r,_=built(tmp_path)
    import socket,subprocess,urllib.request
    def denied(*a,**k):pytest.fail('GET must only read prebuilt artifacts')
    from timepitch.api.historical import historical_router
    app=FastAPI();app.include_router(historical_router(dataset,enabled=True,reconstruction=r))
    with TestClient(app) as client:
        monkeypatch.setattr(subprocess,'Popen',denied)
        monkeypatch.setattr(socket,'create_connection',denied)
        monkeypatch.setattr(urllib.request,'urlopen',denied)
        response=client.get(f'/api/historical/matches/{PILOT}/reconstruction/segments/1/0')
        assert response.status_code==200
        assert response.json()['provenance']=='synthetic_motion'
        assert client.get(f'/api/historical/matches/{PILOT}/reconstruction/segments/1/%2e%2e').status_code in (404,422)


def test_changed_dataset_cannot_reuse_a_catalog_from_another_snapshot(tmp_path):
    _,r,_=built(tmp_path)
    (r.root/'index.json').write_text('{}',encoding='utf-8')
    with pytest.raises(ValueError):r.get_manifest(PILOT)


def test_equivalent_profile_json_has_same_identity_and_historical_facts_are_unchanged(tmp_path):
    dataset,r,manifest=built(tmp_path)
    before=dataset.statistics(PILOT,1,61_000)
    from timepitch.reconstruction.build import build_reconstruction
    from timepitch.reconstruction.models import MotionProfile
    profile=MotionProfile(player_max_speed=9.0,player_max_acceleration=4.0,ball_max_speed=45.0)
    again=build_reconstruction(dataset,PILOT,tmp_path/'equivalent',profile)
    assert again.reconstruction_id==manifest.reconstruction_id
    assert before==dataset.statistics(PILOT,1,61_000)


def test_actual_app_loads_motion_independently_and_never_enables_it_in_public(tmp_path,monkeypatch):
    dataset,r,_=built(tmp_path)
    from timepitch.app import create_app
    monkeypatch.setenv('TIMEPITCH_HISTORICAL_DATASET',str(dataset.root))
    monkeypatch.setenv('TIMEPITCH_RECONSTRUCTION_DATASET',str(r.root))
    monkeypatch.setenv('TIMEPITCH_RECONSTRUCTION_ENABLED','1')
    monkeypatch.setenv('TIMEPITCH_PUBLIC_ORIGIN','')
    monkeypatch.setenv('TIMEPITCH_LOCAL_MODEL','')
    with TestClient(create_app(runtime_dir=tmp_path/'runtime'),base_url='http://127.0.0.1') as client:
        assert client.get(f'/api/historical/matches/{PILOT}/reconstruction').status_code==200
    monkeypatch.setenv('TIMEPITCH_PUBLIC_ORIGIN','https://timepitch.diloclaro.app')
    with TestClient(create_app(runtime_dir=tmp_path/'public-runtime'),base_url='https://timepitch.diloclaro.app') as client:
        assert client.get(f'/api/historical/matches/{PILOT}/reconstruction').status_code==503


def test_approved_public_deployment_reads_prebuilt_motion_only(tmp_path, monkeypatch):
    dataset, motion, _ = built(tmp_path)
    from timepitch.app import create_app
    monkeypatch.setenv('TIMEPITCH_HISTORICAL_DATASET', str(dataset.root))
    monkeypatch.setenv('TIMEPITCH_RECONSTRUCTION_DATASET', str(motion.root))
    monkeypatch.setenv('TIMEPITCH_RECONSTRUCTION_ENABLED', '1')
    monkeypatch.setenv('TIMEPITCH_HISTORICAL_PUBLICATION_APPROVED', '1')
    monkeypatch.setenv('TIMEPITCH_PUBLIC_ORIGIN', 'https://timepitch.diloclaro.app')
    monkeypatch.setenv('TIMEPITCH_LOCAL_MODEL', '')
    import subprocess
    monkeypatch.setattr(subprocess, 'Popen', lambda *a, **k: pytest.fail('Public GET must not generate data'))
    with TestClient(create_app(runtime_dir=tmp_path/'runtime'), base_url='https://timepitch.diloclaro.app') as app:
        response = app.get(f'/api/historical/matches/{PILOT}/reconstruction/segments/1/0')
        assert response.status_code == 200
        assert response.json()['provenance'] == 'synthetic_motion'


def test_catalogue_builder_seals_only_completed_candidates_and_measures_resources(tmp_path):
    dataset,_,_=built(tmp_path)
    from timepitch.reconstruction.build import build_catalog
    report=build_catalog(dataset,tmp_path/'catalogue',[PILOT],workers=1)
    assert report['counts']=={'partial':1}
    assert report['peak_worker_rss_bytes']>0 and report['wall_s']>0
    assert report['gates_passed'] is True
    assert (tmp_path/'catalogue/index.json').is_file()
    with pytest.raises(FileExistsError):build_catalog(dataset,tmp_path/'catalogue',[PILOT],workers=1)
