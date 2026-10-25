"""Portable bounded native segments; never emits a full-match manifest."""
import base64
from contextlib import redirect_stdout
import hashlib
import json
import os
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[4]
sys.path.insert(0,str(ROOT/'backend/src/timepitch/grf'))
from physical_wire import canonical,pack_samples,COLUMNS,CAUSES,MAX_EVENTS
from physical_native import PhysicalNativeAdapter,physical_sample
from physical_clock import ClockState,ClockObservation,advance_clock
from native_telemetry import normalize_events
from action_runner import iter_action_chunks,ActionCapture


def normalize(value):
    if hasattr(value,'tolist'):return normalize(value.tolist())
    if isinstance(value,dict):return {str(k):normalize(v) for k,v in value.items()}
    if isinstance(value,(tuple,list)):return [normalize(v) for v in value]
    return value


def main():
    spec=json.loads(sys.stdin.buffer.read(32769));payload=spec['input'];native=Path(sys.argv[1]).resolve()
    sys.path.insert(0,str(native));dll=os.add_dll_directory(str(native))
    assets=Path(sys.executable).parent/'Lib/site-packages/gfootball_engine'
    os.environ['GFOOTBALL_DATA_DIR']=str(assets/'data');os.environ['GFOOTBALL_FONT']=str(assets/'fonts/AlegreyaSansSC-ExtraBold.ttf')
    output=sys.stdout
    def emit(value):output.write(canonical(value).decode()+'\n');output.flush()
    with redirect_stdout(sys.stderr):
        from native_setup import create_core
        core=create_core(payload)
        try:
            engine=core._env
            for p in payload['players']:
                for name,value in p['attributes'].items():engine.probe_set_stat(0 if p['side']=='home' else 1,p['slot'],name,value)
            observations=hashlib.sha256();observation_count=0
            def observed(adapter):
                nonlocal observation_count
                original=adapter.snapshot
                def snapshot():
                    nonlocal observation_count
                    state=original();observations.update(canonical(normalize(core.observation())));observation_count+=1;return state
                adapter.snapshot=snapshot
            setups=[]
            if spec['kind']=='actions':
                capture=iter_action_chunks(core,payload,stop_physics_ms=spec['maximum_ms']);observed(capture.adapter)
                fixture_id=spec['id'].split('-')[0]
                if spec['id'].startswith('F'):
                    setups.append(dict(engine.probe_test_prepare_action_fixture(fixture_id,0)))
                    if fixture_id in ('F3','F4'):
                        original=capture.adapter.step;second=False
                        def step():
                            nonlocal second
                            state=original()
                            if not second and state['physics_ms']>=30000:
                                setups.append(dict(engine.probe_test_prepare_action_fixture(fixture_id,1)));second=True
                                state=capture.adapter.snapshot()
                            return state
                        capture.adapter.step=step
                for block in capture:emit(dict(type='chunk',data=base64.b64encode(capture.encode(block)).decode()))
                readbacks=capture.adapter.readbacks;duration=capture.clock.physics_ms
            else:
                engine.probe_enable_periods();engine.probe_enable_stats(MAX_EVENTS);settings=payload['settings']
                engine.probe_enable_activity(settings['rest_radius_m'],settings['walk_speed_m_s'],settings['far_ball_m'],settings['entry_delay_ms'])
                adapter=PhysicalNativeAdapter(core,players=payload['players']);observed(adapter)
                state=adapter.snapshot();origin=state['actual_time_ms'];clock=ClockState();rows=[];events=[];activity=[];index=0;block_index=0
                while True:
                    clock=advance_clock(clock,ClockObservation(physics_ms=state['physics_ms'],period=state['phase'],
                        effective_ms=state['effective_ms'],in_play=state['in_play'],restart_id=state['restart_id'],
                        restart_cause=state['restart_cause'],restart_active=state['restart_active'],restart_start_ms=state['restart_start_ms'],
                        pending_penalty=state['pending_penalty'],discontinuity=state['discontinuity']))
                    rows.append(physical_sample(state,core.observation(),index,clock,CAUSES))
                    activity.append(list(state['home_activity'])+list(state['away_activity']))
                    batch=normalize_events(dict(engine.probe_drain_stats()),index,limit=MAX_EVENTS)
                    for event in batch:event['actual_time_ms']-=origin
                    events.extend(batch);engine.probe_drain_touches();index+=1
                    stop=clock.physics_ms>=spec['maximum_ms']
                    if len(rows)==1000 or stop:
                        block=dict(schema_version='grf-activity-chunk-1',index=block_index,columns=COLUMNS,samples=rows,activity=activity,events=events)
                        emit(dict(type='chunk',data=base64.b64encode(ActionCapture.encode(block)).decode()))
                        block_index+=1;rows=[];events=[];activity=[]
                    if stop:break
                    state=adapter.step()
                readbacks=adapter.readbacks;duration=clock.physics_ms
            emit(dict(type='segment',id=spec['id'],physics_ms=duration,setups=setups,
                readbacks=[{k:r[k] for k in ('side','slot','attribute','base','effective')} for r in readbacks],
                observations_sha256=observations.hexdigest(),observation_count=observation_count))
        finally:core.close();dll.close()


if __name__=='__main__':main()
