import pytest

from historical_analysis_support import event, game, statistics


def test_related_own_goal_markers_count_once_with_both_evidence_ids():
    from uuid import UUID
    match,events=game([event(30,'Own Goal For',ms=1_000,related_events=[str(UUID(int=31))]),
                       event(31,'Own Goal Against',ms=1_000,team=1,player=201,
                             related_events=[str(UUID(int=30))])], score={'home':1,'away':0})
    result=statistics(match,events)
    assert result.score=={'home':1,'away':0}
    assert result.reconciliation=='matched'
    assert len(result.goals)==1
    assert set(result.goals[0].event_ids)=={str(UUID(int=30)),str(UUID(int=31))}
    assert result.teams[0].metrics['goals'].value==1
    assert next(p for p in result.players if p.player_key=='statsbomb:201').metrics['own_goals'].value==1


def test_regular_goal_not_added_to_calendar_score_and_mismatch_blocks_reconciled_summary():
    match,events=game([event(30,'Shot',ms=1_000,player=101,
                             shot={'outcome':{'name':'Goal'},'statsbomb_xg':.2})],score={'home':2,'away':0})
    result=statistics(match,events)
    assert result.score=={'home':1,'away':0}
    assert result.reconciliation=='mismatch'
    assert 'calendar_score_mismatch' in result.issues


def test_cutoff_never_sees_later_goals_xg_or_substitutions():
    match,events=game([event(30,'Shot',ms=1_000,player=101,
                             shot={'outcome':{'name':'Goal'},'statsbomb_xg':.2}),
                       event(31,'Substitution',ms=2_000,player=101,
                             substitution={'replacement':{'id':111}})],score={'home':1,'away':0})
    result=statistics(match,events,1,500)
    assert result.score=={'home':0,'away':0}
    assert result.reconciliation=='not_final'
    assert not result.goals and not result.substitutions
    assert result.teams[0].metrics['shots'].value==0
    assert result.teams[0].metrics['xg'].value==0
    assert next(p for p in result.players if p.player_key=='statsbomb:101').metrics['played_ms'].value==500
    assert not next(p for p in result.players if p.player_key=='statsbomb:111').active
    assert all(ref not in {'00000000-0000-0000-0000-00000000001e','00000000-0000-0000-0000-00000000001f'}
               for p in result.players for metric in p.metrics.values() for ref in metric.event_ids)


def test_absent_pass_outcome_is_complete_but_unknown_outcome_is_not_a_failure():
    match,events=game([event(30,'Pass',ms=100,player=101,**{'pass':{'recipient':{'id':102}}}),
                       event(31,'Pass',ms=200,player=101,**{'pass':{'outcome':{'name':'Incomplete'}}}),
                       event(32,'Pass',ms=300,player=101,**{'pass':{'outcome':{'name':'Unknown'}}})])
    result=statistics(match,events)
    metrics=result.teams[0].metrics
    assert metrics['passes_attempted'].value==3
    assert metrics['passes_completed'].value==1
    assert metrics['passes_unknown'].value==1
    assert len(result.pass_network)==1 and result.pass_network[0].count==1
    assert result.pass_network[0].recipient_key=='statsbomb:102'


def test_missing_xg_is_unavailable_instead_of_a_zero_sum():
    match,events=game([event(30,'Shot',ms=100,player=101,shot={'outcome':{'name':'Saved'}}),
                       event(31,'Shot',ms=200,player=101,shot={'statsbomb_xg':.3})])
    metric=statistics(match,events).teams[0].metrics['xg']
    assert metric.value is None and metric.provenance=='unavailable'
    assert metric.observed_value==pytest.approx(.3)
    assert metric.missing_count==1 and metric.variant=='statsbomb-shot-xg'


def test_no_real_possession_or_tracking_metrics_inferred_from_overlapping_durations():
    match,events=game([event(30,'Pressure',ms=100,player=101,duration=20),
                       event(31,'Pressure',ms=200,player=102,duration=20)])
    metrics=statistics(match,events).teams[0].metrics
    assert metrics['pressures'].value==2
    for key in ('possession_pct','distance_m','defensive_line_height_m'):
        assert metrics[key].value is None and metrics[key].provenance=='unavailable'
    assert statistics(match,events).definition_version=='statsbomb-events-1'


