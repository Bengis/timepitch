// Pure C++ policy regression: no engine, graphics, Python or football core.
#include "defensive_policy.hpp"
#include <cassert>
#include <cstring>
#include <iostream>
#include <limits>
#include <string>
using namespace timepitch_policy;

void marking() {
  MarkingContext c{true,false,false,true,false,30.0f,0.40f}; auto d=StrongerMarking(c);
  assert(d.valid && d.raised && d.bias==0.85f);
  c.opponent_to_goal_m=std::nextafter(30.0f,std::numeric_limits<float>::infinity());
  d=StrongerMarking(c);assert(d.valid && !d.raised && d.bias==0.40f);
  c.opponent_to_goal_m=30.0f;
  for(int flag=0;flag<5;++flag) {
    auto x=c;
    if(flag==0)x.in_play=false;if(flag==1)x.set_piece=true;if(flag==2)x.is_goalkeeper=true;
    if(flag==3)x.has_active_marker=false;if(flag==4)x.team_best_possession=true;
    d=StrongerMarking(x);assert(d.valid && !d.raised && d.bias==0.40f);
  }
  c.original_bias=0.96f;d=StrongerMarking(c);assert(d.valid && !d.raised && d.bias==0.96f);
  for(float side:{-1.0f,1.0f}) {
    // Mirroring all native coordinates preserves the existing 3D distance.
    float dx=52.5f*side-30.0f*side, y=18.0f, z=0.8f;
    c.opponent_to_goal_m=std::sqrt(dx*dx+y*y+z*z);c.original_bias=0.4f;
    d=StrongerMarking(c);assert(d.valid && d.raised && d.bias==0.85f);
  }
}

void slide() {
  for(float side:{-1.0f,1.0f}) {
    SlideContext c{false,36.0f*side,20.15f,side,52.5f,0.704118669f};
    auto d=AreaSlideGate(c,0.70f);assert(d.valid && d.allow && !d.tightened);
    d=AreaSlideGate(c,0.90f);assert(d.valid && !d.allow && d.tightened);
    c.duel_score=0.90f;d=AreaSlideGate(c,0.90f);assert(d.valid && d.allow && d.tightened);
    c.duel_score=std::nextafter(0.90f,0.0f);assert(!AreaSlideGate(c,0.90f).allow);
    c.predicted_player_y=-20.15f;assert(!AreaSlideGate(c,0.90f).allow);
    c.predicted_player_y=std::nextafter(20.15f,30.0f);d=AreaSlideGate(c,0.90f);assert(d.valid && d.allow && !d.tightened);
    c.predicted_player_y=0;c.predicted_player_x=std::nextafter(36.0f,0.0f)*side;
    assert(AreaSlideGate(c,0.90f).allow);
    c.predicted_player_x=40.0f*side;c.is_goalkeeper=true;
    d=AreaSlideGate(c,0.90f);assert(d.valid && d.allow && !d.tightened);
  }
  // First original proposal route from TP041; rejecting it leaves caller fallbacks intact.
  bool route=(1.0f>0.7f && 1.0f<1.6f && 300>260);assert(route);
  std::string queue="interfere;";
  if(route && AreaSlideGate({false,40,0,1,52.5f,0.704118669f},0.9f).allow)queue+="slide;";
  queue+="movement;look;";assert(queue=="interfere;movement;look;");
}

void invalid() {
  const float nan=std::numeric_limits<float>::quiet_NaN(), inf=std::numeric_limits<float>::infinity();
  MarkingContext c{true,false,false,true,false,30,0.4f};
  for(float bad:{nan,inf,-1.0f}){auto x=c;x.opponent_to_goal_m=bad;assert(!StrongerMarking(x).valid);}
  for(float bad:{nan,inf,-0.01f,1.01f}){auto x=c;x.original_bias=bad;assert(!StrongerMarking(x).valid);}
  SlideContext s{false,40,0,1,52.5f,0.8f};
  for(float bad:{nan,inf,0.0f,0.5f,-2.0f}){auto x=s;x.dynamic_side=bad;assert(!AreaSlideGate(x,0.9f).valid);}
  for(float bad:{nan,inf,-0.1f,1.1f}){auto x=s;x.duel_score=bad;assert(!AreaSlideGate(x,0.9f).valid);}
  for(float bad:{nan,inf}){auto x=s;x.predicted_player_x=bad;assert(!AreaSlideGate(x,0.9f).valid);x=s;x.predicted_player_y=bad;assert(!AreaSlideGate(x,0.9f).valid);}
  for(float bad:{nan,inf,0.0f,-1.0f,16.0f}){auto x=s;x.pitch_half_width=bad;assert(!AreaSlideGate(x,0.9f).valid);}
  for(float bad:{nan,inf,-0.1f,1.1f})assert(!AreaSlideGate(s,bad).valid);
}

void counters() {
  PolicyState state;
  auto z=state.Snapshot();assert(z.marking_eligible==0 && z.marking_raised==0 && z.area_slide_eligible==0 && z.area_slide_rejected==0 && z.invalid_inputs==0);
  state.Marking({true,false,false,true,false,30,0.4f});
  state.Marking({true,false,false,true,false,30,0.96f});
  state.Marking({true,false,false,true,true,30,0.4f});
  state.Marking({true,false,false,true,false,-1,0.4f});
  state.Slide({false,40,0,1,52.5f,0.704118669f});
  state.Slide({false,40,0,0,52.5f,0.8f});
  auto a=state.Snapshot(), b=state.Snapshot();
  assert(a.marking_eligible==2 && a.marking_raised==1 && a.area_slide_eligible==1 && a.area_slide_rejected==0 && a.invalid_inputs==2);
  assert(a.marking_eligible==b.marking_eligible && a.invalid_inputs==b.invalid_inputs);
  state.Reset();z=state.Snapshot();assert(z.marking_eligible==0 && z.marking_raised==0 && z.area_slide_eligible==0 && z.area_slide_rejected==0 && z.invalid_inputs==0);
  assert(std::strcmp(kPolicyVersion,"c4-marking-1")==0 && kMarkingFloor==0.85f && kThreatRadiusM==30.0f && kOwnAreaDuelFloor==0.70f);
}

int main(int argc,char** argv) {
  assert(argc==2);std::string name=argv[1];
  if(name=="marking")marking();else if(name=="slide")slide();else if(name=="invalid")invalid();else if(name=="counters")counters();else return 2;
  std::cout<<"PASS\n";
}
