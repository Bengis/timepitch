// Compile actual patched hook/commit bodies against a deterministic tiny world.
#include "coordination_runtime.hpp"
#include <cassert>
#include <iostream>
#include <stdexcept>
struct Vector3 {
  float coords[3];Vector3(float x=0,float y=0,float z=0):coords{x,y,z}{}
  Vector3 operator-(const Vector3& b)const{return {coords[0]-b.coords[0],coords[1]-b.coords[1],coords[2]-b.coords[2]};}
  float GetLength()const{return std::sqrt(coords[0]*coords[0]+coords[1]*coords[1]+coords[2]*coords[2]);}
  Vector3 GetNormalized(const Vector3& fallback)const{float n=GetLength();return n?Vector3(coords[0]/n,coords[1]/n,coords[2]/n):fallback;}
};
float clamp(float x,float lo,float hi){return std::max(lo,std::min(x,hi));}
constexpr float distanceToVelocityMultiplier=1,sprintVelocity=7;
constexpr int e_PlayerRole_GK=0;
class Team;class Player;
struct Match {Team* teams[2];bool defending=true;Team* GetTeam(int i){return teams[i];}};
class Player {
 public:int id,role=1,setters=0;bool manual=false;Vector3 position;Player* mark=nullptr;Team* team;
  Player(int value,Team* t):id(value),team(t){}
  int GetStableID()const{return id;}Vector3 GetPosition()const{return position;}
  struct Formation{int role;};Formation GetFormationEntry()const{return {role};}
  bool ExternalControllerActive()const{return manual;}Team* GetTeam(){return team;}
  void SetManMarking(Player* p){mark=p;++setters;}
};
class Team {
 public:int id;Match* match;std::vector<Player*> players;
  bool mirrored=false;
  Team(int value,Match* m):id(value),match(m){}int GetID(){return id;}bool isMirrored(){return mirrored;}
  Match* GetMatch(){return match;}const std::vector<Player*>& GetAllPlayers(){return players;}
};
struct Game {timepitch_coordination::Runtime coordination;long physical_ms=2149000;int physical_relocation_id=7;} game;
Game* GetGame(){return &game;}
timepitch_coordination::CoordinationInput fixture_input;
namespace timepitch_native_coordination {
timepitch_coordination::Point XY(const Vector3& p){return {p.coords[0],p.coords[1]};}
bool Contest(Player*,Match*){return false;}bool Eligible(Team* t){return t->match->defending;}
#include "native-commit.inc"
#include "native-override.inc"
timepitch_coordination::CoordinationInput Snapshot(Team*){return fixture_input;}
std::vector<timepitch_coordination::Mark> Actual(Team*){return {};}
#include "native-tick.inc"
}
struct Eliza {
  Player* player;Team* team;Match* match;float physical_target_distance=-1,inputVelocityFloat=3;
  Vector3 inputDirection{0,1,0};
  Player* CastPlayer(){return player;}
  void Hook(bool forceMagnet,bool k1PriorityOverride){
    (void)k1PriorityOverride;
#include "native-eliza-hook.inc"
  }
};
timepitch_coordination::CoordinationInput Sample(Team& a,Team& b){
  using namespace timepitch_coordination;CoordinationInput in;in.time_ms=2149000;in.ball_100ms={-20,0};
  for(auto* p:a.players){timepitch_coordination::Player x;x.id=p->id;x.team=0;x.position={p->position.coords[0],p->position.coords[1]};x.formation={-24,0};x.formation_available=true;in.players.push_back(x);in.quality.push_back({.5,.5,.5});}
  for(auto* p:b.players){timepitch_coordination::Player x;x.id=p->id;x.team=1;x.position={-30,0};in.players.push_back(x);in.threat_ids.push_back(p->id);}return in;
}
int main(int argc,char** argv){
  assert(argc==2);std::string c=argv[1];Match match;Team own(0,&match),opp(1,&match);match.teams[0]=&own;match.teams[1]=&opp;
  Player p0(0,&own),p1(1,&own),p2(2,&own),p3(3,&own),p4(4,&own),o0(100,&opp),o1(101,&opp),o2(102,&opp);
  own.players={&p0,&p1,&p2,&p3,&p4};opp.players={&o0,&o1,&o2};
  for(auto* p:own.players)p->position=Vector3(-25,0,0);
  auto input=Sample(own,opp);auto& r=game.coordination;r.Start(c=="observe"||c=="priority"?"observe":"apply");
  auto d=r.Assign(input,{},7,[&](const timepitch_coordination::CoordinationDecision& x){timepitch_native_coordination::Commit(&own,x);});
  assert(d.valid&&d.cover_id>=0);Player* cover=own.players.at(static_cast<std::size_t>(d.cover_id));Eliza e{cover,&own,&match};
  r.BeginRequest(cover->id,input.time_ms);auto before=cover->position;
  if(c=="cover"){
    e.Hook(false,false);assert(e.physical_target_distance>=0&&e.inputDirection.coords[0]!=0);
    assert(cover->position.coords[0]==before.coords[0]&&cover->position.coords[1]==before.coords[1]);
    assert(r.Snapshot(input.time_ms,1,7).find("\"cover_requested\":true")!=std::string::npos);
  }else if(c=="observe"){
    e.Hook(false,false);assert(e.physical_target_distance==-1&&e.inputDirection.coords[1]==1);
    for(auto* p:own.players)assert(p->setters==0);
  }else if(c=="priority"){
    e.Hook(true,false);assert(r.State(0).cover_id==d.cover_id);e.Hook(true,true);assert(r.State(0).cover_id==-1);
  }else if(c=="keeper_attack"){
    cover->role=e_PlayerRole_GK;e.Hook(false,false);assert(e.physical_target_distance==-1);
    cover->role=1;match.defending=false;e.Hook(false,false);assert(e.physical_target_distance==-1);
  }else if(c=="atomic"){
    for(auto* p:own.players)p->setters=0;auto invalid=d;invalid.marks[0].target=999;
    bool rejected=false;try{timepitch_native_coordination::Commit(&own,invalid);}catch(const std::runtime_error&){rejected=true;}
    assert(rejected);for(auto* p:own.players)assert(p->setters==0);
  }else if(c=="mirror_source"){
    for(int team=0;team<2;++team)for(bool mirrored:{false,true}){
      r.Start("observe");fixture_input=input;fixture_input.team=team;
      if(team==1)for(auto& p:fixture_input.players)p.team=1-p.team;
      auto* t=match.GetTeam(team);t->mirrored=mirrored;timepitch_native_coordination::Tick(t);
      int expected=(team==0?1:-1)*(mirrored?-1:1);
      auto data=r.Drain();assert(data.size()==1);
      assert(data[0].find("\"mirror_sign\":"+std::to_string(expected))!=std::string::npos);
    }
  }else return 2;
  std::cout<<"{\"case\":\""<<c<<"\",\"passed\":true}\n";
}
