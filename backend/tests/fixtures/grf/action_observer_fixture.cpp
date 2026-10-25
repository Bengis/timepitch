// The same observer header is used by GRF; this fixture creates no game.
#include "action_observation.hpp"
#include <iostream>
using namespace timepitch_actions;

int main() {
  std::cout << std::boolalpha << "{";
  bool first=true;
  auto output=[&](const char* key, bool value) { if(!first)std::cout<<",";first=false;std::cout<<"\""<<key<<"\":"<<value; };
  auto number=[&](const char* key, unsigned int value) { if(!first)std::cout<<",";first=false;std::cout<<"\""<<key<<"\":"<<value; };
  ActionContext c; c.team=0;c.slot=1;c.animation_id=1;c.touch_frame=30;c.actual_time_ms=100;c.phase=1;
  ActionObserver obs;obs.Enable(100000);obs.BeginRequest(0,1);obs.TagCommand(0,Origin::OpenPlayPass);
  obs.SelectCommand(0,0,1,true);
  obs.BeginRequest(0,1);obs.TagCommand(0,Origin::OpenPlayShot);obs.SelectCommand(0,1,1,false);
  output("rejected_keeps_pass",obs.OriginFor(c)==Origin::OpenPlayPass);
  obs.SelectCommand(0,1,1,true);output("unchanged_animation_keeps_pass",obs.OriginFor(c)==Origin::OpenPlayPass);
  ActionContext other=c;other.team=1;output("other_actor_unknown",obs.OriginFor(other)==Origin::Unknown);
  obs.ExternalAnimation(0,1,1);output("external_animation_unknown",obs.OriginFor(c)==Origin::Unknown);

  unsigned int emergency=0;
  for(unsigned int i=0;i<3;++i) {
    ActionObserver a;a.Enable(100);a.BeginRequest(0,1);a.TagCommand(i,Origin::EmergencyClearance);a.SelectCommand(i,0,1,true);
    a.RecordContact(c,0,ContactRole::Release);auto batch=a.Drain();
    if(batch.events.size()==1 && batch.events[0].intent==Intent::Clearance)++emergency;
  }
  number("emergency_clearances",emergency);

  ActionObserver held;held.Enable(100000);held.BeginRequest(0,1);held.TagCommand(0,Origin::RetainerDistribution);held.SelectCommand(0,0,1,true);
  held.ChangeRetainer(c,0,1,EndReason::None);
  for(unsigned int i=0;i<24;++i){c.actual_time_ms=100+i*10;held.RecordContact(c,i,ContactRole::Retained);}
  c.actual_time_ms=500;held.RecordContact(c,24,ContactRole::Release);held.ChangeRetainer(c,-1,-1,EndReason::Lost);
  auto batch=held.Drain();unsigned int retained=0,releases=0,starts=0,ends=0;
  bool hand=false,order=false;
  for(const auto& r:batch.roles)if(r.role==ContactRole::Retained)++retained;
  for(const auto& e:batch.events){
    if(e.kind==EventKind::RetentionStart)++starts;
    if(e.kind==EventKind::RetentionEnd)++ends;
    if(e.kind==EventKind::Release){++releases;hand=e.intent==Intent::Pass;}
  }
  if(batch.events.size()==3)order=batch.events[1].kind==EventKind::Release && batch.events[2].kind==EventKind::RetentionEnd && batch.events[2].reason==EndReason::Released;
  number("retained_roles",retained);number("releases",releases);number("retention_starts",starts);number("retention_ends",ends);
  output("release_before_end",order);output("hand_release_is_pass",hand);
  c.animation_id=2;c.actual_time_ms=600;held.RecordContact(c,25,ContactRole::Control);auto second=held.Drain();
  output("drain_preserves_identity",second.raw_count==26 && second.semantic_count==4 && second.events.size()==1 && second.events[0].seq==3);

  ActionObserver unknown;unknown.Enable(100);unknown.RecordContact(c,0,ContactRole::Release);auto u=unknown.Drain();
  output("unknown_release",u.events[0].intent==Intent::Unknown && u.events[0].origin==Origin::Unknown);
  for(unsigned int i=0;i<4;++i)unknown.RecordContact(c,i+1,static_cast<ContactRole>(i+3));
  auto kinds=unknown.Drain();output("role_mapping",kinds.events.size()==4 && kinds.events[0].kind==EventKind::Control && kinds.events[1].kind==EventKind::Deflection && kinds.events[2].kind==EventKind::Accidental && kinds.events[3].kind==EventKind::UnknownContact);
  unknown.RecordNonContact(5);auto n=unknown.Drain();output("non_contact_role",n.roles.size()==1 && n.roles[0].role==ContactRole::NotContact && n.events.empty());

  unknown.RecordContact(c,6,ContactRole::Release);output("duplicate_overflow",unknown.Overflowed());
  ActionObserver invalid;invalid.Enable(100);auto bad=c;bad.slot=11;invalid.RecordContact(bad,0,ContactRole::Control);output("invalid_actor_overflow",invalid.Overflowed());
  ActionObserver sequence;sequence.Enable(100);sequence.RecordNonContact(1);output("raw_sequence_overflow",sequence.Overflowed());

  ActionObserver budget;budget.Enable(3);budget.RecordContact(c,0,ContactRole::Control);budget.RecordNonContact(1);
  output("exact_combined_limit",!budget.Overflowed());budget.RecordNonContact(2);output("combined_overflow",budget.Overflowed());
  ActionObserver limit;limit.Enable(100);limit.BeginRequest(0,1);limit.TagCommand(63,Origin::OpenPlayPass);limit.CheckQueueSize(64);
  output("sixty_four_allowed",!limit.Overflowed());limit.CheckQueueSize(65);output("sixty_five_overflow",limit.Overflowed());

  ActionObserver disabled;disabled.BeginRequest(0,1);disabled.TagCommand(100,Origin::OpenPlayPass);disabled.RecordContact(c,0,ContactRole::Release);
  auto empty=disabled.Drain();output("disabled_empty",empty.events.empty() && empty.roles.empty() && !disabled.Overflowed());
  obs.Reset();output("reset_disables",!obs.Enabled() && obs.OriginFor(c)==Origin::Unknown);
  ActionObserver transfer;transfer.Enable(100);transfer.ChangeRetainer(c,0,1,EndReason::None);
  auto target=c;target.team=1;target.slot=2;target.actual_time_ms=700;transfer.ChangeRetainer(target,1,2,EndReason::Lost);
  auto t=transfer.Drain();output("transfer_closes_old",t.events.size()==3 && t.events[1].context.team==0 && t.events[1].context.slot==1 && t.events[2].context.team==1);
  transfer.ChangeRetainer(target,-1,-1,EndReason::Reset);auto reset=transfer.Drain();output("reset_reason",reset.events.size()==1 && reset.events[0].reason==EndReason::Reset);
  std::cout<<"}\n";
}
