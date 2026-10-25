"""Complete synthetic admission and tiny component projections, never GRF."""
import importlib
import importlib.util
from pathlib import Path
import sys,threading,time
import shutil
from types import SimpleNamespace
import pytest
from grf_action_fixtures import action_trace,write_action_match
from timepitch.grf.action_models import ActionManifest
from timepitch.grf.physical_models import ActivityInput,ActivityChunk
from timepitch.grf.physical_codec import decode_chunk,make_chunk_ref,manifest_hash
from timepitch.grf.input import grf_input_hash
from timepitch.grf.models import EngineCapability
from timepitch.grf.process import GrfCancelled,GrfExecutionError


def api():
    name='timepitch.grf.action_validation'
    assert importlib.util.find_spec(name) is not None,'Missing complete action acceptance'
    return importlib.import_module(name)


def pair(*,split=False):
    m,actions=action_trace(splits=(2,) if split else ())
    value=m.input.model_dump(mode='json');value['settings'].pop('telemetry_policy');control=ActivityInput.model_validate(value)
    control.input_hash=grf_input_hash(control)
    controls=[ActivityChunk(**c.model_dump(exclude={'schema_version','contact_roles','semantic_events'})) for c in actions]
    common={k:getattr(m,k) for k in ('duration_ms','score','periods','ledger','attribute_readbacks','completion_reason')}
    return (SimpleNamespace(manifest=SimpleNamespace(input=control,**common),chunks=lambda:iter(controls)),
            SimpleNamespace(manifest=m,chunks=lambda:iter(actions)))


def test_public_validation_rejects_prefix_instead_of_inventing_full_time():
    module=api();manifest,blocks=action_trace()
    with pytest.raises(ValueError):module.validate_action_result(manifest,iter(blocks))


def test_game_projection_ignores_only_the_observer_selector():
    module=api();control,actions=pair()
    assert module.game_input_projection(control.manifest.input)==module.game_input_projection(actions.manifest.input)
    changed=actions.manifest.input.model_copy(deep=True);changed.settings.rest_radius_m=3.
    assert module.game_input_projection(control.manifest.input)!=module.game_input_projection(changed)
    changed.settings.telemetry_policy='forged'
    with pytest.raises(ValueError):module.game_input_projection(changed)


def test_stream_comparison_catches_changed_samples_raw_events_and_activity():
    module=api();control,actions=pair();result=module.compare_common_capture(control,actions)
    assert result['samples']==3 and result['events']==1 and result['blocks']==1
    for field in ('samples','events','activity'):
        control,actions=pair();block=next(actions.chunks())
        if field=='samples':block.samples[1][-3]+=1
        elif field=='events':block.events[0].player=8
        else:block.activity[1][0]=1
        with pytest.raises(ValueError):module.compare_common_capture(control,actions)


def test_stream_comparison_catches_missing_final_block_and_motion_settings():
    module=api();control,actions=pair(split=True);blocks=list(actions.chunks());actions.chunks=lambda:iter(blocks[:-1])
    with pytest.raises(ValueError):module.compare_common_capture(control,actions)
    control,actions=pair();control.manifest.input.settings.rest_radius_m=3.
    with pytest.raises(ValueError):module.compare_common_capture(control,actions)


def test_native_driver_rejects_missing_optin_or_budget_before_side_effects(tmp_path,monkeypatch):
    module=api();monkeypatch.setattr(module,'PROJECT_ROOT',tmp_path)
    monkeypatch.delenv('TIMEPITCH_TEST_GRF_CAMPAIGN',raising=False)
    with pytest.raises(ValueError):module.run_technical_case('T-control',tmp_path/'.local/grf-physical-work/continuation')
    monkeypatch.setenv('TIMEPITCH_TEST_GRF_CAMPAIGN','1')
    with pytest.raises(ValueError):module.run_technical_case('T-control',tmp_path/'fresh-budget')
    with pytest.raises(ValueError):module.run_technical_case('c4/calibration/01',tmp_path/'.local/grf-physical-work/continuation')
    assert not list(tmp_path.iterdir())


@pytest.fixture(scope='module')
def complete(tmp_path_factory):
    root=tmp_path_factory.mktemp('full-actions');return root,write_action_match(root)


def chunks(root,manifest):
    for ref in manifest.chunks:yield decode_chunk((root/f'{ref.index}.zlib').read_bytes())


