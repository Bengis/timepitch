"""Short, controlled physical-period fixtures using the actual native core."""
import json
import os
from pathlib import Path
import sys
import types
from contextlib import redirect_stdout

native=Path(sys.argv[1]).resolve();case=sys.argv[2]
sys.path.insert(0,str(native));sys.path.insert(0,str(Path(__file__).resolve().parents[3]/'src/timepitch/grf'))
dll=os.add_dll_directory(str(native))
assets=Path(sys.executable).parent/'Lib/site-packages/gfootball_engine'
os.environ['GFOOTBALL_DATA_DIR']=str(assets/'data');os.environ['GFOOTBALL_FONT']=str(assets/'fonts/AlegreyaSansSC-ExtraBold.ttf')
with redirect_stdout(sys.stderr):
    from gfootball.env import config,football_env_core
    from gfootball.env.scenario_builder import Team,Role
    from physical_native import PhysicalNativeAdapter
    def build(builder):
        cfg=builder.config();cfg.game_duration=75000;cfg.second_half=75000;cfg.deterministic=True;cfg.offsides=False
        builder.SetBallPosition(.77,0)
        builder.SetTeam(Team.e_Left);builder.AddPlayer(-1,.3,Role.e_PlayerRole_GK);builder.AddPlayer(.75,0,Role.e_PlayerRole_CF)
        builder.SetTeam(Team.e_Right);builder.AddPlayer(-1,.3,Role.e_PlayerRole_GK)
    module=types.ModuleType('gfootball.scenarios.timepitch_physical_fixture');module.build_scenario=build
    sys.modules[module.__name__]=module
    level='tests.corner_test' if case=='corner' else 'tests.penalty' if case=='penalty' else 'timepitch_physical_fixture'
    core=football_env_core.FootballEnvCore(config.Config({'level':level,
        'players':['agent:left_players=1'] if case=='penalty' else ['agent:left_players=1,right_players=1'],
        'action_set':'v2','game_engine_random_seed':42,'reverse_team_processing':False,'physics_steps_per_frame':10,
        'dump_full_episodes':False,'dump_scores':False,'write_video':False}))
    try:
        assert hasattr(core._env,'probe_enable_periods'), 'Missing native physical period API'
        core._env.probe_enable_periods()
        adapter=PhysicalNativeAdapter(core);samples=[adapter.snapshot()]
        for i in range(100 if case=='clock' else 650):
            actions=(1,5) if case=='corner' else (16,) if case=='penalty' else (12 if i<20 else 0,0) if case=='goal' else (19,19)
            samples.append(adapter.step(actions))
            current=samples[-1]
            wait={'corner':15000,'goal':30000,'penalty':45000}.get(case)
            if (wait and current['restart_cause']==case and current['restart_active'] and
                current['physics_ms']-current['restart_start_ms']>=wait-100 and not current['in_play']):break
        data={'samples':samples,'duration_factor':samples[-1]['duration_factor'],
              'fatigue':[samples[-1]['home_fatigue'][i] for i in range(len(samples[-1]['home_xy']))]}
        if case!='clock':
            # Stop at an actual dead-ball observation; the API must preserve score/time.
            while samples[-1]['in_play'] and len(samples)<1500:samples.append(adapter.step(actions))
            if samples[-1]['in_play']:
                print([(s['physics_ms'],s['restart_cause'],s['restart_active'],s['restart_start_ms'],s['in_play'])
                    for s in samples[::50]],file=sys.stderr)
            assert not samples[-1]['in_play'],'Fixture did not find a safe transition'
            core._env.probe_begin_second_half();data['halftime']=adapter.snapshot()
    finally:core.close()
json.dump(data,sys.stdout,separators=(',',':'),allow_nan=False)
dll.close()
