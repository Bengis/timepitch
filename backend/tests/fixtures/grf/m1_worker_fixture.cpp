// SPDX-License-Identifier: Apache-2.0
// Core-free assertions. No physics, RNG or GRF linked into this executable.
#include "period_close.hpp"
#include "worker_evidence.hpp"
#include "shot_context_v2.hpp"
#include "marking_adapter.hpp"
#include <iostream>
#include <cstdlib>
using namespace timepitch_worker;
using namespace timepitch_shots;
using namespace timepitch_marking;
void Check(bool b){if(!b)std::abort();}
template<class F> void Reject(F f){bool bad=false;try{f();}catch(const std::exception&){bad=true;}Check(bad);}
struct FakeMatch{
  CloseFacts facts;int stops=0,steps=0,rng=0,setters=0;bool mutate=false;
  FakeMatch(){facts.physics_ms=2820000;facts.period=1;facts.enabled=true;facts.in_play=true;facts.signature="players/ball/score/time unchanged";}
  CloseFacts Snapshot(){return facts;}
  void StopPlay(){++stops;facts.in_play=false;if(mutate)facts.signature+="corrupt";}
};
struct FakeActor {
  int id;FakeActor* mark=nullptr;unsigned int* writes;
  int GetStableID()const{return id;}
  void SetManMarking(FakeActor* p){mark=p;++*writes;}
};
struct FakeTeam {
  unsigned int writes=0;std::vector<FakeActor> actors;
  FakeTeam(){for(int id:{0,1,2,100})actors.push_back({id,nullptr,&writes});}
  std::vector<FakeActor*> Active(){return {&actors[0],&actors[1],&actors[2]};}
  FakeActor* Resolve(int id){for(auto& a:actors)if(a.id==id)return &a;return nullptr;}
  std::vector<MarkPair> Actual(){std::vector<MarkPair> pairs;for(auto* p:Active())if(p->mark)pairs.push_back({p->id,p->mark->id});return pairs;}
};
std::string Frame(long ms,int period,long relocation){return "{\"row\":{\"physics_ms\":"+N(ms)+",\"period\":"+N(period)+",\"relocation_id\":"+N(relocation)+"}}";}
int main(int argc,char** argv){
  if(argc!=2)return 2;std::string c=argv[1];
  if(c=="future_wait"){
    Check(!WaitComplete(true,1000,2000,30000));Check(!WaitComplete(true,29990,0,30000));
    Check(WaitComplete(true,30000,0,30000));Check(WaitComplete(false,0,2000,30000));
  }else if(c=="identities"||c=="identity_duplicate"||c=="identity_team"){
    std::vector<IdentityEntry> ids;for(int s=0;s<2;++s)for(int i=0;i<11;++i)ids.push_back({s,i,10+200*s+7*i,i!=10,i==0});
    if(c=="identity_duplicate"){ids[21].id=ids[0].id;Reject([&](){ValidateIdentities(ids);});}
    else if(c=="identity_team"){ids[0].side=1;Reject([&](){ValidateIdentities(ids);});}
    else Check(ValidateIdentities(ids).size()==22);
  }else if(c=="observe"||c=="apply"||c=="illegal_pairs"||c=="counter_overflow"||c=="policy_reset"){
    WorkerCounters counts;MarkingInput in;in.time_ms=1000;in.team=0;in.period=1;in.dynamic_side=-1;in.guard_eligible=true;
    in.own_ids={0,1,2};in.threat_ids={100};in.quality={{1},{.1},{.9}};in.actual_prior_marks={{1,100}};
    for(int id:{0,1,2,100}){MarkingPlayer p;p.id=id;p.team=id==100?1:0;p.keeper=id==0;p.position={id==1?2.:id==2?7.:0.,0};in.players.push_back(p);}
    MarkingContext ctx;ctx.initialized=true;ctx.team=0;ctx.period=1;ctx.dynamic_side=-1;ctx.eligible=true;
    auto mode=c=="observe"?"observe":"apply";auto before=ctx;FakeTeam team;
    auto d=ComputeAndCommit(team,in,ctx,mode);auto actual=team.Actual();Check(team.writes==4);
    if(c=="illegal_pairs")actual={{0,100}};
    if(c=="counter_overflow")counts.ticks=WorkerCounters::limit;
    if(c=="illegal_pairs"||c=="counter_overflow")Reject([&](){counts.Record(in,before,d,actual,mode,team.writes);});
    else {counts.Record(in,before,d,actual,mode,team.writes);Check(counts.ticks==1&&counts.setters==4);Check(counts.behavioral_changes==(c=="observe"?0:1));
      if(c=="policy_reset"){counts.Reset();Check(counts.resets==1);}}
  }else if(c=="frame_cap"||c=="transaction_cap"||c=="shared_memory"){
    EpochShotContextRecorder r;r.Start("observe");r.ObserveEpoch(1,0);
    if(c=="transaction_cap")for(int i=0;i<401;++i)r.ObserveTransaction(0,1,0,"{}");
    else{
      r.OnConfirmedShot(0,0,"open_play_shot",1,0);
      for(int i=0;i<304;++i){r.ObserveEpoch(1,i);r.ObserveFrame(0,c=="shared_memory"?std::string(65000,' '):Frame(0,1,i));}
      if(c=="shared_memory"){
        // Use303 frames, then transactions to exceed the shared32MiB budget,
        // rather than a per-record or per-queue cap.
        EpochShotContextRecorder shared;shared.Start("observe");shared.ObserveEpoch(1,0);shared.OnConfirmedShot(0,0,"open_play_shot",1,0);
        for(int i=0;i<303;++i){shared.ObserveEpoch(1,i);shared.ObserveFrame(0,std::string(65000,' '));}
        for(int i=0;i<400;++i)shared.ObserveTransaction(0,1,302,std::string(65000,' '));
        Check(shared.Overflowed());
      }
    }
    Check(r.Overflowed());
  }else if(c=="epoch"||c=="six"||c=="overlap"||c=="prefix"||c=="zero"||c=="reset"||c=="overflow"||c=="same_frame"){
    EpochShotContextRecorder r;r.Start("observe");r.ObserveEpoch(1,0);
    long end=c=="six"?23000:c=="overlap"?8000:c=="prefix"?4100:5000;
    for(long ms=0;ms<=end;ms+=100){
      int period=1;long relocation=0;
      if(c=="epoch"&&ms==1000){r.ObserveFrame(ms,Frame(ms,1,0));r.ObserveEpoch(2,1);}
      if(c=="epoch"&&ms>=1000){period=2;relocation=1;}
      if(c=="reset"&&ms>=2000)relocation=1;
      r.ObserveEpoch(period,relocation);r.ObserveFrame(ms,Frame(ms,period,relocation));
      if(c=="same_frame")r.ObserveFrame(ms,Frame(ms,period,relocation));
      bool shot=(c=="six"&&ms>=3000&&ms<=23000&&(ms-3000)%4000==0)||(c=="overlap"&&ms>=3000&&ms<=3500)||
        ((c=="epoch"||c=="reset"||c=="same_frame")&&ms==3000)||(c=="prefix"&&ms==4000);
      if(c=="epoch"&&ms==1000)shot=true;
      if(shot)r.OnConfirmedShot(static_cast<unsigned int>(ms),ms,"open_play_shot",period,static_cast<int>(relocation));
    }
    if(c=="six"){r.ObserveEpoch(1,0);for(long ms=23100;ms<=24000;ms+=100)r.ObserveFrame(ms,Frame(ms,1,0));
      r.OnConfirmedShot(24000,24000,"open_play_shot",1,0);}
    if(c=="overflow")r.ObserveFrame(5100,std::string(65537,'x'));
    std::cout<<r.Finish(c!="prefix");return 0;
  }else{
    FakeMatch match;PeriodCloser close;
    if(c=="natural"||c=="halftime")match.facts.in_play=false;
    if(c=="pending")match.facts.pending_penalty=true;
    if(c=="active_goal"||c=="active_penalty")match.facts.protected_restart=true;
    if(c=="disabled")match.facts.enabled=false;
    if(c=="too_early")match.facts.physics_ms=2699900;
    if(c=="cap")match.facts.physics_ms=3720100;
    if(c=="changed_state")match.mutate=true;
    std::string reason=c=="natural"||c=="halftime"||c=="natural_in_play"?"natural_stoppage":"bounded_open_play";
    int phase=c=="wrong_phase"?2:1;long ms=match.facts.physics_ms+(c=="wrong_time"?100:0);
    if(c=="pending"||c=="active_goal"||c=="active_penalty"||c=="disabled"||c=="too_early"||c=="cap"||c=="changed_state"||c=="wrong_time"||c=="wrong_phase"||c=="natural_in_play"){
      Reject([&](){close.Close(match,phase,ms,reason);});
      if(c!="changed_state")Check(match.stops==0);
      else {Check(!close.CanBeginSecondHalf());Reject([&](){close.Close(match,1,ms,"natural_stoppage");});}
    }
    else{
      auto receipt=close.Close(match,phase,ms,reason);Check(!receipt.after.in_play&&receipt.before.signature==receipt.after.signature);
      if(c=="duplicate")Reject([&](){close.Close(match,phase,ms,reason);});
      if(c=="halftime"||c=="final"){
        Check(close.CanBeginSecondHalf());match.facts.period=2;Check(match.facts.physics_ms==ms);
        match.facts.physics_ms+=2820000;match.facts.in_play=true;
        close.Close(match,2,match.facts.physics_ms,"bounded_open_play");Check(close.Finished());}
      Check(match.steps==0&&match.rng==0&&match.setters==0);
    }
  }
  std::cout<<"{\"checked\":true}";return 0;
}
