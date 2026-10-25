"""Real GRF contact/referee fixtures. Python 3.10 standalone entry point.

Referee scenarios are the installed upstream Apache-2.0 tests, exercised
with the same actions as gfootball/env/football_env_test.py.
"""
import json
import os
from pathlib import Path
import sys
import types
from contextlib import redirect_stdout

native=Path(sys.argv[1]).resolve();case=sys.argv[2];capacity=int(sys.argv[3])
sys.path.insert(0,str(native));dll=os.add_dll_directory(str(native))
assets=Path(sys.executable).parent/'Lib/site-packages/gfootball_engine'
os.environ['GFOOTBALL_DATA_DIR']=str(assets/'data')
os.environ['GFOOTBALL_FONT']=str(assets/'fonts/AlegreyaSansSC-ExtraBold.ttf')
with redirect_stdout(sys.stderr):
    from gfootball.env import config,football_env_core
    from gfootball.env.scenario_builder import Team,Role
    official={'corner':'corner_test','penalty':'penalty','offside':'offside_test'}
    level='11_vs_11_stochastic' if case=='match' else 'tests.'+official[case] if case in official else 'timepitch_stats_fixture'
    def build(builder):
        cfg=builder.config();cfg.game_duration=1000 if case=='advantage' else 300;
        if case=='halves':cfg.second_half=50
        cfg.deterministic=True;cfg.offsides=False
        x=.75 if case in ('shot','goal') else -.75 if case=='own_goal' else -.02 if case=='advantage' else -.09 if case=='foul' else 0
        builder.SetBallPosition(x+(-.02 if case=='own_goal' else .02),0)
        builder.SetTeam(Team.e_Left)
        builder.AddPlayer(-1,.3,Role.e_PlayerRole_GK)
        builder.AddPlayer(x,0,Role.e_PlayerRole_CF)
        builder.AddPlayer(x+.18,.02,Role.e_PlayerRole_CM)
        builder.SetTeam(Team.e_Right);builder.AddPlayer(-1,.3,Role.e_PlayerRole_GK)
        if case in ('foul','advantage'):
            builder.SetBallPosition(-.12,0);builder.AddPlayer(.10,0,Role.e_PlayerRole_CM)
        if case=='shot_without_ball':builder.SetBallPosition(.6,.3)
    if case in official:
        from importlib import import_module
        original=import_module('gfootball.scenarios.'+level).build_scenario
        def extended(builder):
            original(builder);builder.config().game_duration=200
        module=types.ModuleType('gfootball.scenarios.timepitch_stats_official');module.build_scenario=extended
        sys.modules[module.__name__]=module;level='timepitch_stats_official'
    if case not in official and case!='match':
        module=types.ModuleType('gfootball.scenarios.timepitch_stats_fixture');module.build_scenario=build
        sys.modules[module.__name__]=module
    players='agent:right_players=1' if case=='offside' else 'agent:left_players=1' if case=='penalty' else 'agent:left_players=1,right_players=1'
    core=football_env_core.FootballEnvCore(config.Config({'level':level,'players':[players],
        'action_set':'full' if case=='advantage' else 'v2','game_engine_random_seed':42,'reverse_team_processing':False,'episode_number':0,
        'physics_steps_per_frame':10,'dump_full_episodes':False,'dump_scores':False,'write_video':False}))
    try:
        engine=core._env
        if case!='disabled':engine.probe_enable_stats(capacity)
        initial=core.observation();initial_info={k:(v.tolist() if hasattr(v,'tolist') else v) for k,v in initial.items() if k in ('ball','left_team','right_team','left_agent_controlled_player','right_agent_controlled_player')}
        events=[];done=False;last={}
        for step in range(3001 if case=='match' else 1000 if case=='advantage' else 300):
            if case=='match':actions=[19,19]
            elif case=='foul':actions=[16,0]
            elif case=='advantage':actions=[0 if step<10 else 21,0]
            elif case=='offside':actions=[9 if step==0 else 0]
            elif case=='penalty':actions=[16]
            elif case=='corner':actions=[1,5]
            elif case=='goal':actions=[12 if step<20 else 0,0]
            elif case=='own_goal':actions=[1,0]
            elif case in ('shot','shot_without_ball'):actions=[12 if step<20 else 0,0]
            else:actions=[5 if step<3 else 11 if step==3 else 19,0]
            _,_,done,_=core.step(actions)
            if case=='advantage':engine.probe_test_standing_trip(0,1,1,1)
            last=dict(engine.probe_drain_stats());events.extend(last['events'])
            if done:break
        score=core.observation()['score']
        last['events']=events;last['score']=score;last['initial']=initial_info;last['final_ball']=core.observation()['ball'].tolist()
        last['actor_shot_contacts']=sum(e['type']=='touch' and e['kind']=='shot' and e['team']==0 and e['player']==1 for e in events)
    finally:core.close()
json.dump(last,sys.stdout,separators=(',',':'),allow_nan=False)
dll.close()
