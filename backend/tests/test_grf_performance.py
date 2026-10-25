"""Performance diagnostics are private; these tests never create a native game."""
import gzip
import builtins
import importlib
import itertools
import io
import json
from pathlib import Path
import sys
import threading
import types

import pytest

from timepitch.grf.codec import encode_grf, parse_grf
from timepitch.grf.models import EngineCapability
from timepitch.grf.process import GrfProcess, GrfExecutionError, GrfTimeout

ROOT=Path(__file__).resolve().parents[2]
SOURCE=ROOT/'research/engine-evaluation/2026-10-19-grf-server-match/match-replay.json.gz'
CHILD=Path(__file__).parent/'fixtures/grf/performance_wire_child.py'


@pytest.fixture(autouse=True)
def no_real_grf_import(monkeypatch):
    original=builtins.__import__
    def guarded(name,*args,**kwargs):
        if name.split('.')[0] in ('gfootball','gfootball_engine','_gameplayfootball'):
            if not getattr(sys.modules.get(name),'offline_fixture',False):
                raise AssertionError('Real GRF import forbidden in performance tests')
        return original(name,*args,**kwargs)
    monkeypatch.setattr(builtins,'__import__',guarded)


class SavedWireProcess(GrfProcess):
    def __init__(self, mode='valid', **kwargs):
        super().__init__(Path(sys.executable), CHILD.parent, **kwargs)
        self.mode=mode

    def capability(self):
        return EngineCapability(id='grf',available=True)

    def _command(self):
        return [sys.executable,'-u',str(CHILD),str(SOURCE),self.mode]


def test_timing_aggregates_integer_spans_and_disabled_never_reads_clock():
    from timepitch.grf.performance import StageTimings
    ticks=iter([0,10,30,40,70,90])
    timing=StageTimings(True,clock=lambda:next(ticks))
    start=timing.start();timing.stop('core_step',start)
    start=timing.start();timing.stop('core_step',start)
    report=timing.report()
    assert report['wall_ns']==90
    assert report['timings_ns']=={'core_step':50}
    assert report['calls']=={'core_step':2}
    disabled=StageTimings(False,clock=lambda:pytest.fail('Disabled clock was read'))
    disabled.stop('core_step',disabled.start())
    assert disabled.report() is None


def test_profiled_transport_preserves_complete_saved_replay_and_statistics(tmp_path):
    from timepitch.grf.statistics import build_grf_statistics
    original=parse_grf(gzip.decompress(SOURCE.read_bytes()))
    path=tmp_path/'private-profile.json'
    runner=SavedWireProcess()
    try:
        actual=runner.run(original.input,threading.Event(),profile_path=path)
    finally:runner.close()
    assert encode_grf(actual)==encode_grf(original)
    expected=json.loads(SOURCE.with_name('match-statistics.json').read_bytes())
    assert build_grf_statistics(actual).model_dump(mode='json')==expected
    profile=json.loads(path.read_bytes())
    assert profile['status']=='passed'
    assert profile['input_hash']==original.input.input_hash
    assert profile['trace_hash']==original.trace_hash
    assert profile['worker_status']=='available'
    assert profile['worker']['calls']['core_step']==2
    assert profile['worker']['native_step_ns']==50000000
    assert profile['parent']['calls']['strict_parse']==1
    assert set(profile['parent']['timings_ns'])=={
        'capability','request_encode','spawn','child_wait','decode','construct',
        'hash','encode','strict_parse','cleanup'}
    assert 'players' not in path.read_text(encoding='utf-8')


def test_bulk_transport_and_fast_storage_preserve_complete_saved_result(tmp_path):
    from timepitch.grf.repository import GrfRepository
    from timepitch.grf.statistics import build_grf_statistics
    import zlib
    original=parse_grf(gzip.decompress(SOURCE.read_bytes()))
    profile_path=tmp_path/'combined-profile.json'
    runner=SavedWireProcess('bulk')
    try:actual=runner.run(original.input,threading.Event(),profile_path=profile_path)
    finally:runner.close()
    report=json.loads(profile_path.read_bytes())
    assert report['worker']['calls']['json_encode']==report['worker']['calls']['json_write']==1
    assert report['worker']['native_step_ns'] is None
    assert 'core_step' not in report['worker']['calls']
    repo=GrfRepository(tmp_path/'combined.sqlite')
    job=repo.create(original.input.config,'offline-owner');assert repo.start(job.id,'offline-owner')
    repo.finish(job.id,'offline-owner',actual)
    restored=repo.get_record(job.id,'offline-owner');raw=encode_grf(original)
    assert encode_grf(actual)==encode_grf(restored)==raw
    with repo.connection() as conn:
        stored=conn.execute('SELECT record FROM grf_matches WHERE id=?',(job.id,)).fetchone()[0]
    assert stored==zlib.compress(raw,level=1)
    assert build_grf_statistics(restored).model_dump(mode='json')==json.loads(SOURCE.with_name('match-statistics.json').read_bytes())
    with pytest.raises(KeyError):repo.get_record(job.id,'stranger')
    restored.input.config.home_players[0]='locally-mutated'
    restored.samples[0].home_xy[0]=(.1,.2)
    assert encode_grf(repo.get_record(job.id,'offline-owner'))==raw
    assert encode_grf(actual)==raw


