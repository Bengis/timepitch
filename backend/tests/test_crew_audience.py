"""TP260: report audience (fan or analyst) and the comparisons paragraph on how the result was reached."""
import json

from crew_fixtures import tp229_pack
from timepitch.crew.agents import AUDIENCE_STYLE, HOW_IT_WAS_WON, parse_plan, writer_instructions
from timepitch.crew.cloud import CrewRequest, build_request
from timepitch.crew.models import CrewPlan, default_binding, request_hash
from timepitch.chronicles.models import fact_pack_hash


def test_writer_instructions_name_the_audience_and_the_comparisons_paragraph():
    fan, analyst = writer_instructions('en', tp229_pack()), writer_instructions('en', tp229_pack(), 'analyst')
    assert AUDIENCE_STYLE['fan'] in fan and AUDIENCE_STYLE['analyst'] in analyst and AUDIENCE_STYLE['fan'] not in analyst
    assert HOW_IT_WAS_WON in fan and HOW_IT_WAS_WON in analyst


def test_a_plan_without_comparisons_gets_the_recorded_ones():
    pack = tp229_pack()
    plan = parse_plan(pack, json.dumps({'angle': 'narrow_win', 'paragraphs': [['result', 'goal:grf:134'], ['leader:goals']]}))
    compare = [f.id for f in pack.facts if f.kind == 'team_compare' and f.availability != 'unavailable']
    assert plan.paragraphs[-1] == compare[:2]


def test_a_plan_that_already_compares_is_left_alone():
    pack = tp229_pack()
    compare = next(f.id for f in pack.facts if f.kind == 'team_compare')
    raw = {'angle': 'narrow_win', 'paragraphs': [['result'], [compare]]}
    assert parse_plan(pack, json.dumps(raw)) == CrewPlan.model_validate(raw)


def test_each_audience_is_its_own_request():
    pack, binding = tp229_pack(), default_binding()
    fan = request_hash(fact_pack_hash(pack), 'en', binding)
    analyst = request_hash(fact_pack_hash(pack), 'en', binding, 'analyst')
    assert fan != analyst


def test_the_queued_request_carries_its_audience(tmp_path):
    from test_live_crew import grant  # the same envelope helper the live service tests use
    raw = grant(max_reports=3, locales=['en']).model_dump_json().encode()
    body, rh = build_request(tp229_pack(), 'en', raw, default_binding(), audience='analyst')
    request = CrewRequest.model_validate_json(body)
    assert request.audience == 'analyst' and rh == request_hash(fact_pack_hash(tp229_pack()), 'en', default_binding(), 'analyst')
