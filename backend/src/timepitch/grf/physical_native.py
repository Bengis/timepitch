"""Portable fixed-step adapter for the isolated native physics capability.

No server imports: this module also runs in the pinned Python 3.10 runtime.
It does not change the installed GRF wrapper or admit a new product replay.
"""
import math


def physical_sample(state,observation,index,clock,causes):
    """Shared lossless native-metres row construction for both physical workers."""
    row=[index,clock.physics_ms,clock.period,clock.period_elapsed_ms,clock.effective_ms,int(state['in_play']),
        int(state['set_piece']),int(state['discontinuity']),state['restart_id'],int(state['restart_active']),
        causes.index(state['restart_cause']),state['restart_start_ms'],int(state['pending_penalty']),
        int(observation['ball_owned_team']),int(observation['ball_owned_player']),*state['score'],
        *state['attack_direction'],state['relocation_id'],int(state['game_mode'])]
    for side,key in (('home','left_team'),('away','right_team')):
        for slot in range(11):
            x,y=observation[key][slot];vx,vy=observation[key+'_direction'][slot]
            # defines.hpp scales and SharedInfo's ten-tick movement normalization.
            row.extend([float(x)*54.4,float(y)*-83.6,float(vx)*544,float(vy)*-836,
                int(state[side+'_active'][slot]),float(state[side+'_fatigue'][slot])])
    x,y,z=state['ball_xyz'];row.extend([x*54.4,y*-83.6,z])
    return [float(value) for value in row]


class PhysicalNativeAdapter:
    def __init__(self, core, *, players=None):
        self.core=core
        self.engine=core._env
        if not all(hasattr(self.engine,name) for name in ('probe_physical_state','probe_step_physical')):
            raise ValueError('Native fixed-step capability unavailable')
        self.readbacks=[]
        if players is not None:
            expected={(side,slot) for side in ('home','away') for slot in range(11)}
            if len(players)!=22 or {(p['side'],p['slot']) for p in players}!=expected:
                raise ValueError('Expected 22 side-scoped players')
            for p in players:
                if set(p['attributes'])!={'physical_velocity','technical_shot','technical_shortpass'}:
                    raise ValueError('Expected three attributes per player')
                for name,value in p['attributes'].items():
                    read=dict(self.engine.probe_get_stat(0 if p['side']=='home' else 1,p['slot'],name))
                    if not math.isfinite(value) or not 0<=value<=1 or abs(read['base']-value)>1e-5:
                        raise ValueError('Native attribute readback mismatch')
                    self.readbacks.append(dict(side=p['side'],slot=p['slot'],attribute=name,**read))
        self.previous=None

    def snapshot(self):
        state=dict(self.engine.probe_physical_state())
        # This method updates the observation even when its return value is False.
        # Unlike FootballEnvCore.step(), it does not loop until play resumes.
        self.core._retrieve_observation()
        observation=self.core.observation()
        state.update(home_xy=observation['left_team'].tolist(),away_xy=observation['right_team'].tolist(),
                     ball_xyz=observation['ball'].tolist(),score=observation['score'],
                     game_mode=observation['game_mode'])
        before=self.previous
        state['segment_eligible']=bool(before is not None and
            state['physics_ms']-before['physics_ms']==100 and
            state['effective_ms']-before['effective_ms']==100 and
            state['phase']==before['phase'] and state['relocation_id']==before['relocation_id'] and
            not state['discontinuity'] and state['in_play'] and before['in_play'] and
            not state['set_piece'] and not before['set_piece'])
        self.previous=state
        return state

    def step(self, actions=(19,19)):
        from gfootball.env import football_action_set
        values=[int(football_action_set.named_action_from_action_set(self.core._action_set,a)._backend_action)
                for a in actions]
        self.engine.probe_step_physical(values)
        return self.snapshot()
