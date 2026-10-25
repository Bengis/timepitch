// Bounded JSON -> typed pure policy -> JSON. No gameplay headers or libraries.
#include "marking_continuity.hpp"
#include <boost/property_tree/json_parser.hpp>
#include <iostream>
#include <sstream>
#include <iomanip>
#include <limits>
#include <cctype>
using boost::property_tree::ptree;
using namespace timepitch_marking;

void Require(bool ok) {if(!ok) throw std::invalid_argument("fixture_schema");}
void Keys(const ptree& p,std::initializer_list<const char*> required,std::initializer_list<const char*> optional={}) {
  Require(p.data().empty());std::set<std::string> allowed,seen;
  for(const char* k:required) allowed.insert(k);
  for(const char* k:optional) allowed.insert(k);
  for(const auto& item:p) Require(allowed.count(item.first) && seen.insert(item.first).second);
  for(const char* k:required) Require(seen.count(k)!=0);
}
void Array(const ptree& p,std::size_t maximum) {
  Require(p.data().empty() && p.size()<=maximum);
  for(const auto& v:p) Require(v.first.empty());
}
std::int64_t Integer(const ptree& p) {
  Require(p.empty());std::size_t end=0;auto n=std::stoll(p.data(),&end);Require(end==p.data().size());return n;
}
int Int(const ptree& p) {
  auto n=Integer(p);Require(n>=std::numeric_limits<int>::min() && n<=std::numeric_limits<int>::max());return static_cast<int>(n);
}
bool Flag(const ptree& p) {Require(p.empty() && (p.data()=="true" || p.data()=="false"));return p.data()=="true";}
double Number(const ptree& p) {
  Require(p.empty());std::size_t end=0;double n=std::stod(p.data(),&end);
  Require(end==p.data().size() && std::isfinite(n));return n;
}
Point ReadPoint(const ptree& p) {
  Array(p,2);Require(p.size()==2);auto i=p.begin();Point result;result.x=Number((i++)->second);result.y=Number(i->second);return result;
}
MarkingInput Input(const ptree& p) {
  Keys(p,{"time_ms","team","period","relocation_id","dynamic_side","guard_eligible","own_ids","players","threat_ids","quality","actual_prior_marks"});
  MarkingInput in;in.time_ms=Integer(p.get_child("time_ms"));in.team=Int(p.get_child("team"));
  in.period=Int(p.get_child("period"));in.relocation_id=Integer(p.get_child("relocation_id"));
  in.dynamic_side=Int(p.get_child("dynamic_side"));in.guard_eligible=Flag(p.get_child("guard_eligible"));
  const auto& own=p.get_child("own_ids");Array(own,11);for(const auto& n:own) in.own_ids.push_back(Int(n.second));
  const auto& threats=p.get_child("threat_ids");Array(threats,3);for(const auto& n:threats) in.threat_ids.push_back(Int(n.second));
  const auto& members=p.get_child("players");Array(members,22);
  for(const auto& item:members) {
    const auto& v=item.second;Keys(v,{"id","team","active","keeper","manual","ball_contest","position"});
    MarkingPlayer player;player.id=Int(v.get_child("id"));player.team=Int(v.get_child("team"));
    player.active=Flag(v.get_child("active"));player.keeper=Flag(v.get_child("keeper"));
    player.manual=Flag(v.get_child("manual"));player.ball_contest=Flag(v.get_child("ball_contest"));
    player.position=ReadPoint(v.get_child("position"));in.players.push_back(player);
  }
  const auto& q=p.get_child("quality");Array(q,11);
  for(const auto& row:q) {Array(row.second,3);std::vector<double> values;for(const auto& v:row.second) values.push_back(Number(v.second));in.quality.push_back(values);}
  const auto& prior=p.get_child("actual_prior_marks");Array(prior,11);
  for(const auto& m:prior) {Keys(m.second,{"owner","target"});in.actual_prior_marks.push_back({Int(m.second.get_child("owner")),Int(m.second.get_child("target"))});}
  return in;
}
MarkingContext Context(const ptree& p) {
  Keys(p,{"initialized","team","period","relocation_id","dynamic_side","eligible"});MarkingContext c;
  c.initialized=Flag(p.get_child("initialized"));c.team=Int(p.get_child("team"));c.period=Int(p.get_child("period"));
  c.relocation_id=Integer(p.get_child("relocation_id"));c.dynamic_side=Int(p.get_child("dynamic_side"));c.eligible=Flag(p.get_child("eligible"));return c;
}
void Pairs(const std::vector<MarkPair>& pairs) {
  std::cout<<'[';for(std::size_t i=0;i<pairs.size();++i) {if(i) std::cout<<',';std::cout<<'['<<pairs[i].owner<<','<<pairs[i].target<<']';}std::cout<<']';
}
void Print(const MarkingDecision& d) {
  std::cout<<std::boolalpha<<std::setprecision(17)<<"{\"valid\":"<<d.valid<<",\"version\":\""<<kVersion<<"\",\"reference_pairs\":";
  Pairs(d.reference_pairs);std::cout<<",\"pairs\":";Pairs(d.pairs);std::cout<<",\"reasons\":[";
  for(std::size_t i=0;i<d.reasons.size();++i) {
    if(i) std::cout<<',';const auto& r=d.reasons[i];
    std::cout<<"{\"rank\":"<<r.rank<<",\"target\":"<<r.target<<",\"native_owner\":"<<r.native_owner
      <<",\"previous_owner\":"<<r.previous_owner<<",\"reference_owner\":"<<r.reference_owner<<",\"code\":\""<<r.code
      <<"\",\"previous_distance_m\":";
    if(r.distances_available) std::cout<<r.previous_distance_m;else std::cout<<"null";
    std::cout<<",\"native_distance_m\":";if(r.distances_available) std::cout<<r.native_distance_m;else std::cout<<"null";std::cout<<'}';
  }
  const auto& c=d.next_context;
  std::cout<<"],\"next_context\":{\"initialized\":"<<c.initialized<<",\"team\":"<<c.team<<",\"period\":"<<c.period
    <<",\"relocation_id\":"<<c.relocation_id<<",\"dynamic_side\":"<<c.dynamic_side<<",\"eligible\":"<<c.eligible<<"}}\n";
}
void LexicalBounds(const std::string& s) {
  int depth=0;
  for(std::size_t i=0;i<s.size();++i) {
    char c=s[i];if(c=='{' || c=='[') Require(++depth<=12);
    else if(c=='}' || c==']') Require(--depth>=0);
    else if(c=='"') {
      while(++i<s.size() && s[i]!='"') Require(s[i]!='\\');
      Require(i<s.size());std::size_t next=i+1;
      while(next<s.size() && std::isspace(static_cast<unsigned char>(s[next]))) ++next;
      Require(next<s.size() && s[next]==':'); // Keys only; this numeric/bool fixture has no string values.
    }
  }
  Require(depth==0);
}
int main() {
  try {
    char buffer[65537];std::cin.read(buffer,sizeof(buffer));auto size=std::cin.gcount();Require(size<=65536);
    std::string raw(buffer,static_cast<std::size_t>(size));LexicalBounds(raw);
    std::istringstream stream(raw);ptree request;boost::property_tree::read_json(stream,request);
    Keys(request,{"input"},{"context","reference_only"});auto in=Input(request.get_child("input"));
    bool reference=request.count("reference_only") ? Flag(request.get_child("reference_only")) : false;
    if(reference) {MarkingDecision d;d.reference_pairs=ReferenceGreedy(in);d.pairs=d.reference_pairs;d.valid=true;Print(d);}
    else Print(CoordinateMarking(in,Context(request.get_child("context"))));
  } catch(const std::exception&) {Print(MarkingDecision{});}
  return 0;
}
