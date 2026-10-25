"""Standalone Python 3.10 entry point. Runs real GRF, never imports TimePitch."""
import hashlib
import json
import os
from pathlib import Path
import sys
import types
from contextlib import redirect_stdout
# Portable Python's ._pth deliberately omits the script directory.
sys.path.insert(0,str(Path(__file__).resolve().parent))
from match_rules import full_time_opportunity
from native_telemetry import normalize_events
from runtime_layout import native_binary,package_directory
from performance import StageTimings, PROFILE_ENV, emit_worker_profile
from native_json import encode_native_result, write_native_json


def _run(profile,identity):
    payload=profile.call('payload_decode',lambda:json.loads(sys.stdin.buffer.read(32769)))
    identity.append(payload['input_hash'])
    native=Path(sys.argv[1]).resolve()
    sys.path.insert(0,str(native))
    dll=os.add_dll_directory(str(native)) if os.name=='nt' else None
    package=package_directory(sys.executable)/'gfootball_engine'
    os.environ['GFOOTBALL_DATA_DIR']=str(package/'data')
    os.environ['GFOOTBALL_FONT']=str(package/'fonts/AlegreyaSansSC-ExtraBold.ttf')
    with redirect_stdout(sys.stderr):
        start=profile.start()
        from native_setup import create_core
        profile.stop('setup_import',start)
        core=profile.call('create_core',create_core,payload,**({'timings':profile} if profile.enabled else {}))
        native_before=getattr(core,'_steps_time',None) if profile.enabled else None
        try:
            engine=core._env
            start=profile.start()
            for p in payload['players']:
                for name,value in p['attributes'].items():engine.probe_set_stat(0 if p['side']=='home' else 1,p['slot'],name,value)
            readbacks=[]
            for p in payload['players']:
                for name,value in p['attributes'].items():
                    read=dict(engine.probe_get_stat(0 if p['side']=='home' else 1,p['slot'],name))
                    if abs(read['base']-value)>1e-5:raise ValueError('Native readback mismatch')
                    readbacks.append(dict(side=p['side'],slot=p['slot'],attribute=name,base=read['base'],effective=read['effective']))
            profile.stop('attributes',start)
            profile.call('touch_drain',engine.probe_drain_touches)
            samples=[];full_match='second_half' in payload['settings'];halftime=None;finished=False
            stats='telemetry_version' in payload;native_events=[];emitted_count=0
            if stats:profile.call('telemetry_enable',engine.probe_enable_stats,20000)
            def snapshot():
                observation=profile.call('observation',core.observation)
                info=profile.call('get_info',engine.get_info)
                clock=dict(profile.call('match_state',engine.probe_match_state)) if full_match else {}
                if stats:clock.update(dict(profile.call('stats_state',engine.probe_stats_state)))
                start=profile.start()
                samples.append(dict(index=len(samples),engine_step=int(info.step),score=observation['score'],
                    owner_team=observation['ball_owned_team'],owner_slot=observation['ball_owned_player'],
                    game_mode=observation['game_mode'],home_xy=observation['left_team'].tolist(),
                    away_xy=observation['right_team'].tolist(),ball_xyz=observation['ball'].tolist(),**clock))
                profile.stop('sample_conversion',start)
            snapshot();done=False
            while not done:
                _,_,done,_=profile.call('core_step',core.step,[19,19])
                snapshot();profile.call('touch_drain',engine.probe_drain_touches)
                if stats:
                    batch=dict(profile.call('stats_drain',engine.probe_drain_stats));emitted_count=batch['emitted_count']
                    native_events.extend(profile.call('event_normalize',normalize_events,batch,len(samples)-1))
                if full_match:
                    current=samples[-1]
                    if current['phase']==2 and halftime is None:halftime=current['index']
                    if done or current['match_time_ms']>=5760000:raise RuntimeError('Full match did not finish before safety limit')
                    # Let a live attack finish. Stoppages and the central area are
                    # explicit, reproducible whistle opportunities after 90.
                    if full_time_opportunity(current['phase'],current['match_time_ms'],current['game_mode'],current['ball_xyz'][0]):
                        finished=True;break
                if len(samples)>(4302 if full_match else 3102):raise RuntimeError('Episode exceeded bound')
            start=profile.start()
            result=dict(input_hash=payload['input_hash'],native_binary_sha256=hashlib.sha256(native_binary(native).read_bytes()).hexdigest(),
                attribute_readbacks=readbacks,duration_ms=(len(samples)-1)*100,steps_left=core.observation()['steps_left'],samples=samples)
            if full_match:
                if not finished or halftime is None:raise RuntimeError('Missing full match completion')
                result.update(halftime_sample_index=halftime,completion_reason='full_time')
            if stats:
                result['telemetry']=dict(version='grf-native-events-1',events=native_events,
                    emitted_count=emitted_count,overflowed=False)
            profile.stop('result_assembly',start)
        finally:
            if profile.enabled:profile.native_delta(native_before,getattr(core,'_steps_time',None))
            profile.call('core_close',core.close)
    start=profile.start()
    try:
        text=profile.call('json_encode',encode_native_result,result)
        profile.call('json_write',write_native_json,text,sys.stdout)
    finally:profile.stop('json_output',start)
    if dll is not None:dll.close()


def main():
    profile=StageTimings(os.getenv(PROFILE_ENV)=='1')
    identity=[];status='failed'
    try:
        _run(profile,identity)
        status='passed'
    finally:
        emit_worker_profile(profile,identity[0] if identity else None,status,sys.stderr)


if __name__=='__main__':main()
