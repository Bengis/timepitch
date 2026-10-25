"""Pure resource clocks/peaks/failure records; no native process or campaign write."""
import dataclasses,importlib,importlib.util,json,math
from pathlib import Path
import pytest
from grf_offline_guard import offline_only

def api():
    name='timepitch.grf.m1_resources'
    assert importlib.util.find_spec(name),'Resource budget missing'
    return importlib.import_module(name)

@pytest.fixture
def clocks(monkeypatch):
    m=api();state=dict(wall=0.,cpu=0.,memory=1024)
    monkeypatch.setattr(m,'_wall_clock',lambda:state['wall'])
    monkeypatch.setattr(m,'_cpu_clock',lambda:state['cpu'])
    monkeypatch.setattr(m,'_parent_peak',lambda:state['memory'])
    return m,state

def test_one_deadline_across_capture_and_admission(clocks):
    m,t=clocks;b=m.M1Budget();t.update(wall=599.9,cpu=7.)
    s=b.checkpoint('capture');assert s.elapsed_seconds==599.9
    t['wall']=600.;assert b.checkpoint('admission').elapsed_seconds==600.
    t['wall']=600.001
    with pytest.raises(m.M1ResourceExceeded) as ex:b.checkpoint('finalize')
    s=ex.value.snapshot;assert s.exceeded_time and not s.exceeded_memory and s.elapsed_seconds==600.001
    assert s.limit_seconds==600 and s.limit_private_bytes==536870912
    t['wall']=0.
    with pytest.raises(m.M1ResourceExceeded) as again:b.checkpoint('cleanup')
    assert again.value is ex.value

@pytest.mark.parametrize('axis',['parent','child','both','time_and_memory'])
def test_memory_limit_and_both_axes(clocks,axis):
    m,t=clocks;b=m.M1Budget();limit=536870912
    t['memory']=limit if axis=='child' else limit+1
    t['wall']=601. if axis=='time_and_memory' else 1.
    child=limit+1 if axis in ('child','both') else 0
    with pytest.raises(m.M1ResourceExceeded) as ex:b.checkpoint('admission',child_peak=child)
    assert ex.value.snapshot.exceeded_memory
    assert ex.value.snapshot.exceeded_time==(axis=='time_and_memory')

def test_exact_memory_limit_is_allowed(clocks):
    m,t=clocks;t['memory']=536870912;b=m.M1Budget()
    assert not b.checkpoint('capture',child_peak=536870912).exceeded_memory

@pytest.mark.parametrize('value',[float('nan'),float('inf'),-1.,True,'1',10**400])
def test_nonfinite_or_regressing_clock_fails(clocks,value):
    m,t=clocks;b=m.M1Budget();t['wall']=value
    with pytest.raises(m.M1ResourceExceeded) as ex:b.checkpoint('capture')
    assert ex.value.snapshot.sensor_status=='clock_invalid' and ex.value.snapshot.elapsed_seconds is None

@pytest.mark.parametrize('value',[float('nan'),float('inf'),-1.,True,'1',10**400])
def test_bad_initial_clock_fails(clocks,value):
    m,t=clocks;t['wall']=value
    with pytest.raises(m.M1ResourceExceeded) as ex:m.M1Budget()
    assert ex.value.snapshot.elapsed_seconds is None

@pytest.mark.parametrize('value',[None,0,-1,True,1.5])
def test_unavailable_memory_fails(clocks,value):
    m,t=clocks;b=m.M1Budget();t['memory']=value
    with pytest.raises(m.M1ResourceExceeded) as ex:b.checkpoint('capture')
    assert ex.value.snapshot.sensor_status=='memory_unavailable' and ex.value.snapshot.parent_peak_private_bytes is None

def test_sampler_exception_and_cpu_regression_fail(clocks,monkeypatch):
    m,t=clocks;b=m.M1Budget();t['cpu']=-1
    with pytest.raises(m.M1ResourceExceeded) as ex:b.checkpoint('capture')
    assert ex.value.snapshot.sensor_status=='cpu_invalid'
    t['cpu']=0;b=m.M1Budget()
    def unavailable():raise OSError('no sensor')
    monkeypatch.setattr(m,'_parent_peak',unavailable)
    with pytest.raises(m.M1ResourceExceeded) as ex:b.checkpoint('capture')
    assert ex.value.snapshot.sensor_status=='memory_unavailable'

@pytest.mark.parametrize('value',[None,-1,True,1.5])
def test_invalid_child_peak_fails(clocks,value):
    m,t=clocks;b=m.M1Budget()
    with pytest.raises(m.M1ResourceExceeded) as ex:b.checkpoint('capture',child_peak=value)
    assert ex.value.snapshot.sensor_status=='child_memory_unavailable'

