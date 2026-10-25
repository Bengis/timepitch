"""Native-cache dictionaries with distinct proposal, selection and sample frames."""
import copy
import random

VALUES=('static_role dynamic_role mindset mirrored dynamic_side in_play set_piece mental_image_age_ms '
    'team_best_possession team_possession opponent_possession possession_amount team_possession_amount fading_possession '
    'marker_target_team marker_target_slot designated_team designated_slot team_designated_team team_designated_slot '
    'opponent_designated_team opponent_designated_slot marking_bias marking_reaction_ms marking_opponent_team marking_opponent_slot '
    'hunt_threshold hunt_distance hunt_close hunt_guard_allows closest_0_team closest_0_slot closest_1_team closest_1_slot '
    'slide_duel_likelihood slide_ball_distance slide_opponent_time_ms slide_first_route slide_second_evaluated slide_second_route '
    'force_magnet extra_haste requested_speed queue_size queue_movement_speed').split()
VECTORS=('marking_before marking_defend marking_after marking_opponent_prediction hunt_target '
    'slide_player_prediction slide_ball_prediction slide_opponent_prediction requested_direction queue_movement_direction strategy_target').split()


def fields():return dict(values={},vectors={},status={},overflowed=False)


def selection():
    return dict(available=False,physics_ms=None,function=None,found=None,animation_before=None,animation_after=None,evaluation_sequence=None)


def records(t=100,*,full=False,seed=1):
    rng=random.Random(seed);result=[]
    for i in range(22):
        f=fields()
        f['status']=dict(strategy='defense',marking='ineligible',hunt='guard_rejected',slide='gated')
        f['values']={'mirrored':0.,'marking_bias':.125}
        if full:
            f['values']={k:rng.uniform(-1e6,1e6) for k in VALUES}
            f['vectors']={k:[rng.uniform(-1e6,1e6) for _ in range(3)] for k in VECTORS}
        proposal=copy.deepcopy(f);proposal['values']['mirrored']=1.
        if full:
            proposal['values']={k:rng.uniform(-1e6,1e6) for k in VALUES}
            proposal['vectors']={k:[rng.uniform(-1e6,1e6) for _ in range(3)] for k in VECTORS}
        proposal['status']['slide']='proposed'
        result.append(dict(team=i//11,slot=i%11,active=True,availability_reason='cached_evaluation',
            evaluation_available=True,evaluation_complete=True,evaluation_ms=t-10,evaluation_sequence=3,
            fields=f,last_attempt=selection(),last_selected=selection(),slide_attempt=dict(available=True,
                physics_ms=t-5,function=13,found=False,animation_before=4,animation_after=4,evaluation_sequence=3),
            slide_selected=selection(),slide_proposal=dict(available=True,physics_ms=t-10,evaluation_sequence=3,fields=proposal),
            current_function=3,current_animation=7,current_mirrored=False,
            current_position=[float(i),1.,0.],current_movement=[1.,2.,0.]))
        if full:
            r=result[-1]
            r['current_position']=[rng.uniform(-100,100) for _ in range(3)]
            r['current_movement']=[rng.uniform(-15,15) for _ in range(3)]
            for key in ('last_attempt','last_selected','slide_attempt','slide_selected'):
                r[key]=dict(available=True,physics_ms=t-2,function=13 if key.startswith('slide') else 3,
                    found=True,animation_before=t//100+i,animation_after=t//100+i+1,evaluation_sequence=3)
    return result
