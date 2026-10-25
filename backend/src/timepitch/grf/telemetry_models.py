"""Native telemetry primitives, independent of the replay model hierarchy."""
from typing import Annotated,Literal
from pydantic import BaseModel,ConfigDict,Field

Finite=Annotated[float,Field(ge=-25,le=25,allow_inf_nan=False)]
Index=Annotated[int,Field(ge=0,le=19999,strict=True)]
Team=Literal[-1,0,1]
Direction=tuple[Literal[-1,1],Literal[-1,1]]


class GrfNativeEvent(BaseModel):
    model_config=ConfigDict(extra='forbid',allow_inf_nan=False)
    seq:Index
    sample_index:int=Field(ge=1,le=4301,strict=True)
    type:Literal['touch','goal','decision']
    kind:Literal['other','short_pass','long_pass','high_pass','shot','trap','ball_control','deflect',
                 'goal','foul','offside','normal','kickoff','goal_kick','free_kick','corner','throw_in','penalty']
    stage:Literal['','accepted','sanctioned','advantage_played','prepared','awarded']
    team:Literal[0,1]
    actor_team:Team
    player:int=Field(ge=-1,le=10,strict=True)
    victim_team:Team
    victim_player:int=Field(ge=-1,le=10,strict=True)
    action_id:int=Field(ge=0,le=1000000,strict=True)
    incident_id:int=Field(ge=0,le=20000,strict=True)
    function:int=Field(ge=-1,le=100,strict=True)
    touch_type:int=Field(ge=-1,le=3,strict=True)
    actual_time_ms:int=Field(ge=0,le=5000000,strict=True)
    match_time_ms:int=Field(ge=0,lt=5760000,strict=True)
    phase:Literal[1,2]
    in_play:bool
    set_piece:bool
    own_goal:bool
    mirrored:bool
    ball_mirrored:bool
    actor_xy:tuple[Finite,Finite]
    ball_xyz:tuple[Finite,Finite,Finite]
    raw_actor_xy:tuple[Finite,Finite]
    raw_ball_xyz:tuple[Finite,Finite,Finite]
    score:tuple[Annotated[int,Field(ge=0,le=100,strict=True)],Annotated[int,Field(ge=0,le=100,strict=True)]]
    attack_direction:Direction


class GrfTelemetry(BaseModel):
    model_config=ConfigDict(extra='forbid',allow_inf_nan=False)
    version:Literal['grf-native-events-1']='grf-native-events-1'
    events:list[GrfNativeEvent]=Field(max_length=20000)
    emitted_count:int=Field(ge=0,le=20000,strict=True)
    overflowed:Literal[False]=False
