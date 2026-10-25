"""Isolated native physical-step acceptance; never uses the active database."""
import json
import os
from pathlib import Path
import sys
from contextlib import redirect_stdout

native=Path(sys.argv[1]).resolve();case=sys.argv[2]
sys.path.insert(0,str(native))
sys.path.insert(0,str(Path(__file__).resolve().parents[3]/'src/timepitch/grf'))
dll=os.add_dll_directory(str(native))
assets=Path(sys.executable).parent/'Lib/site-packages/gfootball_engine'
os.environ['GFOOTBALL_DATA_DIR']=str(assets/'data')
os.environ['GFOOTBALL_FONT']=str(assets/'fonts/AlegreyaSansSC-ExtraBold.ttf')
request=json.loads(sys.stdin.buffer.read()) if case=='clock' else None
with redirect_stdout(sys.stderr):
    from gfootball.env import config,football_env_core
    core=football_env_core.FootballEnvCore(config.Config({
        'level':'tests.corner_test' if case=='restart' or case.startswith('boundary_') else '11_vs_11_stochastic',
        'players':['agent:left_players=1,right_players=1'],'action_set':'v2',
        'game_engine_random_seed':42,'reverse_team_processing':False,
        'physics_steps_per_frame':10,'dump_full_episodes':False,'dump_scores':False,'write_video':False}))
    try:
        assert hasattr(core._env,'probe_step_physical'), 'Missing native fixed-step API'
        from physical_native import PhysicalNativeAdapter
        if request:
            for p in request['players']:
                for name,value in p['attributes'].items():
                    core._env.probe_set_stat(0 if p['side']=='home' else 1,p['slot'],name,value)
        adapter=PhysicalNativeAdapter(core,players=request['players'] if request else None)
        if case.startswith('boundary_'):
            # Shift the 100 ms observation boundary through all ten native ticks.
            # Ordinary native stepping is only fixture setup, never adapter use.
            adapter.step((1,5))
            core._env.game_config.physics_steps_per_frame=1
            for _ in range(int(case.split('_')[1])):core._env.step()
            core._env.game_config.physics_steps_per_frame=10
            adapter.previous=None
        initial=adapter.snapshot()
        samples=[initial]
        restart=case=='restart' or case.startswith('boundary_')
        for i in range(500 if restart else 30):
            samples.append(adapter.step((1,5) if restart else (19,19)))
        result={'samples':samples,'readbacks':adapter.readbacks}
        if case=='clock':
            core.reset()
            result['reset']=PhysicalNativeAdapter(core).snapshot()
    finally:
        core.close()
json.dump(result,sys.stdout,separators=(',',':'),allow_nan=False)
dll.close()
