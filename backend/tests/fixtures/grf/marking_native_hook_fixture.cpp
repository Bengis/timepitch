// SPDX-License-Identifier: Apache-2.0
// Standalone fake native actors; no engine creation, RNG or simulated match.
#include "marking_adapter.hpp"
#include "shot_context_runtime.hpp"
#include <iostream>
#include <cstdlib>

using namespace timepitch_marking;
using namespace timepitch_shots;
struct Actor {int id;Actor* mark=nullptr;int* writes;std::vector<MarkPair>* trace;int GetStableID()const{return id;}
  void SetManMarking(Actor* p){mark=p;++*writes;trace->push_back({id,p?p->id:-1});}};
struct Team {
  int writes=0;std::vector<Actor> actors;bool unresolved=false;std::vector<MarkPair> trace;
  Team(){for(int id:{0,1,2,100})actors.push_back({id,nullptr,&writes,&trace});}
  std::vector<Actor*> Active(){return {&actors[0],&actors[1],&actors[2]};}
  Actor* Resolve(int id){if(unresolved&&id==100)return nullptr;for(auto& a:actors)if(a.id==id)return &a;return nullptr;}
};
MarkingInput Input(){
  MarkingInput in;in.time_ms=1000;in.team=0;in.period=1;in.dynamic_side=-1;in.guard_eligible=true;
  in.own_ids={0,1,2};in.threat_ids={100};in.quality={{1},{.1},{.9}};in.actual_prior_marks={{1,100}};
  for(int id:{0,1,2,100}) {MarkingPlayer p;p.id=id;p.team=id==100?1:0;p.keeper=id==0;
    p.position={id==1?2.:id==2?7.:0.,0};in.players.push_back(p);}return in;
}
std::string Frame(long ms,int relocation,const ShotContextRecorder& r){
  return "{\"row\":{\"physics_ms\":"+N(ms)+",\"period\":1,\"relocation_id\":"+N(relocation)+
    ",\"attack_direction\":[1,-1],\"players\":[{\"id\":1,\"team\":0,\"position\":[2,0],\"velocity\":[0,0],\"active\":true}]},"
    "\"marks\":[[],[]],\"contexts\":[null,null],\"designated\":[1,-1,-1],\"lineage\":"+r.Lineages()+"}";
}
int main(int argc,char** argv){
  if(argc!=2)return 2;std::string mode=argv[1];
  if(mode=="apply"||mode=="off"||mode=="ineligible"||mode=="reset"||mode=="mirror"||mode=="observe"||mode=="invalid"||mode=="unresolved"||mode=="unresolved_later"||mode=="tie"||mode=="period_reset"||mode=="side_reset"||mode=="manual"||mode=="contest"){
    Team team;auto in=Input();MarkingContext context;context.initialized=true;context.team=0;context.period=1;
    context.dynamic_side=-1;context.eligible=true;
    if(mode=="ineligible")in.guard_eligible=false;
    if(mode=="reset")in.relocation_id=1;
    if(mode=="period_reset")in.period=2;
    if(mode=="side_reset")in.dynamic_side=1;
    if(mode=="manual")in.players[1].manual=true;
    if(mode=="contest")in.players[2].ball_contest=true;
    if(mode=="mirror"){in.dynamic_side=context.dynamic_side=1;for(auto& p:in.players){p.position.x=-p.position.x;p.position.y=-p.position.y;}}
    if(mode=="invalid")in.players[0].id=1;
    if(mode=="unresolved")team.unresolved=true;
    if(mode=="unresolved_later"){
      MarkingPlayer p;p.id=101;p.team=1;p.position={10,0};in.players.push_back(p);in.threat_ids.push_back(101);
      for(auto& q:in.quality)q.push_back(.5);
    }
    if(mode=="tie"){in.guard_eligible=false;in.quality[1][0]=in.quality[2][0]=.9;}
    auto d=ComputeAndCommit(team,in,context,mode=="off"?"off":mode=="observe"?"observe":"apply");
    int owner=-1;for(auto& p:team.actors)if(p.mark)owner=p.id;
    std::cout<<"{\"owner\":"<<owner<<",\"actual_owner\":"<<owner<<",\"hypothetical_owner\":"<<(d.pairs.empty()?-1:d.pairs[0].owner)
      <<",\"setters\":"<<team.writes<<",\"setter_trace\":"<<Pairs(team.trace)<<"}";return 0;
  }
  ShotContextRecorder r;r.Start("observe");
  if(mode=="epoch"){
    r.ObserveEpoch(1,0);r.Begin(1,0,1);r.Queue(1,{{1,{1,0},7}});r.Selected(1,0,0,1,2,true);
    r.ObserveEpoch(2,1);std::cout<<"{\"lineage\":"<<r.Lineages()<<"}";return 0;
  }
  if(mode=="duplicate"){r.OnConfirmedShot(10,2000,"open_play_shot",1,0);r.OnConfirmedShot(10,2000,"open_play_shot",1,0);}
  else if(mode=="tx_cap"){for(int i=0;i<401;++i)r.ObserveTransaction(0,"{}");}
  else if(mode=="record_cap"){r.ObserveFrame(0,std::string(65537,'x'));}
  else if(mode=="frame_order"){r.ObserveFrame(0,"{}");r.ObserveFrame(0,"{}");}
  else {
    long end=mode=="prefix"?2200:mode=="six"?24000:4000;
    if(mode=="lineage"||mode=="lineage_trap"){
      r.Begin(1,0,1);r.Strategy(1,{1,0},7,"not_closest");
      r.HuntInput(1,false,false,false,100,8,12);
      r.Queue(1,{{mode=="lineage_trap"?3:4,{0,1},4},{1,{1,0},7}});r.Selected(1,0,0,1,2,true);
    }
    for(long ms=0;ms<=end;ms+=100){
      if(mode=="six")for(int i=0;i<7;++i)if(ms==2100+i*3500)r.OnConfirmedShot(10*(i+1),ms-50,"open_play_shot",1,0);
      if(mode!="six"&&mode!="zero"&&ms==2100)r.OnConfirmedShot(10,2050,"open_play_shot",1,0);
      if(mode=="overlap"&&ms==2600)r.OnConfirmedShot(20,2550,"open_play_shot",1,0);
      if(mode=="transaction"&&ms==2100)r.ObserveTransaction(2050,R"({"physics_ms":2050,"team":0,"mirror_sign":1,"period":1,"relocation_id":0,
        "input":{"time_ms":2050,"team":0,"period":1,"relocation_id":0,"dynamic_side":-1,"guard_eligible":true,
        "own_ids":[0,1,2],"players":[
        {"id":0,"team":0,"active":true,"keeper":true,"manual":false,"ball_contest":false,"position":[-50,0]},
        {"id":1,"team":0,"active":true,"keeper":false,"manual":false,"ball_contest":false,"position":[2,0]},
        {"id":2,"team":0,"active":true,"keeper":false,"manual":false,"ball_contest":false,"position":[7,0]},
        {"id":100,"team":1,"active":true,"keeper":false,"manual":false,"ball_contest":false,"position":[0,0]},
        {"id":101,"team":1,"active":true,"keeper":false,"manual":false,"ball_contest":false,"position":[10,0]}],
        "threat_ids":[101,100],"quality":[[1,1],[0.1,0.1],[0.9,0.9]],"actual_prior_marks":[[1,100]]},
        "context":{"initialized":false,"team":-1,"period":0,"relocation_id":0,"dynamic_side":0,"eligible":false},
        "reference_pairs":[[2,101],[1,100]],"pairs":[[2,101],[1,100]],"actual_pairs":[[1,100],[2,101]],
        "reasons":[{"rank":0,"target":101,"native_owner":2,"reference_owner":2,"previous_owner":-1,"code":"cold_start","previous_distance_m":null,"native_distance_m":null},
        {"rank":1,"target":100,"native_owner":1,"reference_owner":1,"previous_owner":1,"code":"cold_start","previous_distance_m":2,"native_distance_m":2}]})");
      // Wrong semantic origin, regardless of outcome, never triggers a context.
      r.OnConfirmedShot(99999,ms,"shot_intent",1,0);
      r.ObserveFrame(ms,Frame(ms,mode=="gap"&&ms>=2200?1:0,r));
    }
  }
  std::cout<<r.Finish(mode!="prefix");return 0;
}
