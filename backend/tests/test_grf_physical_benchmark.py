"""Promotion gates include every fixture and do not turn missing data into zeros."""
from copy import deepcopy
import json
from pathlib import Path
from types import SimpleNamespace
import pytest
from timepitch.grf.physical_benchmark import evaluate_gates,validate_benchmark


def measured():
    return dict(status='ready',outfield_km=[10.]*20,player_coverage=[1.]*22,effective_minutes=60.,
        goals=3,shot_contacts=25,pass_contacts=700)


def test_gate_report_retains_failures_and_does_not_normalize_distance():
    rows=[measured() for _ in range(24)]
    assert all(evaluate_gates(rows,expected=24).values())
    rows[0]={'status':'failed','error':'timeout'}
    assert not evaluate_gates(rows,expected=24)['all_completed']
    assert not evaluate_gates(rows,expected=24)['coverage']
    rows=[measured() for _ in range(24)];rows[0]['outfield_km']=rows[1]['outfield_km']=[25.]*20
    assert not evaluate_gates(rows,expected=24)['distance_p95']
    rows=[measured() for _ in range(24)];rows[0]['goals']=rows[1]['goals']=10
    assert not evaluate_gates(rows,expected=24)['extreme_scores']


def test_incomplete_split_cannot_pass_or_run_arbitrary_fixtures():
    assert not evaluate_gates([measured()],expected=8)['all_completed']
    with __import__('pytest').raises(ValueError):validate_benchmark({'calibration':[],'heldout':[]})


def test_add_candidate_preserves_frozen_fixture_identity_but_binding_cannot_change():
    from timepitch.grf.physical_benchmark import experiment_identity,bind_candidate
    manifest={'calibration':[1,2], 'heldout':[3], 'dataset_sha256':'a', 'candidates':[{'id':'c1','settings':{'walk':2.2}}]}
    original=experiment_identity(manifest);checkpoint={'candidate_bindings':{}}
    bind_candidate(checkpoint,manifest['candidates'][0])
    manifest['candidates'].append({'id':'c2','settings':{'walk':2.0}})
    assert experiment_identity(manifest)==original
    bind_candidate(checkpoint,manifest['candidates'][1])
    with __import__('pytest').raises(ValueError):bind_candidate(checkpoint,{'id':'c1','settings':{'walk':1.0}})
    manifest['heldout']=[4]
    assert experiment_identity(manifest)!=original


@pytest.mark.parametrize('keep_freeze',[True,False])
def test_started_heldout_rejects_new_calibration_without_running_or_changing_checkpoint(tmp_path,monkeypatch,keep_freeze):
    import timepitch.grf.physical_benchmark as benchmark
    manifest=json.loads((benchmark.ROOT/'research/engine-evaluation/2026-10-16-grf-physical-time/benchmark.json').read_text())
    # This case adds its own second candidate, independent of measured arms in the study.
    manifest['candidates']=[manifest['candidates'][0]]
    candidate=deepcopy(manifest['candidates'][0]);candidate['id']='c2';candidate['settings']['walk_speed_m_s']=2.
    manifest['candidates'].append(candidate);manifest.update(split='calibration',candidate='c2')
    checkpoint=dict(identity=benchmark.experiment_identity(manifest),candidate_bindings={},runs=[dict(key='c1/heldout/01',status='ready')])
    benchmark.bind_candidate(checkpoint,manifest['candidates'][0])
    path=tmp_path/'checkpoint.json';path.write_text(json.dumps(checkpoint));before=path.read_bytes()
    if keep_freeze:
        (tmp_path/'freeze.json').write_text(json.dumps(dict(identity=checkpoint['identity'],candidate='c1',
            settings=manifest['candidates'][0]['settings'],native_binary_sha256=benchmark.ACTIVITY_NATIVE_SHA256,
            calibration_report_sha256='a'*64)))
    calls=[]
    class ForbiddenRunner:
        def __init__(self,*args):pass
        def capability(self):return SimpleNamespace(available=True)
        def run(self,*args):calls.append(True);raise RuntimeError('No native invocation permitted')
        def close(self):pass
    monkeypatch.setattr(benchmark,'ActivityProcess',ForbiddenRunner)
    with pytest.raises(ValueError,match='[Ff]rozen|freeze|held-out'):benchmark.run_benchmark(manifest,tmp_path)
    assert calls==[] and path.read_bytes()==before
    assert not (tmp_path/'benchmark.lock').exists()
