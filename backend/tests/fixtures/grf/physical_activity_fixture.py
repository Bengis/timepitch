"""Native policy and short real-player trace, in portable Python 3.10."""
import json,os,sys
from pathlib import Path
from contextlib import redirect_stdout
native=Path(sys.argv[1]).resolve();sys.path.insert(0,str(native));sys.path.insert(0,str(Path(__file__).resolve().parents[3]/'src/timepitch/grf'))
dll=os.add_dll_directory(str(native));assets=Path(sys.executable).parent/'Lib/site-packages/gfootball_engine'
os.environ['GFOOTBALL_DATA_DIR']=str(assets/'data');os.environ['GFOOTBALL_FONT']=str(assets/'fonts/AlegreyaSansSC-ExtraBold.ttf')
with redirect_stdout(sys.stderr):
    from gfootball.env import config,football_env_core
    from physical_native import PhysicalNativeAdapter
    core=football_env_core.FootballEnvCore(config.Config({'level':'11_vs_11_stochastic',
        'players':['agent:left_players=1,right_players=1'],'action_set':'v2','game_engine_random_seed':42,
        'reverse_team_processing':False,'physics_steps_per_frame':10,'dump_full_episodes':False,'dump_scores':False,'write_video':False}))
    try:
        assert hasattr(core._env,'probe_test_activity_sequence'),'Missing native activity policy'
        frames=[dict(ms=ms,target=target,ball=30,urgent=urgent,eligible=True,velocity=6.)
            for ms,target,urgent in [(0,1,False),(900,1,False),(1000,1,False),(1100,5,False),(1200,1,True),(1300,1,False)]]
        frames.extend([dict(ms=2300,target=1,ball=10,urgent=False,eligible=True,velocity=6.),
                       dict(ms=3300,target=1,ball=30,urgent=False,eligible=False,velocity=6.)])
        decisions=list(core._env.probe_test_activity_sequence(frames))
        before=dict(core._env.probe_physical_state())
        unchanged=not before['activity_enabled']
        core._env.probe_enable_periods();core._env.probe_enable_activity(2.,2.2,15.,1000)
        adapter=PhysicalNativeAdapter(core);observed=False
        for i in range(150):
            state=adapter.step();observed=observed or any(x in (1,2) for x in state['home_activity']+state['away_activity'])
            assert all(0<v<=1 for v in state['home_fatigue']+state['away_fatigue'])
        fatigue_decreased=min(state['home_fatigue']+state['away_fatigue'])<1
    finally:core.close()
json.dump(dict(decisions=decisions,unchanged_compressed=unchanged,observed_activity=observed,fatigue_decreased=fatigue_decreased),sys.stdout)
