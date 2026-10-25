"""Research process boundaries and reducer pin. Synthetic children only."""
from dataclasses import replace
import json
from pathlib import Path
import threading
import pytest
from grf_candidate_fixtures import bind,reserve
from grf_action_fixtures import write_action_match
from test_grf_candidate_profiles import api,ROOT
from timepitch.grf import physical_campaign_budget as budget
from timepitch.grf.action_validation import RetainedResult
from timepitch.grf.action_statistics import build_action_statistics
from timepitch.grf.physical_codec import manifest_hash
from timepitch.grf.models import EngineCapability
from timepitch.grf.process import GrfUnavailable,GrfExecutionError


def test_factory_rejects_unreserved_wrong_root_run_and_forged_profile(tmp_path,monkeypatch):
    _,root,_,profile=bind(tmp_path,monkeypatch);m=api('candidate_process')
    for where,id,p in [(root,'c4/calibration/01',profile),(root.with_name('other'),'c4/calibration/01',profile),
                       (root,'c5/calibration/01',profile),(root,'c4/calibration/01',replace(profile,native_sha256='f'*64))]:
        with pytest.raises(ValueError):m.CandidateProcess(p,root=where,run_id=id)
    reserve(root,profile)
    runner=m.CandidateProcess(profile,root=root,run_id='c4/calibration/01')
    try:assert runner.native_sha256==profile.native_sha256 and runner.timeout==600
    finally:runner.close()


def test_failed_capability_cannot_launch_twice_and_lost_reservation_blocks(tmp_path,monkeypatch):
    _,root,_,profile=bind(tmp_path,monkeypatch);m=api('candidate_process');reserve(root,profile)
    p=m.CandidateProcess(profile,root=root,run_id='c4/calibration/01')
    monkeypatch.setattr(p,'capability',lambda:EngineCapability(id='grf',available=False,reason='missing_assets'))
    request=m.request_for_run(profile,'c4/calibration/01')
    try:
        with pytest.raises(GrfUnavailable):p.run(request,threading.Event())
        assert (p.evidence/'launch.json').is_file()
        with pytest.raises((ValueError,FileExistsError)):p.run(request,threading.Event())
    finally:p.close()
    state=budget._read(root/'checkpoint.json');state['runs'].clear();budget._save(root,root.parent/'continuation-registration.json',state)
    with pytest.raises(ValueError):m.CandidateProcess(profile,root=root,run_id='c4/calibration/01')


@pytest.fixture(scope='module')
def full_actions(tmp_path_factory):
    path=tmp_path_factory.mktemp('candidate-full-synthetic');write_action_match(path)
    return RetainedResult(path)


def test_default_reducer_rejects_research_sha(full_actions):
    m=full_actions.manifest.model_copy(deep=True);m.native_binary_sha256='f'*64;m.trace_hash=manifest_hash(m)
    with pytest.raises(ValueError):build_action_statistics(m,full_actions.chunks())


def test_wrong_reducer_pin_rejected(full_actions):
    m=full_actions.manifest.model_copy(deep=True);m.native_binary_sha256='f'*64;m.trace_hash=manifest_hash(m)
    with pytest.raises(ValueError):build_action_statistics(m,full_actions.chunks(),_research_native_sha256='e'*64)


def test_profile_bound_reducer_matches_legacy_semantics(full_actions):
    original=build_action_statistics(full_actions.manifest,full_actions.chunks())
    m=full_actions.manifest.model_copy(deep=True);m.native_binary_sha256='f'*64;m.trace_hash=manifest_hash(m)
    research=build_action_statistics(m,full_actions.chunks(),_research_native_sha256='f'*64)
    assert original.model_dump(exclude={'trace_hash'})==research.model_dump(exclude={'trace_hash'})
    assert research.classification.release_ratio==1 and research.classification.releases==1


