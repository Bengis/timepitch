// Pure component fixture. Starts no football environment and uses no engine types.
#include "defensive_observer.hpp"
#include <iostream>
#include <limits>
using namespace timepitch_defense;

int main() {
  bool disabled=false,bounds=false,stale=false,unavailable=false,skipped=false;
  bool rejected=false,same=false,proposal=false,selected=false,reset=false,newWindow=false;
  bool twice=false,capacity=false,nonfinite=false,fields=false,readOnly=false,complete=false;
  bool requestIdentity=false;
  DefensiveObserver o;
  disabled=!o.Enabled() && !o.Record(100,0,1) && o.Snapshot(100).empty();
  o.Enable({{100,200},{300,400}});
  bounds=!o.Record(99,0,1) && !o.Record(201,0,1) && o.Record(100,0,1) && o.Record(200,0,1);
  o.BeginEvaluation(110,0,1);
  auto* r=o.Record(110,0,1);
  r->fields.Set("marking_bias",0.25);r->fields.Status("marking","no_marker");
  o.EndEvaluation(110,0,1);
  auto s=o.Snapshot(150);stale=s[1].decision.evaluation_ms==110;
  unavailable=!s[2].decision.evaluated && s[2].decision.fields.scalars.empty();
  skipped=s[1].decision.fields.labels.at("marking")=="no_marker" &&
      s[1].decision.fields.scalars.count("hunt_threshold")==0;
  complete=s[1].decision.complete;
  r->fields.Set("slide_ball_distance",1.2);
  o.RecordSlide(120,0,1);
  o.RecordSelection(130,0,1,13,3,3,false);
  r=o.Record(130,0,1);
  rejected=r->slide_attempt.present && !r->slide_attempt.found && !r->slide_selected.present;
  o.RecordSelection(131,0,1,13,3,3,true);
  same=!r->slide_selected.present;
  o.RecordSelection(140,0,1,13,3,4,true);
  o.BeginEvaluation(150,0,1);o.RecordSelection(160,0,1,1,4,5,true);
  r=o.Record(160,0,1);
  proposal=r->slide_proposal.present && r->slide_proposal.time_ms==120 &&
      r->slide_proposal.fields.scalars.at("slide_ball_distance")==1.2;
  selected=r->slide_selected.present && r->slide_selected.time_ms==140 &&
      r->last_selected.function==1 && r->last_selected.time_ms==160;
  o.BeginRequest(160,0,1);o.RecordSelection(160,0,1,2,5,6,true);
  requestIdentity=r->last_selected.evaluation_sequence==0;
  auto a=o.Snapshot(170),b=o.Snapshot(170);
  readOnly=a[1].decision.sequence==b[1].decision.sequence &&
      a[1].decision.slide_selected.animation_after==b[1].decision.slide_selected.animation_after;
  o.BeginEvaluation(300,0,1);r=o.Record(300,0,1);
  newWindow=!r->slide_proposal.present && !r->slide_selected.present && r->sequence==3;
  try{o.Enable({{0,10}});}catch(const std::invalid_argument&){twice=true;}
  o.Reset();reset=!o.Enabled() && o.Snapshot(300).empty();
  int bad=0;
  for(const auto& w:std::vector<std::vector<Window>>{{},{{-1,10}},{{20,10}},{{0,7440001}},{{0,100},{100,200}}}) {
    DefensiveObserver invalid;try{invalid.Enable(w);}catch(const std::invalid_argument&){++bad;}
  }
  DefensiveObserver limited;limited.Enable({{0,100}},1);
  limited.BeginEvaluation(0,0,1);limited.BeginEvaluation(0,0,2);capacity=limited.Overflowed();
  DefensiveObserver finite;finite.Enable({{0,100}});finite.BeginEvaluation(0,0,0);
  finite.Record(0,0,0)->fields.Set("bad",std::numeric_limits<double>::infinity());nonfinite=finite.Overflowed();
  DefensiveObserver bounded;bounded.Enable({{0,100}});bounded.BeginEvaluation(0,0,0);
  auto* br=bounded.Record(0,0,0);br->fields.Set("keep",17);
  for(int i=0;i<140;++i)br->fields.Set("key"+std::to_string(i),i);
  fields=bounded.Overflowed() && br->fields.scalars.at("keep")==17 && br->fields.scalars.size()==128;
  auto flag=[](bool v){return v?"true":"false";};
  std::cout<<"{\"disabled\":"<<flag(disabled)<<",\"window_bounds\":"<<flag(bounds)
    <<",\"stale_time\":"<<flag(stale)<<",\"unavailable\":"<<flag(unavailable)<<",\"skipped\":"<<flag(skipped)
    <<",\"rejected_slide\":"<<flag(rejected)<<",\"same_animation\":"<<flag(same)
    <<",\"proposal_survives\":"<<flag(proposal)<<",\"selected_slide_survives\":"<<flag(selected)
    <<",\"reset\":"<<flag(reset)<<",\"new_window\":"<<flag(newWindow)<<",\"bad_windows\":"<<bad
    <<",\"double_enable\":"<<flag(twice)<<",\"actor_capacity\":"<<flag(capacity)
    <<",\"nonfinite\":"<<flag(nonfinite)<<",\"field_capacity\":"<<flag(fields)
    <<",\"read_only_snapshot\":"<<flag(readOnly)<<",\"complete_evaluation\":"<<flag(complete)
    <<",\"request_identity\":"<<flag(requestIdentity)<<"}";
}