@pytest.mark.parametrize('mode',['invalid_profile','duplicate_profile','foreign_profile'])
def test_invalid_diagnostic_cannot_change_a_valid_match(tmp_path,mode):
    original=parse_grf(gzip.decompress(SOURCE.read_bytes()))
    runner=SavedWireProcess(mode)
    path=tmp_path/'profile.json'
    try:actual=runner.run(original.input,threading.Event(),profile_path=path)
    finally:runner.close()
    assert encode_grf(actual)==encode_grf(original)
    report=json.loads(path.read_bytes())
    assert report['worker_status']=='invalid' and report['worker'] is None


def test_ambient_flag_does_not_enable_profiling(tmp_path,monkeypatch):
    original=parse_grf(gzip.decompress(SOURCE.read_bytes()))
    monkeypatch.setenv('TIMEPITCH_GRF_PROFILE','1')
    runner=SavedWireProcess(stderr_limit=1)
    try:actual=runner.run(original.input,threading.Event())
    finally:runner.close()
    assert actual.trace_hash==original.trace_hash
    assert list(tmp_path.iterdir())==[]


def test_profile_never_overwrites_an_existing_file(tmp_path,caplog):
    original=parse_grf(gzip.decompress(SOURCE.read_bytes()))
    path=tmp_path/'existing.json';path.write_bytes(b'keep')
    runner=SavedWireProcess()
    try:actual=runner.run(original.input,threading.Event(),profile_path=path)
    finally:runner.close()
    assert actual.trace_hash==original.trace_hash and path.read_bytes()==b'keep'
    assert 'could not be written' in caplog.text


def test_invalid_profile_path_cannot_replace_the_original_outcome(caplog):
    from timepitch.grf.performance import write_private_profile
    write_private_profile(Path('bad\0report.json'),{'status':'passed'})
    assert 'could not be written' in caplog.text


def test_timeout_keeps_partial_parent_profile_and_original_error(tmp_path):
    original=parse_grf(gzip.decompress(SOURCE.read_bytes()))
    path=tmp_path/'timeout.json';runner=SavedWireProcess('sleep',timeout=.1)
    try:
        with pytest.raises(GrfTimeout):runner.run(original.input,threading.Event(),profile_path=path)
    finally:runner.close()
    report=json.loads(path.read_bytes())
    assert report['status']=='native_timeout' and report['worker_status']=='missing'
    assert report['trace_hash'] is None and not runner._active
    assert report['parent']['calls']['cleanup']==1


def test_diagnostic_bytes_still_count_towards_stderr_limit(tmp_path):
    original=parse_grf(gzip.decompress(SOURCE.read_bytes()))
    runner=SavedWireProcess(stderr_limit=16)
    try:
        with pytest.raises(GrfExecutionError):
            runner.run(original.input,threading.Event(),profile_path=tmp_path/'overflow.json')
    finally:runner.close()
    assert not runner._active