@pytest.mark.parametrize('mode',['ok','missing_policy'])
def test_complete_portable_synthetic_child_retains_prefix_and_checks_attestation(tmp_path,monkeypatch,full_actions,mode):
    _,root,_,profile=bind(tmp_path,monkeypatch);m=api('candidate_process')
    request=m.request_for_run(profile,'c4/calibration/01')
    manifest=full_actions.manifest.model_copy(deep=True)
    # Same synthetic geometry/events, bound to the exact frozen catalogue request.
    manifest.input=request;manifest.native_binary_sha256=profile.native_sha256
    from timepitch.grf.candidate_wire import normalize_payload
    payload=normalize_payload(request.model_dump(mode='json'))
    manifest.attribute_readbacks=[dict(side=p['side'],slot=p['slot'],attribute=k,base=v,effective=v)
        for p in payload['players'] for k,v in p['attributes'].items()]
    from timepitch.grf.models import GrfReadback
    manifest.attribute_readbacks=[GrfReadback.model_validate(r) for r in manifest.attribute_readbacks]
    manifest.trace_hash=manifest_hash(manifest)
    source=tmp_path/'synthetic-source';source.mkdir();(source/'manifest.json').write_text(manifest.model_dump_json())
    for ref in manifest.chunks:(source/f'{ref.index}.zlib').write_bytes((full_actions.path/f'{ref.index}.zlib').read_bytes())
    reserve(root,profile)
    class Synthetic(m.CandidateProcess):
        def capability(self):return EngineCapability(id='grf',available=True)
        def _command(self):
            return [str(ROOT/'.local/grf-spike/python/python.exe'),str(Path(__file__).parent/'fixtures/grf/candidate_wire_child.py'),
                str(source),str(self.policy_path),json.dumps(self.identity),json.dumps(self.profile.spec()),mode,
                str(ROOT/'backend/src/timepitch/grf')]
    runner=Synthetic(profile,root=root,run_id='c4/calibration/01');result=None
    try:
        if mode=='missing_policy':
            with pytest.raises(GrfExecutionError):runner.run(request,threading.Event())
        else:
            result=runner.run(request,threading.Event());assert result.count==55
            assert runner.policy['final']['counters']['marking_raised']==1
            assert len(result.manifest.attribute_readbacks)==66
        assert len(list(runner.evidence.glob('*.zlib')))==55
        assert (runner.evidence/'manifest.json').is_file() and (runner.evidence/'launch.json').is_file()
        with pytest.raises((ValueError,FileExistsError)):runner.run(request,threading.Event())
    finally:
        if result:result.close()
        runner.close()


def test_measurement_uses_profile_pin_and_v2_release_denominator(tmp_path,monkeypatch,full_actions):
    _,root,_,profile=bind(tmp_path,monkeypatch);process=api('candidate_process');m=api('action_campaign')
    request=process.request_for_run(profile,'c4/calibration/01')
    manifest=full_actions.manifest.model_copy(deep=True);manifest.input=request;manifest.native_binary_sha256=profile.native_sha256
    from timepitch.grf.models import GrfReadback
    manifest.attribute_readbacks=[GrfReadback(side=p.side,slot=p.slot,attribute=k,base=v,effective=v)
        for p in request.players for k,v in p.attributes.items()]
    manifest.trace_hash=manifest_hash(manifest)
    from types import SimpleNamespace
    result=SimpleNamespace(manifest=manifest,chunks=full_actions.chunks)
    from test_grf_candidate_profiles import raw_state
    wire=api('candidate_wire');identity=dict(run_id='c4/calibration/01',input_hash=request.input_hash,native_sha256=profile.native_sha256,
        profile_identity=profile.identity,build_manifest_sha256=profile.build_manifest_sha256)
    policy=wire.write_policy(tmp_path/'policy.json',identity,profile.spec(),raw_state(),raw_state(marking_eligible=2,marking_raised=1),manifest.trace_hash)
    row=m.measure_action_result(result,seconds=10.,peak_private_bytes=1000000,profile=profile,policy=policy)
    assert row['passes']==1 and row['shots']==0 and row['clearances']==0 and row['releases']==row['classified_releases']==1
    assert row['release_ratio']==1 and row['goals']==row['penalty_goals']==row['unknown_goals']==0
    assert len(row['players'])==22 and len(row['outfield_km'])==20 and row['goal_classification_complete']
    assert row['_analysis']['summary.json']['statistics_version']=='grf-physical-statistics-2'
    assert row['reduction_seconds']>0 and row['seconds']==10.
    with pytest.raises(ValueError):m.measure_action_result(result,seconds=601.,peak_private_bytes=1,profile=profile,policy=policy)