def test_public_complete_summary_and_last_tick_integrity(complete):
    module=api();root,m=complete
    summary=module.validate_action_result(m,chunks(root,m))
    assert summary.duration_ms==5400000 and summary.score==(0,0)
    assert len(summary.players)==22 and len(summary.periods)==2
    assert sum(x.passes for x in summary.team_actions)==1
    altered=m.model_copy(deep=True);last=decode_chunk((root/f'{m.chunks[-1].index}.zlib').read_bytes())
    last.samples.pop();last.activity.pop();altered.chunks[-1]=make_chunk_ref(last);altered.trace_hash=manifest_hash(altered)
    def truncated():
        for block in chunks(root,m):yield last if block.index==last.index else block
    with pytest.raises(ValueError):module.validate_action_result(altered,truncated())


def test_overflow_or_unresolved_native_reference_never_admits_ready(complete):
    module=api();root,m=complete
    value=m.model_copy(deep=True);value.overflowed=True;value.trace_hash=manifest_hash(value)
    with pytest.raises(ValueError):module.validate_action_result(value,chunks(root,m))
    value=m.model_copy(deep=True);value.raw_event_count=100000;value.semantic_event_count=1;value.trace_hash=manifest_hash(value)
    with pytest.raises(ValueError):module.validate_action_result(value,chunks(root,m))
    value=m.model_copy(deep=True);first=next(chunks(root,m));first.semantic_events[0].raw_event_seq=99999
    value.chunks[0]=make_chunk_ref(first);value.trace_hash=manifest_hash(value)
    def bad_ref():
        for block in chunks(root,m):yield first if block.index==0 else block
    with pytest.raises(ValueError):module.validate_action_result(value,bad_ref())


def wire_process(module,root,capture,mode,cancel):
    class Synthetic(module.RecordedActionProcess):
        def capability(self):return EngineCapability(id='grf',available=True)
        def _command(self):return [str(self.python_path),str(Path(__file__).parent/'fixtures/grf/action_wire_child.py'),str(self.native_dir),mode]
    return Synthetic(Path(sys.executable),root,evidence_dir=capture,cancelled=cancel,cancel_after_first=mode=='partial',timeout=10)


def test_cancel_after_first_received_block_preserves_diagnostic_and_removes_child(complete,tmp_path):
    module=api();root,m=complete;cancel=threading.Event();process=wire_process(module,root,tmp_path/'capture','partial',cancel)
    try:
        start=time.monotonic()
        with pytest.raises(GrfCancelled):process.run(m.input,cancel)
        assert cancel.is_set() and process.cancel_requested_at is not None
        assert time.monotonic()-process.cancel_requested_at<5 and not process._active
        assert (tmp_path/'capture/observed/0.zlib').is_file()
        assert not (tmp_path/'capture/match/manifest.json').exists()
    finally:process.close()


def test_rejected_contact_keeps_observed_prefix_without_publication(complete,tmp_path):
    module=api();root,m=complete;cancel=threading.Event();process=wire_process(module,root,tmp_path/'capture','role',cancel)
    try:
        with pytest.raises(GrfExecutionError):process.run(m.input,cancel)
        assert not process._active and (tmp_path/'capture/observed/0.zlib').is_file()
        assert not (tmp_path/'capture/match/manifest.json').exists()
    finally:process.close()


def test_api_publication_export_owner_and_cancel_use_a_retained_synthetic_match(complete,tmp_path,monkeypatch):
    """Exercise the native acceptance's HTTP checks before spending any GRF ID."""
    import test_grf_action_full_native as acceptance
    from timepitch.grf.physical_wire import canonical
    module=api();source,m=complete;root=tmp_path/'isolated-campaign'
    destination=root/'evidence/T-actions/match';destination.mkdir(parents=True)
    for ref in m.chunks:shutil.copyfile(source/f'{ref.index}.zlib',destination/f'{ref.index}.zlib')
    shutil.copyfile(source/'manifest.json',destination/'manifest.json')
    summary=module.validate_action_result(m,chunks(source,m))
    (destination/'summary.json').write_bytes(canonical(summary.model_dump(mode='json')))
    monkeypatch.setattr(acceptance,'ROOT',root)
    good=acceptance._api_acceptance(monkeypatch)
    assert good['owner_isolation'] and good['publication']=='atomic_ready' and good['exported_blocks']==55
    assert acceptance._api_acceptance(monkeypatch,cancel=True)=={'partial_publication':'rejected'}
