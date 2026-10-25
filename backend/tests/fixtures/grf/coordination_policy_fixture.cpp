// Real wire -> pure policy -> JSON. No gameplay headers or libraries.
#include "coordination_policy.hpp"
#include <iostream>
#include <iomanip>
#include <stdexcept>
using namespace timepitch_coordination;

std::string Token() { std::string s; if (!(std::cin>>s)) throw std::runtime_error("short wire"); return s; }
std::int64_t Integer() {
  auto s=Token(); std::size_t end=0; auto v=std::stoll(s,&end);
  if (end!=s.size()) throw std::runtime_error("integer"); return v;
}
int Int() {
  auto n=Integer(); if (n<std::numeric_limits<int>::min() || n>std::numeric_limits<int>::max()) throw std::runtime_error("id range");
  return static_cast<int>(n);
}
std::size_t Count(std::size_t maximum) {
  auto n=Integer(); if (n<0 || static_cast<std::uint64_t>(n)>maximum) throw std::runtime_error("bound");
  return static_cast<std::size_t>(n);
}
bool Flag() { int n=Int(); if (n!=0 && n!=1) throw std::runtime_error("bool"); return n==1; }
double Number() { auto s=Token(); std::size_t end=0; double n=std::stod(s,&end); if (end!=s.size()) throw std::runtime_error("number"); return n; }
Point ReadPoint() { Point p; p.x=Number(); p.y=Number(); return p; }
void PointJson(Point p) { std::cout<<'['<<p.x<<','<<p.y<<']'; }
void MarksJson(const std::vector<Mark>& marks) {
  std::cout<<'['; bool first=true;
  for (const auto& m:marks) { if (!first) std::cout<<','; first=false;
    std::cout<<"{\"owner\":"<<m.owner<<",\"target\":"<<m.target<<",\"committed_ms\":"<<m.committed_ms<<'}'; }
  std::cout<<']';
}
void IdsJson(const std::vector<int>& ids) {
  std::cout<<'['; for (std::size_t i=0;i<ids.size();++i) { if (i) std::cout<<','; std::cout<<ids[i]; } std::cout<<']';
}
void StateJson(const CoordinationState& s) {
  std::cout<<"{\"time_ms\":"<<s.time_ms<<",\"assignment_ms\":"<<s.assignment_ms<<",\"period\":"<<s.period
    <<",\"team\":"<<s.team<<",\"dynamic_side\":"<<s.dynamic_side<<",\"valid\":"<<(s.valid?"true":"false")
    <<",\"cover_id\":"<<s.cover_id<<",\"cover_target\":"; PointJson(s.cover_target);
  std::cout<<",\"degraded_since_ms\":"<<s.degraded_since_ms<<",\"last_override_player\":"<<s.last_override_player
    <<",\"last_override_ms\":"<<s.last_override_ms<<",\"last_override_kind\":\""<<s.last_override_kind<<"\",\"marks\":";
  MarksJson(s.marks); std::cout<<",\"hunts\":"; IdsJson(s.hunts); std::cout<<'}';
}
int main() {
  try {
    auto version=Token();
    if (version=="K1PROJECT") {
      std::vector<int> owners,targets;
      auto count=Count(11); for (std::size_t i=0;i<count;++i) owners.push_back(Int());
      count=Count(3); for (std::size_t i=0;i<count;++i) targets.push_back(Int());
      std::map<std::pair<int,int>,double> quality; std::map<std::pair<int,int>,bool> allowed;
      for (int owner:owners) for (int target:targets) { quality[{owner,target}]=Number(); allowed[{owner,target}]=true; }
      std::string extra; if (std::cin>>extra) throw std::runtime_error("trailing projection");
      auto solution=SolveAssignment(owners,targets,quality,allowed,{},{});
      std::cout<<std::setprecision(17)<<"{\"valid\":"<<(solution.valid?"true":"false")<<",\"quality\":"<<solution.score<<",\"pairs\":[";
      for (std::size_t i=0;i<solution.pairs.size();++i) { if (i) std::cout<<',';
        std::cout<<'['<<solution.pairs[i].first<<','<<solution.pairs[i].second<<']'; }
      std::cout<<"]}\n"; return 0;
    }
    if (version!="K1V1") throw std::runtime_error("version"); auto operation=Token();
    CoordinationInput in;
    in.time_ms=Integer(); in.period=Int(); in.team=Int(); in.dynamic_side=Int();
    in.assignment_tick=Flag(); in.play_eligible=Flag(); in.defending=Flag(); in.ball_100ms=ReadPoint();
    auto count=Count(22);
    for (std::size_t i=0;i<count;++i) {
      Player p; p.id=Int(); p.team=Int(); p.active=Flag(); p.keeper=Flag(); p.hunt_eligible=Flag();
      p.manual=Flag(); p.ball_contest=Flag(); p.position=ReadPoint(); p.formation_available=Flag(); p.formation=ReadPoint(); in.players.push_back(p);
    }
    count=Count(3); for (std::size_t i=0;i<count;++i) in.threat_ids.push_back(Int());
    count=Count(22);
    for (std::size_t i=0;i<count;++i) {
      std::vector<double> row; auto columns=Count(3);
      for (std::size_t j=0;j<columns;++j) row.push_back(Number()); in.quality.push_back(row);
    }
    CoordinationState s;
    s.time_ms=Integer(); s.assignment_ms=Integer(); s.period=Int(); s.team=Int(); s.dynamic_side=Int();
    s.valid=Flag(); s.cover_id=Int(); s.cover_target=ReadPoint(); s.degraded_since_ms=Integer();
    s.last_override_player=Int(); s.last_override_ms=Integer(); s.last_override_kind=Token();
    if (s.last_override_kind!="none" && s.last_override_kind!="manual" && s.last_override_kind!="ball_contest") throw std::runtime_error("kind");
    count=Count(3);
    for (std::size_t i=0;i<count;++i) { Mark m; m.owner=Int(); m.target=Int(); m.committed_ms=Integer(); s.marks.push_back(m); }
    count=Count(2); for (std::size_t i=0;i<count;++i) s.hunts.push_back(Int());
    CoordinationDecision decision;
    if (operation=="override") {
      int id=Int(); auto time=Integer(); auto kind=Token();
      decision.next_state=ApplyOverride(s,id,time,kind); decision.valid=decision.next_state.valid;
    } else if (operation=="coordinate") decision=Coordinate(in,s);
    else throw std::runtime_error("operation");
    std::string extra; if (std::cin>>extra) throw std::runtime_error("trailing wire");
    std::cout<<std::setprecision(17)<<"{\"valid\":"<<(decision.valid?"true":"false")<<",\"version\":\""<<kVersion<<"\",\"objective\":"<<decision.objective<<",\"marks\":";
    MarksJson(decision.marks); std::cout<<",\"cover\":";
    if (decision.cover_id<0) std::cout<<"null";
    else { std::cout<<"{\"id\":"<<decision.cover_id<<",\"target\":"; PointJson(decision.cover_target); std::cout<<'}'; }
    std::cout<<",\"hunts\":"; IdsJson(decision.hunts); std::cout<<",\"reasons\":[";
    for (std::size_t i=0;i<decision.reasons.size();++i) { if (i) std::cout<<','; std::cout<<'"'<<decision.reasons[i]<<'"'; }
    std::cout<<"],\"state\":"; StateJson(decision.next_state); std::cout<<"}\n";
    return 0;
  } catch (const std::exception& e) { std::cerr<<e.what()<<'\n'; return 2; }
}
