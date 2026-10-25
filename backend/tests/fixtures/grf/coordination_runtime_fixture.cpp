#include "coordination_runtime.hpp"
#include <cassert>
#include <iostream>
using namespace timepitch_coordination;
CoordinationInput Input() {
  CoordinationInput in;in.time_ms=2149000;in.team=0;in.period=1;in.dynamic_side=-1;
  in.ball_100ms={-20,0};
  for(int i=0;i<5;++i){Player p;p.id=i;p.team=0;p.position={double(-25+i),0};p.formation={-24,0};p.formation_available=true;in.players.push_back(p);}
  for(int i=0;i<3;++i){Player p;p.id=100+i;p.team=1;p.position={-30.,double(i)};in.players.push_back(p);in.threat_ids.push_back(p.id);}
  in.quality={{.8,.7,.6},{.7,.8,.6},{.6,.7,.8},{.5,.5,.5},{.4,.4,.4}};return in;
}
int main(int argc,char** argv){
  assert(argc==2);std::string c=argv[1];Runtime r;r.Start("observe");auto in=Input();
  if(c=="wire"){
    auto initial=r.Snapshot(in.time_ms,1,7);r.Assign(in,{},7,[](const CoordinationDecision&){});
    auto seq=r.BeginRequest(0,in.time_ms);r.Request(0,seq,in.time_ms,{-24,0},{-0.0,1},true);
    r.Selected(0,seq,in.time_ms,0,0,1,true,0);r.BeginRequest(1,in.time_ms);
    auto final=r.Snapshot(in.time_ms+100,1,7);auto transactions=r.Drain();
    std::cout<<"{\"initial\":"<<initial<<",\"final\":"<<final<<",\"transactions\":[";
    for(std::size_t i=0;i<transactions.size();++i){if(i)std::cout<<',';std::cout<<transactions[i];}
    std::cout<<"]}\n";return 0;
  }else if(c=="bounds"){
    for(int i=0;i<401;++i)r.Assign(in,{},7,[](const CoordinationDecision&){});
    assert(r.Overflowed()&&r.Drain().size()==400);
  }else if(c=="atomic"){
    int commits=0;auto d=r.Assign(in,{},7,[&](const CoordinationDecision&){++commits;});assert(d.valid&&commits==0);
    r.Start("apply");d=r.Assign(in,{},7,[&](const CoordinationDecision&){++commits;});assert(d.valid&&commits==1);
    in.quality[0][0]=2;d=r.Assign(in,{},7,[&](const CoordinationDecision&){++commits;});assert(!d.valid&&commits==1);
    assert(r.Counters().invariant_violations==1);
  }else if(c=="observe"){
    std::vector<Mark> actual={{4,100,0}};auto before=actual;
    auto d=r.Assign(in,actual,7,[&](const CoordinationDecision& x){actual=x.marks;});
    assert(actual[0].owner==before[0].owner&&d.valid&&!d.marks.empty());
    assert(r.State(0).marks.size()==d.marks.size());assert(r.State(1).time_ms==-1);
    auto a=r.Snapshot(2149000,1,7);auto b=r.Snapshot(2149000,1,7);assert(a==b);
  }else if(c=="override"){
    r.Assign(in,{},7,[](const CoordinationDecision&){});auto state=r.State(0);int owner=state.marks[0].owner;
    r.Override(0,owner,in.time_ms+10,"manual",7);assert(r.State(0).marks.size()+1==state.marks.size());
    assert(r.State(0).last_override_player==owner&&r.Counters().overrides==1);
  }else if(c=="cover"){
    r.Start("apply");auto d=r.Assign(in,{},7,[](const CoordinationDecision&){});
    assert(d.cover_id>=0);Point target;assert(r.Cover(0,d.cover_id,target));assert(std::abs(target.y)<=12);
    for(const auto& m:d.marks)assert(m.owner!=d.cover_id);
    r.Start("observe");r.Assign(in,{},7,[](const CoordinationDecision&){});assert(!r.Cover(0,0,target));
  }else if(c=="lineage"){
    auto seq=r.BeginRequest(0,in.time_ms);r.Request(0,seq,in.time_ms,{-24,1},{-25,0},true);
    r.Selected(0,seq,in.time_ms,2,11,12,true,0);
    auto frame=r.Snapshot(in.time_ms,1,7);assert(frame.find("\"selected_animation\":12")!=std::string::npos);
    assert(frame.find("\"request_seq\":1")!=std::string::npos);
    assert(frame.find("\"requested_target\":[-24,1]")!=std::string::npos);
  }else if(c=="reset"){
    r.Assign(in,{},7,[](const CoordinationDecision&){});r.Reset();assert(r.State(0).time_ms==-1&&r.Mode()=="disabled");
    assert(r.Counters().assignments==0&&r.Drain().empty());
  }else if(c=="windows"){
    assert(Runtime::Window(2149000)==0&&Runtime::Window(2159000)==0&&Runtime::Window(2159001)==-1);
    r.Assign(in,{},7,[](const CoordinationDecision&){});auto data=r.Drain();assert(data.size()==1);
    assert(data[0].find("\"prior_state\"")!=std::string::npos&&data[0].find("\"input\"")!=std::string::npos);
    assert(r.Drain().empty());assert(r.Snapshot(10,1,0).empty());
  }else if(c=="context"){
    r.Assign(in,{},7,[](const CoordinationDecision&){});r.Context(0,in.time_ms+10,1,-1,false,7);
    assert(r.State(0).marks.empty()&&r.State(0).cover_id==-1&&r.Mode()=="observe");
    in.time_ms+=20;r.Assign(in,{},7,[](const CoordinationDecision&){});r.Context(0,in.time_ms+20,2,1,true,8);
    assert(r.State(0).marks.empty()&&r.State(0).period==2&&r.State(0).dynamic_side==1);
  }else if(c=="guard"){
    auto a=in.players[0],b=in.players[1],opp=in.players[5];a.position={-.876,0};b.position={-15.576,0};opp.position={0,0};
    a.formation=b.formation={100,100};in.players={a,b,opp};in.threat_ids={100};in.quality={{.9},{.1}};
    auto d=r.Assign(in,{},7,[](const CoordinationDecision&){});assert(d.marks[0].owner==0);
    in.time_ms+=1000;in.quality={{.1},{.9}};d=r.Assign(in,{},7,[](const CoordinationDecision&){});
    assert(d.marks[0].owner==0&&r.Counters().handover_rejections>0);
  }else if(c=="mirror"){
    r.Assign(in,{},7,[](const CoordinationDecision&){},-1);auto f=r.Snapshot(in.time_ms,1,7);
    assert(f.find("\"state_mirror_signs\":[-1,0]")!=std::string::npos);
    auto t=r.Drain();assert(t[0].find("\"mirror_sign\":-1")!=std::string::npos);
  }else if(c=="availability"){
    r.BeginRequest(0,in.time_ms);auto f=r.Snapshot(in.time_ms,1,7);
    assert(f.find("\"position_at_request\":null")!=std::string::npos);
    assert(f.find("\"movement_requested\":false")!=std::string::npos);
  }else if(c=="exposure"){
    auto d=r.Assign(in,{},7,[](const CoordinationDecision&){});assert(d.cover_id>=0);
    r.ObserveExposure(0,d.cover_id,d.cover_target,in.ball_100ms,true);assert(r.Counters().cover_exposed==0);
    r.Start("apply");d=r.Assign(in,{},7,[](const CoordinationDecision&){});
    r.ObserveExposure(0,d.cover_id,d.cover_target,in.ball_100ms,true);assert(r.Counters().cover_exposed==1);
  }else return 2;
  std::cout<<"{\"case\":\""<<c<<"\",\"passed\":true}\n";
}
