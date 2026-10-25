"""Portable physical-period worker: fixed physics, bounded JSONL transport."""
from contextlib import redirect_stdout
from dataclasses import asdict
import base64
import hashlib
import json
import os
from pathlib import Path
import sys
import zlib
sys.path.insert(0,str(Path(__file__).resolve().parent))
from physical_wire import COLUMNS,CAUSES,canonical,digest,MAX_COMPRESSED,MAX_EXPANDED,MAX_SAMPLES,MAX_EVENTS,pack_samples
from physical_clock import ClockState,ClockObservation,advance_clock


def main():
    payload=json.loads(sys.stdin.buffer.read(32769));native=Path(sys.argv[1]).resolve()
    sys.path.insert(0,str(native));dll=os.add_dll_directory(str(native))
    assets=Path(sys.executable).parent/'Lib/site-packages/gfootball_engine'
    os.environ['GFOOTBALL_DATA_DIR']=str(assets/'data')
    os.environ['GFOOTBALL_FONT']=str(assets/'fonts/AlegreyaSansSC-ExtraBold.ttf')
    output=sys.stdout
    def emit(value):output.write(canonical(value).decode()+'\n');output.flush()
    with redirect_stdout(sys.stderr):
        from native_setup import create_core
        from physical_native import PhysicalNativeAdapter,physical_sample
        from native_telemetry import normalize_events
        core=create_core(payload)
        try:
            engine=core._env
            for p in payload['players']:
                for name,value in p['attributes'].items():engine.probe_set_stat(0 if p['side']=='home' else 1,p['slot'],name,value)
            adapter=PhysicalNativeAdapter(core,players=payload['players'])
            engine.probe_enable_periods();engine.probe_enable_stats(MAX_EVENTS)
            activity=payload['settings']['motion_policy']=='off-ball-activity-1'
            if activity:
                settings=payload['settings']
                engine.probe_enable_activity(settings['rest_radius_m'],settings['walk_speed_m_s'],settings['far_ball_m'],settings['entry_delay_ms'])
            state=adapter.snapshot();actual_origin=state['actual_time_ms']
            clock=ClockState();samples=[];events=[];refs=[];index=0;event_count=0;activity_rows=[]
            def flush():
                nonlocal samples,events,activity_rows
                if not samples:return
                block=dict(schema_version='grf-physical-chunk-1',index=len(refs),columns=COLUMNS,samples=samples,events=events)
                if activity:block.update(schema_version='grf-activity-chunk-1',activity=activity_rows)
                logical=canonical(block);expanded=canonical(pack_samples(block));raw=zlib.compress(expanded)
                if len(expanded)>MAX_EXPANDED or len(raw)>MAX_COMPRESSED:raise ValueError('Physical block budget')
                refs.append(dict(index=len(refs),samples=len(samples),events=len(events),physics_start=int(samples[0][1]),
                    physics_end=int(samples[-1][1]),compressed_bytes=len(raw),expanded_bytes=len(expanded),sha256=hashlib.sha256(logical).hexdigest()))
                emit(dict(type='chunk',data=base64.b64encode(raw).decode()));samples=[];events=[];activity_rows=[]
            def capture(state):
                nonlocal clock,index,event_count
                try:clock=advance_clock(clock,ClockObservation(physics_ms=state['physics_ms'],period=state['phase'],
                    effective_ms=state['effective_ms'],in_play=state['in_play'],restart_id=state['restart_id'],
                    restart_cause=state['restart_cause'],restart_active=state['restart_active'],
                    restart_start_ms=state['restart_start_ms'],pending_penalty=state['pending_penalty'],discontinuity=state['discontinuity']))
                except ValueError:
                    print({'clock_failure':{k:state[k] for k in ('physics_ms','phase','restart_id','restart_cause','restart_active','restart_start_ms','in_play','set_piece')},
                        'ledger_tail':[asdict(r) for r in clock.ledger[-3:]]},file=sys.stderr)
                    raise
                observation=core.observation()
                samples.append(physical_sample(state,observation,index,clock,CAUSES))
                if activity:activity_rows.append(list(state['home_activity'])+list(state['away_activity']))
                batch=dict(engine.probe_drain_stats())
                normalized=normalize_events(batch,index,limit=MAX_EVENTS)
                for event in normalized:
                    event['actual_time_ms']-=actual_origin
                events.extend(normalized);event_count+=len(normalized)
                if batch['emitted_count']!=event_count:raise ValueError('Physical events incomplete')
                engine.probe_drain_touches()
                index+=1
                if index>MAX_SAMPLES:raise ValueError('Physical sample budget')
                if len(samples)==1000:flush()
            capture(state)
            while not clock.finished:
                if clock.period_complete:
                    engine.probe_begin_second_half();state=adapter.snapshot()
                else:state=adapter.step()
                capture(state)
            flush()
            manifest=dict(schema_version='grf-physical-1',engine_version='grf-2.10.2-physical-periods-1',
                coordinate_units='native_metres',input=payload,
                native_binary_sha256=hashlib.sha256((native/'_gameplayfootball.pyd').read_bytes()).hexdigest(),
                attribute_readbacks=[{k:r[k] for k in ('side','slot','attribute','base','effective')} for r in adapter.readbacks],duration_ms=clock.physics_ms,score=state['score'],
                periods=clock.periods,ledger=[asdict(r) for r in clock.ledger],chunks=refs,completion_reason='full_time')
            if activity:manifest.update(schema_version='grf-activity-1',engine_version='grf-2.10.2-activity-1')
            manifest['trace_hash']=digest(manifest)
            emit(dict(type='manifest',manifest=manifest))
        finally:core.close();dll.close()


if __name__=='__main__':main()