@pytest.mark.parametrize('statistics',[False,True])
def test_native_entrypoint_profiles_without_changing_wire_or_engine_calls(tmp_path,monkeypatch,statistics):
    # Only the external native environment is replaced. Execute the real runner.
    from grf_fixtures import request_fixture
    from grf_statistics_fixtures import statistics_request
    request=(statistics_request() if statistics else request_fixture()).model_dump(mode='json')
    native=tmp_path/'native';native.mkdir();(native/'_gameplayfootball.so').write_bytes(b'offline')
    runner=importlib.import_module('timepitch.grf.native_runner')
    original_timing=runner.StageTimings
    ticks=itertools.count(0,10000000)
    monkeypatch.setattr(runner,'StageTimings',lambda enabled:original_timing(enabled,clock=lambda:next(ticks)))
    monkeypatch.setattr(runner,'native_binary',lambda _:native/'_gameplayfootball.so')
    monkeypatch.setattr(runner,'package_directory',lambda _:tmp_path)
    monkeypatch.setattr(runner.os,'add_dll_directory',lambda _:None,raising=False)
    monkeypatch.setenv('GFOOTBALL_DATA_DIR','offline-test')
    monkeypatch.setenv('GFOOTBALL_FONT','offline-test')
    class Array:
        def __init__(self,value):self.value=value
        def tolist(self):return self.value
    class Core:
        def __init__(self):self._env=self;self.index=0;self._steps_time=0.;self.log=[];self.attrs={}
        def probe_set_stat(self,team,slot,name,value):self.attrs[team,slot,name]=value
        def probe_get_stat(self,team,slot,name):return {'base':self.attrs[team,slot,name],'effective':self.attrs[team,slot,name]}
        def probe_drain_touches(self):self.log.append('touches')
        def probe_enable_stats(self,capacity):assert capacity==20000
        def probe_match_state(self):
            return dict(phase=1 if self.index==0 else 2,match_time_ms=(0,5398200,5400000)[self.index],
                        actual_time_ms=1900+100*self.index,in_play=True,set_piece=False)
        def probe_stats_state(self):return dict(home_active=[True]*11,away_active=[True]*11,attack_direction=[1,-1])
        def probe_drain_stats(self):return dict(events=[],emitted_count=0,overflowed=False)
        def observation(self):
            self.log.append('observation')
            return dict(score=[0,0],ball_owned_team=0,ball_owned_player=9,game_mode=0,
                        left_team=Array([[0.,0.]]*11),right_team=Array([[.1,.1]]*11),
                        ball=Array([0.,0.,.1]),steps_left=2-self.index)
        def get_info(self):self.log.append('get_info');return types.SimpleNamespace(step=(-1,0,3000)[self.index])
        def step(self,actions):
            assert actions==[19,19]
            self.log.append('step');self.index+=1;self._steps_time+=.025
            return None,None,self.index==2 and not statistics,None
        def close(self):self.log.append('close')
    outputs=[];logs=[]
    for enabled in (False,True):
        core=Core()
        monkeypatch.setitem(sys.modules,'native_setup',types.SimpleNamespace(create_core=lambda payload,**kw:core))
        monkeypatch.setattr(sys,'stdin',types.SimpleNamespace(buffer=io.BytesIO(json.dumps(request).encode())))
        stdout=io.StringIO();stderr=io.StringIO()
        monkeypatch.setattr(sys,'stdout',stdout);monkeypatch.setattr(sys,'stderr',stderr)
        monkeypatch.setattr(sys,'argv',['native_runner.py',str(native)])
        monkeypatch.setenv('TIMEPITCH_GRF_PROFILE','1' if enabled else '0')
        runner.main()
        outputs.append(stdout.getvalue());logs.append(core.log)
        if enabled:
            from timepitch.grf.performance import read_worker_profile
            status,report=read_worker_profile(stderr.getvalue().encode(),request['input_hash'])
            assert status=='available' and report['calls']['core_step']==2
            assert report['calls']['json_output']==report['calls']['json_encode']==report['calls']['json_write']==1
            assert report['timings_ns']['json_output']>=report['timings_ns']['json_encode']+report['timings_ns']['json_write']
            assert report['native_step_ns']==50000000
            if statistics:assert report['calls']['stats_drain']==report['calls']['event_normalize']==2
        else:assert stderr.getvalue()==''
    assert outputs[0]==outputs[1] and logs[0]==logs[1]
    assert logs[0].count('step')==2 and logs[0].count('get_info')==3
    assert logs[0].count('observation')==4


def test_setup_timings_preserve_configuration_without_importing_grf(monkeypatch):
    from timepitch.grf import native_setup
    from timepitch.grf.performance import StageTimings
    from grf_fixtures import request_fixture
    configurations=[]
    def construct(config):configurations.append(config);return object()
    environment=types.SimpleNamespace(offline_fixture=True,
        config=types.SimpleNamespace(Config=lambda values:values),
        football_env_core=types.SimpleNamespace(FootballEnvCore=construct))
    scenario=types.SimpleNamespace(offline_fixture=True,Team=object(),Role=object())
    monkeypatch.setitem(sys.modules,'gfootball.env',environment)
    monkeypatch.setitem(sys.modules,'gfootball.env.scenario_builder',scenario)
    # create_core registers this ephemeral scenario; restore it after the test.
    monkeypatch.setitem(sys.modules,'gfootball.scenarios.timepitch_experimental',None)
    payload=request_fixture().model_dump(mode='json')
    native_setup.create_core(payload)
    timing=StageTimings(True)
    native_setup.create_core(payload,timings=timing)
    assert configurations[0]==configurations[1]
    assert configurations[0]['physics_steps_per_frame']==10
    assert configurations[0]['game_engine_random_seed']==42
    assert set(timing.report()['calls'])=={'grf_imports','scenario_config','environment_init'}


def test_missing_or_regressing_native_accumulator_is_unavailable():
    from timepitch.grf.performance import StageTimings
    for before,after in ((None,.1),(.2,.1),(.1,float('nan'))):
        timing=StageTimings(True);timing.native_delta(before,after)
        assert timing.native_step_ns is None


@pytest.mark.parametrize('bad_value',[float('nan'),-1,True,10**30])
def test_worker_report_rejects_invalid_or_unbounded_timing_values(bad_value):
    from timepitch.grf.performance import read_worker_profile, PROFILE_PREFIX
    report={'schema':'grf-worker-profile-1','input_hash':'a'*64,'status':'passed',
            'wall_ns':bad_value,'timings_ns':{},'calls':{},'native_step_ns':None}
    status,data=read_worker_profile((PROFILE_PREFIX+json.dumps(report)+'\n').encode(),'a'*64)
    assert status=='invalid' and data is None
