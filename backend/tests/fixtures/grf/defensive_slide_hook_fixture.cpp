// Compile the exact patched native Sliding function with a small fake context.
// No football core; geometry/queue interfaces only, no copied proposal logic.
#include "defensive_policy.hpp"
#include <cassert>
#include <iostream>
#include <vector>
#define DO_VALIDATION
struct Vector3 {
  float coords[3];
  Vector3(float x=0,float y=0,float z=0):coords{x,y,z}{}
  Vector3 operator+(const Vector3& b)const{return {coords[0]+b.coords[0],coords[1]+b.coords[1],coords[2]+b.coords[2]};}
  Vector3 operator-(const Vector3& b)const{return {coords[0]-b.coords[0],coords[1]-b.coords[1],coords[2]-b.coords[2]};}
  Vector3 operator*(float k)const{return {coords[0]*k,coords[1]*k,coords[2]*k};}
  float GetLength()const{return std::sqrt(coords[0]*coords[0]+coords[1]*coords[1]+coords[2]*coords[2]);}
  Vector3 Get2D()const{return {coords[0],coords[1],0};}
  Vector3 GetNormalized(Vector3 fallback)const{return GetLength()>0?(*this)*(1.0f/GetLength()):fallback;}
};
enum {e_PlayerRole_GK,e_PlayerRole_DEF};
enum {e_FunctionType_Movement,e_FunctionType_Shot,e_FunctionType_Sliding};
struct Player {
  Vector3 position,movement;
  struct Formation {int role=e_PlayerRole_DEF;} formation;
  int function=e_FunctionType_Movement;bool pending=false;
  Vector3 GetPosition(){return position;}Vector3 GetMovement(){return movement;}
  Formation GetFormationEntry(){return formation;}
  int GetCurrentFunctionType(){return function;}bool TouchPending(){return pending;}
};
struct Team {int side=1,human=0;int GetDynamicSide(){return side;}int GetHumanGamerCount(){return human;}};
struct MentalImage {Vector3 ball;Vector3 GetBallPrediction(int){return ball;}};
struct Match {
  Player* retainer=nullptr;Player* designated=nullptr;MentalImage mental;
  Player* GetBallRetainer(){return retainer;}Player* GetDesignatedPossessionPlayer(){return designated;}
  MentalImage* GetMentalImage(int){return &mental;}
};
struct PlayerCommand {
  int desiredFunctionType=e_FunctionType_Movement;bool useDesiredMovement=false,useDesiredLookAt=false;
  Vector3 desiredDirection,desiredLookAt;float desiredVelocityFloat=0;
};
using PlayerCommandQueue=std::vector<PlayerCommand>;
struct FixturePolicy {
  float floor=0.70f;int calls=0;
  timepitch_policy::SlideDecision Slide(const timepitch_policy::SlideContext& c){++calls;return timepitch_policy::AreaSlideGate(c,floor);}
};
struct Env {FixturePolicy intervention_policy;} env;
Env* GetGame(){return &env;}
const float pitchHalfW=52.5f,sprintVelocity=7.0f;
struct PlayerController {
  Team* team;Match* match;Player* player;Player* _oppPlayer;
  bool teamHasBestPossession=false,oppTeamHasPossession=true;
  float possessionAmount=0.5f,duel=0.704118669f;int duel_calls=0,oppTimeNeededToGetToBall=300;
  Player* CastPlayer(){return player;}
  float CouldWinABallDuelLikeliness(){++duel_calls;return duel;}
  void _SlidingCommand(PlayerCommandQueue& commandQueue);
};

// NATIVE_SLIDE_FUNCTION

int main() {
  for(int side:{-1,1})for(int route:{1,2})for(float floor:{0.70f,0.90f}) {
    Team t;t.side=side;Match m;Player p,op;
    p.position={40.0f*side,0,0};m.mental.ball={41.0f*side,0,0};
    op.function=e_FunctionType_Shot;op.pending=true;
    PlayerController c{&t,&m,&p,&op};
    if(route==2)c.oppTimeNeededToGetToBall=200;
    env.intervention_policy={floor,0};
    PlayerCommandQueue queue;PlayerCommand before;before.desiredFunctionType=e_FunctionType_Shot;queue.push_back(before);
    c._SlidingCommand(queue);
    PlayerCommand fallback;fallback.desiredFunctionType=e_FunctionType_Movement;queue.push_back(fallback);
    assert(c.duel_calls==1 && env.intervention_policy.calls==1);
    assert(queue.front().desiredFunctionType==e_FunctionType_Shot && queue.back().desiredFunctionType==e_FunctionType_Movement);
    assert(queue.size()==(floor==0.70f?3:2));
    if(floor==0.70f)assert(queue[1].desiredFunctionType==e_FunctionType_Sliding);
    // The old duel gate prevents the new helper from running at all.
    c.duel=0.69f;env.intervention_policy.calls=0;queue.clear();c._SlidingCommand(queue);
    assert(queue.empty() && env.intervention_policy.calls==0);
  }
  std::cout<<"PASS\n";
}