def test_lifetime_peak_scope_is_explicit(clocks):
    m,t=clocks;b=m.M1Budget();t['memory']=2048
    first=b.checkpoint('capture',child_peak=4096)
    t['memory']=1024;t['wall']=2
    second=b.checkpoint('admission',child_peak=1000)
    assert second.parent_peak_private_bytes==2048 and second.child_peak_private_bytes==4096
    assert second.peak_private_bytes==4096 # Not simultaneous sum.
    assert 'max-per-process' in second.memory_scope
    with pytest.raises(dataclasses.FrozenInstanceError):second.stage='other'

def test_stage_wall_and_cpu_totals_are_inclusive(clocks):
    m,t=clocks;b=m.M1Budget();t.update(wall=3.,cpu=1.)
    b.checkpoint('capture');t.update(wall=8.,cpu=4.)
    s=b.checkpoint('admission')
    assert dict(s.stage_wall_seconds)['capture_preflight']==3.
    assert dict(s.stage_wall_seconds)['capture']==5.
    assert math.isclose(sum(v for _,v in s.stage_wall_seconds),s.elapsed_seconds)
    assert math.isclose(sum(v for _,v in s.stage_cpu_seconds),s.cpu_seconds)

def test_original_unknown_values_stay_unknown(clocks):
    m,t=clocks;b=m.M1Budget();s=b.checkpoint('capture_preflight')
    assert s.child_peak_private_bytes is None and not s.exceeded_memory
    assert not hasattr(s,'original_charged_seconds')

def identity():return dict(run_id='M-observe-42',mode='observe',input_hash='a'*64,native_sha256='b'*64,profile_identity='c'*64,build_manifest_sha256='d'*64)

def failure(clocks):
    m,t=clocks;b=m.M1Budget();t['wall']=601.
    with pytest.raises(m.M1ResourceExceeded) as ex:b.checkpoint('finalize')
    return m,ex.value

def test_failure_record_is_bounded_exclusive_and_truthful(clocks,tmp_path):
    m,ex=failure(clocks);p=tmp_path/'resource-failure.json'
    assert m.record_resource_failure(p,ex,identity=identity(),trace_hash='e'*64,last_durable_block=4,last_durable_ms=500000)
    d=json.loads(p.read_bytes());assert len(p.read_bytes())<=16384
    assert d['schema_version']=='m1-resource-failure-1' and d['admitted'] is False
    assert d['resources']['elapsed_seconds']==601. and d['resources']['exceeded_time']
    assert d['last_durable_ms']==500000 and d['identity']==identity()
    original=p.read_bytes()
    assert not m.record_resource_failure(p,ex,identity=identity(),trace_hash='e'*64,last_durable_block=5,last_durable_ms=600000)
    assert p.read_bytes()==original

def test_failure_receipt_write_error_preserves_original_failure(clocks,tmp_path,monkeypatch):
    m,ex=failure(clocks);p=tmp_path/'resource-failure.json';original=Path.open
    def broken(path,*args,**kwargs):
        if path==p:raise OSError('disk failure')
        return original(path,*args,**kwargs)
    monkeypatch.setattr(Path,'open',broken)
    assert not m.record_resource_failure(p,ex,identity=identity(),trace_hash=None,last_durable_block=None,last_durable_ms=None)
    assert ex.snapshot.exceeded_time and ex.diagnostic_error=='OSError'

@pytest.mark.parametrize('change',['identity','trace','block','time','paired','extra'])
def test_invalid_failure_metadata_is_not_written(clocks,tmp_path,change):
    m,ex=failure(clocks);who=identity();trace='e'*64;block=0;ms=100
    if change=='identity':who['mode']='apply'
    elif change=='trace':trace='wrong'
    elif change=='block':block=-1
    elif change=='time':ms=True
    elif change=='paired':block=None
    else:who['unbounded']='x'*20000
    p=tmp_path/'resource-failure.json'
    assert not m.record_resource_failure(p,ex,identity=who,trace_hash=trace,last_durable_block=block,last_durable_ms=ms)
    assert not p.exists()

def test_unknown_stage_does_not_mutate_clock_state(clocks):
    m,t=clocks;b=m.M1Budget()
    with pytest.raises(ValueError):b.checkpoint('invented')
    t['wall']=1;assert b.checkpoint('capture').elapsed_seconds==1


def test_resource_budget_module_available():
    api()

@pytest.mark.parametrize('forgery',['healthy','wrong_limits'])
def test_failure_recorder_refuses_healthy_or_wrong_policy_snapshot(clocks,tmp_path,forgery):
    m,t=clocks;b=m.M1Budget();s=b.checkpoint('capture')
    if forgery=='wrong_limits':s=dataclasses.replace(s,elapsed_seconds=601.,exceeded_time=True,limit_seconds=900)
    error=m.M1ResourceExceeded(s)
    assert not m.record_resource_failure(tmp_path/'resource-failure.json',error,identity=identity(),trace_hash=None,last_durable_block=None,last_durable_ms=None)
    assert not (tmp_path/'resource-failure.json').exists()