def test_missing_events_do_not_turn_into_a_scoreless_game():
    match,_=game()
    result=statistics(match.model_copy(update={'event_count':None,'status':'partial'}),[] ,1,0)
    assert result.score is None and result.reconciliation=='unavailable'
    assert result.teams[0].metrics['shots'].value is None


def test_final_summary_rejects_out_of_range_cutoff():
    match,events=game()
    with pytest.raises(ValueError,match='Invalid historical'):
        statistics(match,events,2,3_038_205)


def test_future_lineup_annotation_does_not_make_bench_minutes_unknown_before_valid_substitution():
    def edit(lineups):
        lineups[0]['lineup'][-2]['positions']=[{'from':'45:10','from_period':2,
                                               'start_reason':'Substitution - On (Tactical)'}]
    match,events=game([event(30,'Substitution',period=2,ms=10_100,player=101,
                             substitution={'replacement':{'id':111}})],lineup_edit=edit)
    early=statistics(match,events,1,500)
    assert next(p for p in early.players if p.player_key=='statsbomb:111').metrics['played_ms'].value==0
    assert not any('unresolved_lineup_entry' in i for i in early.issues)


def test_score_disagreement_is_visible_even_when_clock_has_anomaly():
    match,events=game([event(30,'Ball Receipt*',period=2,ms=3_038_300)],score={'home':1,'away':0})
    result=statistics(match,events)
    assert result.reconciliation=='mismatch'
    assert result.clock_status=='partial'
    assert not result.summary_reconciled
    assert 'calendar_score_mismatch' in result.issues


def test_missing_lineups_never_claim_complete_participation_or_reconciled_summary():
    match,events=game()
    result=statistics(match.model_copy(update={'lineups':[],'status':'partial','issues':['lineups_missing']}),events)
    assert result.participation_status=='unavailable'
    assert not result.summary_reconciled
    assert any('unknown_starting_xi_team' in i for i in result.issues)


def test_unique_whistle_can_reconcile_score_without_a_recorded_half_start():
    match,events=game(score={'home':1,'away':0})
    events=[e for e in events if not (e.period==2 and e.type=='Half Start')]
    match=match.model_copy(update={'event_count':len(events)})
    result=statistics(match,events)
    assert result.reconciliation=='mismatch'
    assert result.clock_status=='partial' and not result.summary_reconciled
    assert 'calendar_score_mismatch' in result.issues


def test_unattributed_pass_is_not_two_complete_zero_totals_or_a_future_warning():
    raw=event(30,'Pass',ms=1_000,player=101,**{'pass':{}})
    del raw['team']
    match,events=game([raw])
    final=statistics(match,events)
    for team in final.teams:
        metric=team.metrics['passes_attempted']
        assert metric.value is None and metric.observed_value==0 and metric.missing_count==1
        assert metric.provenance=='unavailable'
        assert '00000000-0000-0000-0000-00000000001e' in metric.event_ids
        assert team.metrics['shots'].value==0
    assert any('event_team_missing' in issue for issue in final.issues)
    assert not final.summary_reconciled
    early=statistics(match,events,1,500)
    assert early.teams[0].metrics['passes_attempted'].value==0
    assert not any('event_team_missing' in issue for issue in early.issues)


def test_unattributed_goal_is_unavailable_with_evidence_instead_of_an_exception():
    raw=event(30,'Shot',ms=1_000,player=101,shot={'outcome':{'name':'Goal'},'statsbomb_xg':.2})
    del raw['team']
    match,events=game([raw])
    result=statistics(match,events)
    assert result.score is None and result.reconciliation=='unavailable'
    assert result.teams[0].metrics['goals'].value is None
    assert any('unattributed_goal' in issue for issue in result.issues)


def test_unlinked_own_goal_markers_do_not_claim_two_goals_as_a_complete_metric():
    match,events=game([event(30,'Own Goal For',ms=1_000),
                       event(31,'Own Goal Against',ms=1_000,team=1,player=201)])
    result=statistics(match,events)
    assert result.score is None
    assert result.teams[0].metrics['goals'].value is None
    assert result.teams[0].metrics['goals'].provenance=='unavailable'
