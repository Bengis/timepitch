from pathlib import Path
import pytest
from timepitch.catalog.repository import CatalogRepository
from timepitch.simulation.engine import simulate_match, make_config
from timepitch.agents.models import GroundedAnalysis, GroundedExplanation,MetricFact,WindowStatistics
from timepitch.agents.tools import build_windows
from timepitch.agents.validation import validate_analysis, validate_explanation


@pytest.fixture(scope='module')
def evidence():
    catalog = CatalogRepository(Path(__file__).resolve().parents[2] / 'research/data-audit/2026-10-16/derived/coverage.sqlite')
    record = simulate_match(make_config(catalog, 'arsenal:2003', 'mancity:2017'), catalog)
    return record, build_windows(record)[-1]


def valid(record, window):
    return GroundedAnalysis(window_id=window.id, revision=record.trace_hash, category='overview', side=None,
                            event_ids=[window.event_ids[-1]], player_keys=[], score=window.score)


def test_grounded_analysis_accepts_only_real_window_references(evidence):
    record, window = evidence
    analysis = valid(record, window)
    assert validate_analysis(analysis, record, window).accepted
    for patch in ({'event_ids': ['invented']}, {'player_keys': ['away:invented']},
                  {'score': {'home': 99, 'away': 0}}, {'revision': 'previous'}, {'window_id': 'previous'}):
        altered = GroundedAnalysis.model_validate({**analysis.model_dump(), **patch})
        assert not validate_analysis(altered, record, window).accepted


def test_qualitative_claim_must_be_supported_by_its_cited_event(evidence):
    record, window = evidence
    analysis = valid(record, window).model_copy(update={'category': 'goal', 'side': 'home'})
    # The full-time marker cannot support a claim of a goal.
    assert not validate_analysis(analysis, record, window).accepted


def test_narrator_cannot_insert_html_false_stats_or_change_accepted_claim(evidence):
    record, window = evidence
    analysis = valid(record, window)
    explanation = GroundedExplanation(window_id=window.id, revision=record.trace_hash, locale='en', mode='fan',
        category='overview', variant=0, event_ids=analysis.event_ids, player_keys=[], score=window.score)
    assert validate_explanation(explanation, analysis, record, window).accepted
    for patch in ({'category': 'goal'}, {'revision': 'old'}, {'event_ids': ['invented']}, {'score': {'home': 99, 'away': 0}}):
        altered = GroundedExplanation.model_validate({**explanation.model_dump(), **patch})
        assert not validate_explanation(altered, analysis, record, window).accepted
    with pytest.raises(ValueError):
        GroundedExplanation.model_validate({**explanation.model_dump(), 'text': '<script>alert(1)</script>'})


def test_window_selection_is_fixed_bounded_and_includes_half_and_full_time(evidence):
    record, _ = evidence
    windows = build_windows(record)
    assert [(w.id, w.end_ms) for w in windows][1:] == [('halftime', 2700000), ('fulltime', 5400000)]
    assert len(windows) == 3
    assert all(1 <= len(w.event_ids) <= 4 and w.revision == record.trace_hash for w in windows)


@pytest.fixture(scope='module')
def metric_evidence():
    catalog=CatalogRepository(Path(__file__).resolve().parents[2]/'research/data-audit/2026-10-16/derived/coverage.sqlite')
    record=simulate_match(make_config(catalog,'arsenal:2025','mancity:2025',42),catalog)
    return record,build_windows(record)[-1]


def fact_analysis(window,fact):
    return GroundedAnalysis(window_id=window.id,revision=window.revision,category=fact.category,side=fact.side,
        event_ids=fact.event_ids,player_keys=[fact.player_key] if fact.player_key else [],score=window.score,
        metric_id=fact.metric_id,metric_player_key=fact.player_key,sample_ranges=fact.sample_ranges)


def test_new_claims_are_selected_from_bounded_authoritative_metric_facts(metric_evidence):
    record,window=metric_evidence
    assert {fact.category for fact in window.statistics.facts}=={'chance_quality_edge','territory_edge','distance_leader'}
    assert len(window.statistics.facts)<=4
    for fact in window.statistics.facts:
        assert len(fact.event_ids)<=4 and len(fact.sample_ranges)<=4
        analysis=fact_analysis(window,fact)
        assert validate_analysis(analysis,record,window).accepted
        assert not validate_analysis(analysis.model_copy(update={'metric_id':'invented'}),record,window).accepted
        changed=window.model_copy(deep=True)
        next(f for f in changed.statistics.facts if f.id==fact.id).value+=100
        assert not validate_analysis(analysis,record,changed).accepted


def test_unique_distance_leader_rejects_tie_foreign_player_future_range_and_historical_origin(metric_evidence):
    record,window=metric_evidence
    fact=next(f for f in window.statistics.facts if f.category=='distance_leader')
    analysis=fact_analysis(window,fact)
    assert analysis.event_ids==[] and analysis.sample_ranges
    assert not validate_analysis(analysis.model_copy(update={'sample_ranges':[(0,len(record.motion))]}),record,window).accepted
    assert not validate_analysis(analysis.model_copy(update={'metric_player_key':'foreign'}),record,window).accepted
    tied=record.model_copy(deep=True)
    distances=sorted(tied.statistics.by_player.values(),key=lambda m:-m['distance_m'].value)
    distances[1]['distance_m'].value=distances[0]['distance_m'].value
    assert not validate_analysis(analysis,tied,window).accepted
    historical=record.model_copy(deep=True)
    historical.statistics.by_player[fact.player_key]['distance_m'].origin='historical'
    assert not validate_analysis(analysis,historical,window).accepted


@pytest.mark.parametrize('category,metric,value,denominator',[('chance_quality_edge','simulated_xg',.84345,None),
    ('territory_edge','field_tilt_tp',50,28),('territory_edge','field_tilt_tp',75,0)])
def test_metric_advantage_thresholds_are_not_inferred_from_reputation(metric_evidence,category,metric,value,denominator):
    record,window=metric_evidence
    altered=record.model_copy(deep=True)
    altered.statistics.by_team['home'][metric].value=value
    altered.statistics.by_team['home'][metric].denominator=denominator
    fact=next(f for f in window.statistics.facts if f.category==category)
    assert not validate_analysis(fact_analysis(window,fact),altered,window).accepted


@pytest.mark.parametrize('locale,mode',[('en','fan'),('en','analyst'),('es','fan'),('es','analyst')])
def test_metric_narration_inserts_server_numbers_and_narrator_cannot_change_metric(metric_evidence,locale,mode):
    from timepitch.agents.narration import render_narration
    record,window=metric_evidence
    for fact in window.statistics.facts:
        analysis=fact_analysis(window,fact)
        explanation=GroundedExplanation(**analysis.model_dump(),locale=locale,mode=mode,variant=0)
        assert validate_explanation(explanation,analysis,record,window).accepted
        text=render_narration(explanation,window.statistics)
        assert fact.unit in text and (fact.player_name or fact.team_name) in text
        assert not validate_explanation(explanation.model_copy(update={'metric_id':'invented'}),analysis,record,window).accepted
