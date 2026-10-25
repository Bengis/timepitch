"""Portable action capture shared by product runs and ledgered acceptance prefixes.

No server/Pydantic imports, and no football imports until main creates its core.
"""
from contextlib import redirect_stdout
from dataclasses import asdict
import base64,hashlib,json,os,sys,zlib
from pathlib import Path
if __package__:
    from .action_native import ActionNativeAdapter
    from .physical_native import physical_sample
    from .physical_wire import (COLUMNS,CAUSES,canonical,digest,pack_samples,MAX_COMPRESSED,MAX_EXPANDED,
        MAX_SAMPLES,MAX_EVENTS,MAX_TOTAL_COMPRESSED,MAX_TOTAL_EXPANDED,MAX_MANIFEST,MAX_PHYSICS_MS)
    from .physical_clock import ClockState,ClockObservation,advance_clock
else:
    sys.path.insert(0,str(Path(__file__).resolve().parent))
    from action_native import ActionNativeAdapter
    from physical_native import physical_sample
    from physical_wire import (COLUMNS,CAUSES,canonical,digest,pack_samples,MAX_COMPRESSED,MAX_EXPANDED,
        MAX_SAMPLES,MAX_EVENTS,MAX_TOTAL_COMPRESSED,MAX_TOTAL_EXPANDED,MAX_MANIFEST,MAX_PHYSICS_MS)
    from physical_clock import ClockState,ClockObservation,advance_clock


class ActionCapture:
    def __init__(self,core,payload,stop_physics_ms,*,sample_observer=None):
        if stop_physics_ms is not None and (type(stop_physics_ms) is not int or not 0<stop_physics_ms<=MAX_PHYSICS_MS):
            raise ValueError('Invalid action prefix limit')
        self.core=core;self.payload=payload;self.stop_physics_ms=stop_physics_ms
        self.sample_observer=sample_observer
        self.clock=ClockState();self.refs=[];self.compressed=0;self.expanded=0;self.completed=False;self.started=False
        engine=core._env;settings=payload['settings']
        if settings.get('telemetry_policy')!='action-contact-1' or settings['motion_policy']!='off-ball-activity-1':
            raise ValueError('Action policy required')
        engine.probe_enable_periods();engine.probe_enable_stats(MAX_EVENTS)
        engine.probe_enable_activity(settings['rest_radius_m'],settings['walk_speed_m_s'],settings['far_ball_m'],settings['entry_delay_ms'])
        engine.probe_enable_actions(MAX_EVENTS)
        self.adapter=ActionNativeAdapter(core,payload['players'])

    def _clock_step(self,state):
        self.clock=advance_clock(self.clock,ClockObservation(physics_ms=state['physics_ms'],period=state['phase'],
            effective_ms=state['effective_ms'],in_play=state['in_play'],restart_id=state['restart_id'],
            restart_cause=state['restart_cause'],restart_active=state['restart_active'],restart_start_ms=state['restart_start_ms'],
            pending_penalty=state['pending_penalty'],discontinuity=state['discontinuity']))

    def _after_sample(self,state,row):
        pass

    def _flush_on_clock_error(self):
        return False

    def _block(self,rows,activity,events,roles,semantic):
        block=dict(schema_version='grf-actions-chunk-1',index=len(self.refs),columns=COLUMNS,samples=rows,
            activity=activity,events=events,contact_roles=roles,semantic_events=semantic)
        raw=self.encode(block)
        self.refs.append(dict(index=len(self.refs),samples=len(rows),events=len(events),semantic_events=len(semantic),
            physics_start=int(rows[0][1]),physics_end=int(rows[-1][1]),compressed_bytes=len(raw),
            expanded_bytes=len(canonical(pack_samples(block))),sha256=hashlib.sha256(canonical(block)).hexdigest()))
        self.compressed+=len(raw);self.expanded+=self.refs[-1]['expanded_bytes']
        if self.compressed>MAX_TOTAL_COMPRESSED or self.expanded>MAX_TOTAL_EXPANDED:raise ValueError('Action stream budget')
        return block

    def __iter__(self):
        if self.started:raise ValueError('Action capture is single-use')
        self.started=True;index=0;rows=[];activity=[];events=[];roles=[];semantic=[]
        state=self.adapter.snapshot()
        while True:
            try:self._clock_step(state)
            except ValueError:
                if rows and self._flush_on_clock_error():yield self._block(rows,activity,events,roles,semantic)
                raise
            rows.append(physical_sample(state,self.core.observation(),index,self.clock,CAUSES))
            if self.sample_observer is not None:self.sample_observer(tuple(rows[-1]))
            activity.append(list(state['home_activity'])+list(state['away_activity']))
            batch=self.adapter.drain(index)
            events.extend(batch['events']);roles.extend(batch['contact_roles']);semantic.extend(batch['semantic_events'])
            index+=1
            if index>MAX_SAMPLES:raise ValueError('Action sample budget')
            self._after_sample(state,rows[-1])
            stop=self.clock.finished or (self.stop_physics_ms is not None and self.clock.physics_ms>=self.stop_physics_ms)
            if len(rows)==1000 or stop:
                yield self._block(rows,activity,events,roles,semantic)
                rows=[];activity=[];events=[];roles=[];semantic=[]
            if stop:break
            if self.clock.period_complete:
                self.core._env.probe_begin_second_half();state=self.adapter.snapshot()
            else:state=self.adapter.step()
        self.state=state;self.completed=True

    @staticmethod
    def encode(block):
        expanded=canonical(pack_samples(block));raw=zlib.compress(expanded)
        if len(expanded)>MAX_EXPANDED or len(raw)>MAX_COMPRESSED:raise ValueError('Action block budget')
        return raw

    def manifest(self,native_sha256):
        if not self.completed or self.stop_physics_ms is not None or not self.clock.finished:
            raise ValueError('A prefix is not a complete action match')
        result=dict(schema_version='grf-actions-1',engine_version='grf-2.10.2-actions-1',coordinate_units='native_metres',
            input=self.payload,native_binary_sha256=native_sha256,
            attribute_readbacks=[{k:r[k] for k in ('side','slot','attribute','base','effective')} for r in self.adapter.readbacks],
            duration_ms=self.clock.physics_ms,score=self.state['score'],periods=self.clock.periods,
            ledger=[asdict(r) for r in self.clock.ledger],chunks=self.refs,completion_reason='full_time',
            raw_event_count=self.adapter.raw_count,semantic_event_count=self.adapter.semantic_count,overflowed=False)
        result=self._manifest(result)
        result['trace_hash']=digest(result)
        if len(canonical(result))>MAX_MANIFEST:raise ValueError('Action manifest budget')
        return result

    def _manifest(self,result):
        return result


def iter_action_chunks(core,payload,stop_physics_ms=None):
    return ActionCapture(core,payload,stop_physics_ms)


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
        core=create_core(payload)
        try:
            for p in payload['players']:
                for name,value in p['attributes'].items():core._env.probe_set_stat(0 if p['side']=='home' else 1,p['slot'],name,value)
            capture=iter_action_chunks(core,payload)
            for block in capture:emit(dict(type='chunk',data=base64.b64encode(capture.encode(block)).decode()))
            emit(dict(type='manifest',manifest=capture.manifest(hashlib.sha256((native/'_gameplayfootball.pyd').read_bytes()).hexdigest())))
        finally:core.close();dll.close()


if __name__=='__main__':main()
