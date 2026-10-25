"""Portable catalogue-to-native setup shared by both versioned runners."""
import sys
import types


def create_core(payload,*,timings=None):
    start=timings.start() if timings is not None else 0
    from gfootball.env import config,football_env_core
    from gfootball.env.scenario_builder import Team,Role
    if timings is not None:timings.stop('grf_imports',start)
    start=timings.start() if timings is not None else 0
    def build(builder):
        settings=payload['settings'];cfg=builder.config()
        cfg.game_duration=settings.get('game_duration',75000);cfg.deterministic=False
        if 'second_half' in settings:cfg.second_half=settings['second_half']
        cfg.left_team_difficulty=settings['left_team_difficulty']
        cfg.right_team_difficulty=settings['right_team_difficulty']
        cfg.offsides=True;builder.SetBallPosition(0,0)
        for side in ('home','away'):
            players=[p for p in payload['players'] if p['side']==side]
            builder.SetTeam(Team.e_Left if side=='home' else Team.e_Right)
            counts={role:sum(p['role']==role for p in players) for role in ('GK','DEF','MID','FWD')}
            slots=dict.fromkeys(counts,0)
            for p in players:
                role=p['role'];slot=slots[role];slots[role]+=1
                x={'GK':-.96,'DEF':-.5,'MID':-.22,'FWD':-.04}[role]
                y=0 if counts[role]==1 else -.25+.5*slot/(counts[role]-1)
                if role=='FWD':y=(slot-(counts[role]-1)/2)*.06
                if side=='home' and role=='FWD' and slot==0:x,y=0,-.02
                builder.AddPlayer(x,y,getattr(Role,'e_PlayerRole_'+p['native_role']))
    module=types.ModuleType('gfootball.scenarios.timepitch_experimental')
    module.build_scenario=build;sys.modules[module.__name__]=module
    cfg=config.Config({'level':'timepitch_experimental','players':['agent:left_players=1,right_players=1'],
        'action_set':'v2','game_engine_random_seed':payload['config']['seed'],'reverse_team_processing':False,
        'physics_steps_per_frame':10,'dump_full_episodes':False,'dump_scores':False,'write_video':False})
    if timings is not None:
        timings.stop('scenario_config',start)
        return timings.call('environment_init',football_env_core.FootballEnvCore,cfg)
    core=football_env_core.FootballEnvCore(cfg)
    return core
