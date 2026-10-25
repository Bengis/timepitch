"""Complete-split gates and conservative C5 screening, hand-authored metrics only."""
import copy
import importlib
import importlib.util
import pytest


def api():
    name='timepitch.grf.action_gates'
    assert importlib.util.find_spec(name), 'Missing complete action gates'
    return importlib.import_module(name)


def rows(n=8,candidate='c4',split='calibration'):
    return [dict(status='ready',split=split,fixture_id=f'{i:02}',candidate_id=candidate,profile_identity='a'*64,
        goals=3,penalty_goals=0,open_play_goals=3,goal_classification_complete=True,penalty_goal_evidence=[],
        shots=20,passes=600,clearances=1,releases=621,release_ratio=1.,player_coverage=[.95]*22,
        outfield_km=[10.]*20,effective_minutes=60.,seconds=300.,peak_private_bytes=400*1024*1024,
        policy_counters=dict(marking_eligible=2,marking_raised=1,area_slide_eligible=1,area_slide_rejected=0,invalid_inputs=0),
        policy_valid=True) for i in range(1,n+1)]


def report(values):
    return dict(schema_version='grf-action-campaign-report-1',candidate_id='c4',split='calibration',rows=values,
        gates=api().evaluate_action_gates(values,expected=8))


def test_exact_numeric_gate_boundaries_and_pooled_nearest_rank():
    m=api();values=rows()
    assert all(m.evaluate_action_gates(values,expected=8).values())
    for key,low,high in [('shots',12,50),('passes',400,1500),('effective_minutes',45,70),('goals',1.5,4.5)]:
        for bound in (low,high):
            current=rows()
            if key=='goals':
                for i,r in enumerate(current):r[key]=int(bound)+(i%2)
            else:
                for r in current:r[key]=bound
            assert m.evaluate_action_gates(current,expected=8)[key if key!='effective_minutes' else 'effective_time']
    for r in values:r['outfield_km']=[8.]*19+[16.]
    assert m.evaluate_action_gates(values,expected=8)['distance_p95']
    values[-1]['outfield_km'][-1]=17.
    assert m.evaluate_action_gates(values,expected=8)['distance_p95']  # eight extremes, P95 index152 is still8
    for r in values:r['outfield_km'][-2:]=[17.,17.]
    assert not m.evaluate_action_gates(values,expected=8)['distance_p95']


@pytest.mark.parametrize('change',['missing','duplicate','failed','mixed_split','mixed_profile','nan','coverage_count',
    'coverage_low','zero_releases','contact_only','invalid_policy','invalid_counter','no_raise','wrong_candidate'])
def test_incomplete_or_invalid_split_never_qualifies(change):
    values=rows()
    if change=='missing':values.pop()
    if change=='duplicate':values[-1]['fixture_id']='01'
    if change=='failed':values[0]['status']='failed'
    if change=='mixed_split':values[0]['split']='heldout'
    if change=='mixed_profile':values[0]['profile_identity']='b'*64
    if change=='nan':values[0]['outfield_km'][0]=float('nan')
    if change=='coverage_count':values[0]['player_coverage'].pop()
    if change=='coverage_low':values[0]['player_coverage'][0]=.9499
    if change=='zero_releases':values[0]['releases']=0
    if change=='contact_only':values[0]['release_ratio']=.94;values[0]['contact_ratio']=1.
    if change=='invalid_policy':values[0]['policy_valid']=False
    if change=='invalid_counter':values[0]['policy_counters']['invalid_inputs']=1
    if change=='no_raise':
        for r in values:r['policy_counters']['marking_raised']=0
    if change=='wrong_candidate':values[0]['candidate_id']='c5'
    assert not all(api().evaluate_action_gates(values,expected=8).values())


def test_expected_is_fixed_and_heldout_zero_exercise_is_reported():
    with pytest.raises(ValueError):api().evaluate_action_gates(rows(),expected=7)
    values=rows(24,split='heldout')
    for r in values:r['policy_counters']['marking_raised']=0
    assert all(api().evaluate_action_gates(values,expected=24).values())


def eligible_rows():
    values=rows()
    for r in values:
        r.update(goals=6,penalty_goals=2,open_play_goals=4,penalty_goal_evidence=[
            dict(goal_raw_seq=100+i,release_raw_seq=10+i,release_semantic_seq=20+i,restart_id=1+i,
                 prepared_raw_seq=2+i,sanctioned_raw_seq=4+i,accepted_raw_seq=6+i) for i in range(2)])
    return values


def test_c5_requires_complete_eligible_c4():
    m=api();values=eligible_rows();d=m.c5_eligibility(report(values))
    assert d['eligible'] and d['penalty_bound']['mean_goals_without_confirmed_penalties']==4
    assert len(d['source_report_sha256'])==64
    variants=[rows(),values[:-1]]
    for key,value in [('goal_classification_complete',False),('passes',300),('penalty_goals',0),('goals',10),('status','failed')]:
        changed=copy.deepcopy(values)
        for r in changed:r[key]=value
        variants.append(changed)
    changed=copy.deepcopy(values);changed[0]['penalty_goal_evidence'][0]['prepared_raw_seq']=None;variants.append(changed)
    for value in variants:assert not m.c5_eligibility(report(value))['eligible']
