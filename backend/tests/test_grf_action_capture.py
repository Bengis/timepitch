"""Exercise portable capture with synthetic snapshots, never a football environment."""
from types import SimpleNamespace
import pytest
from grf_action_fixtures import action_trace, semantic
from grf_statistics_fixtures import native_event
from timepitch.grf import action_runner
from timepitch.grf.action_models import ActionManifest,ACTION_NATIVE_SHA256
from timepitch.grf.physical_codec import validate_manifest, decode_chunk


class SnapshotAdapter:
    def __init__(self,core,players):
        self.core=core;self.engine=core._env;self.readbacks=[dict(side=p['side'],slot=p['slot'],attribute=k,base=v,effective=v)
            for p in players for k,v in p['attributes'].items()]
        self.raw_count=0;self.semantic_count=0
    def snapshot(self):
        e=self.engine;t=e.elapsed;second=e.phase==2
        return dict(physics_ms=t+(2700000 if second else 0),phase=e.phase,effective_ms=0,in_play=0<t<2700000,
            set_piece=False,discontinuity=second and t==0,restart_id=0,restart_cause='none',restart_active=False,
            restart_start_ms=0,pending_penalty=False,score=(0,0),attack_direction=(1,-1),relocation_id=int(second),game_mode=0,
            home_active=[True]*11,away_active=[True]*11,home_fatigue=[1.]*11,away_fatigue=[1.]*11,ball_xyz=(.2,.3,.4),
            home_activity=[0]*11,away_activity=[1]*11)
    def step(self):self.engine.elapsed+=100;return self.snapshot()
    def drain(self,index):
        if index!=1:return dict(events=[],contact_roles=[],semantic_events=[])
        self.raw_count=1;self.semantic_count=1
        return dict(events=[native_event(sample_index=1,actual_time_ms=100,match_time_ms=100)],contact_roles=[2],semantic_events=[semantic()])


class SetupDouble:
    def __init__(self):self.elapsed=0;self.phase=1
    def probe_enable_periods(self):pass
    def probe_enable_stats(self,capacity):pass
    def probe_enable_actions(self,capacity):pass
    def probe_enable_activity(self,*args):pass
    def probe_begin_second_half(self):self.elapsed=0;self.phase=2


def make_capture(monkeypatch,stop=None):
    monkeypatch.setattr(action_runner,'ActionNativeAdapter',SnapshotAdapter)
    m,_=action_trace()
    observation=dict(ball_owned_team=-1,ball_owned_player=-1,left_team=[[.1,.2]]*11,right_team=[[-.3,-.4]]*11,
        left_team_direction=[[.01,.02]]*11,right_team_direction=[[-.01,-.01]]*11)
    core=SimpleNamespace(_env=SetupDouble(),observation=lambda:observation)
    return action_runner.iter_action_chunks(core,m.input.model_dump(mode='json'),stop)


def test_prefix_capture_keeps_native_units_activity_and_actions_but_cannot_publish(monkeypatch):
    capture=make_capture(monkeypatch,100)
    blocks=list(capture);block=decode_chunk(capture.encode(blocks[0]))
    assert len(block.samples)==2 and len(block.samples[0])==156
    assert block.samples[1][21:25]==pytest.approx([5.44,-16.72,5.44,-16.72])
    assert block.samples[1][-3:]==pytest.approx([10.88,-25.08,.4])
    assert block.activity[1]==[0]*11+[1]*11
    assert block.contact_roles==[2] and block.semantic_events[0].physics_ms==100
    with pytest.raises(ValueError,match='prefix'):capture.manifest(ACTION_NATIVE_SHA256)
    with pytest.raises(ValueError,match='single-use'):list(capture)


def test_complete_synthetic_capture_produces_admissible_manifest_without_server_imports(monkeypatch,tmp_path):
    capture=make_capture(monkeypatch)
    for block in capture:(tmp_path/f'{block["index"]}.zlib').write_bytes(capture.encode(block))
    manifest=ActionManifest.model_validate(capture.manifest(ACTION_NATIVE_SHA256))
    def chunks():
        for ref in manifest.chunks:yield decode_chunk((tmp_path/f'{ref.index}.zlib').read_bytes())
    validate_manifest(manifest,chunks())
    assert manifest.duration_ms==5400000 and manifest.raw_event_count==manifest.semantic_event_count==1
    assert len(manifest.chunks)==55
