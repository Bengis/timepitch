"""Independent replay sources, never recorder rows as their own expectation."""
from types import SimpleNamespace
import copy
import pytest
from grf_physical_fixtures import row
from grf_offline_guard import offline_only


def identities():
    return [dict(side=s,slot=i,native_stable_id=300+s*20+i,active=True,keeper=i==0)
        for s in (0,1) for i in range(11)]


def test_mapping_is_not_an_id_formula():
    from timepitch.grf.m1_evidence import replay_frame,validate_mapping
    mapping=identities();validate_mapping(mapping)
    expected=replay_frame(row(),mapping)
    assert expected['players'][11]['id']==320
    mapping[-1]['native_stable_id']=300
    with pytest.raises(ValueError):validate_mapping(mapping)


@pytest.mark.parametrize('field,tolerance',[('position',.0001),('velocity',.001)])
def test_float_transport_tolerance_has_no_relative_allowance(field,tolerance):
    from timepitch.grf.m1_evidence import replay_frame,compare_frame
    expected=replay_frame(row(),identities())
    expected['players'][0][field][0]=0.
    actual=copy.deepcopy(expected);actual['players'][0][field][0]=tolerance
    compare_frame(actual,expected)
    actual['players'][0][field][0]=tolerance*1.00001
    with pytest.raises(ValueError):compare_frame(actual,expected)
    actual=copy.deepcopy(expected);actual['players'][0][field][0]=float('nan')
    with pytest.raises(ValueError):compare_frame(actual,expected)


@pytest.mark.parametrize('field,value',[('period',2),('relocation_id',1),('physics_ms',100),('attack_direction',[-1,1])])
def test_frame_epoch_is_exact(field,value):
    from timepitch.grf.m1_evidence import replay_frame,compare_frame
    expected=replay_frame(row(),identities());bad=copy.deepcopy(expected);bad[field]=value
    with pytest.raises(ValueError):compare_frame(bad,expected)


def test_frame_direction_is_an_integer_not_a_boolean():
    from timepitch.grf.m1_evidence import replay_frame,compare_frame
    expected=replay_frame(row(),identities());bad=copy.deepcopy(expected);bad['attack_direction']=[True,-1]
    with pytest.raises(ValueError):compare_frame(bad,expected)


def context_fixture():
    from timepitch.grf.m1_evidence import replay_frame
    rows=[row(i,i*100,elapsed=i*100) for i in range(15)]
    shots=[dict(raw_seq=1,physics_ms=400,period=1,relocation_id=0,origin='open_play_shot')]
    record=dict(version='m1-shot-context-2',mode='apply',complete=True,overflowed=False,end_ms=1400,
        triggers=shots,observed_contacts=shots,frames=[dict(row=replay_frame(r,identities()),marks=[[],[]],contexts=[None,None],
        designated=[-1,-1,-1],lineage=[]) for r in rows],transactions=[])
    return rows,shots,record


def test_context_v2_is_checked_against_independent_rows_and_contacts():
    from timepitch.grf.m1_evidence import validate_context
    rows,shots,r=context_fixture();receipt=validate_context(r,rows,shots,identities())
    assert receipt['frames']==15 and receipt['selected_contacts']==1 and receipt['posthistory_missing']==0
    bad=copy.deepcopy(r);bad['frames'][1]['row']['players'][0]['position'][0]+=.1
    with pytest.raises(ValueError):validate_context(bad,rows,shots,identities())
    bad=copy.deepcopy(r);bad['triggers'][0]['raw_seq']=2
    with pytest.raises(ValueError):validate_context(bad,rows,shots,identities())


def test_epoch_keys_preserve_both_halftime_frames_and_clip_posthistory():
    from timepitch.grf.m1_evidence import validate_context,replay_frame
    rows=[row(0,0),row(1,100,elapsed=100),row(2,100,period=2,elapsed=0,discontinuity=1)]
    rows[2][19]=1;rows[2][17:19]=[-1,1]
    shots=[dict(raw_seq=1,physics_ms=100,period=1,relocation_id=0,origin='open_play_shot')]
    record=dict(version='m1-shot-context-2',mode='observe',complete=True,overflowed=False,end_ms=100,
        triggers=shots,observed_contacts=shots,frames=[dict(row=replay_frame(r,identities()),marks=[[],[]],contexts=[None,None],
        designated=[-1,-1,-1],lineage=[]) for r in rows],transactions=[])
    receipt=validate_context(record,rows,shots,identities())
    assert receipt['frames']==3 and receipt['reset_boundaries']==[[100,2,1]] and receipt['posthistory_missing']==10
    record['frames'].pop()
    with pytest.raises(ValueError):validate_context(record,rows,shots,identities())


@pytest.mark.parametrize('corruption',['version','frame','duplicate','overflow','end','count','mask','identity','contact'])
def test_corrupted_context_fails(corruption):
    from timepitch.grf.m1_evidence import validate_context
    rows,shots,r=context_fixture()
    if corruption=='version':r['version']='m1-shot-context-1'
    elif corruption=='frame':r['frames'].pop()
    elif corruption=='duplicate':r['frames'][1]=r['frames'][0]
    elif corruption=='overflow':r['overflowed']=True
    elif corruption=='end':r['end_ms']=1300
    elif corruption=='count':r['frames']*=30
    elif corruption=='mask':r['frames'][0]['row']['players'][0]['active']=False
    elif corruption=='identity':r['frames'][0]['row']['players'][0]['id']=9999
    elif corruption=='contact':r['observed_contacts']=[]
    with pytest.raises(ValueError):validate_context(r,rows,shots,identities())


def transaction_fixture():
    players=[dict(id=p['native_stable_id'],team=p['side'],keeper=p['keeper'],active=True,manual=False,ball_contest=False,
        position=[1.,0.] if p['native_stable_id']==301 else [10.,0.] if p['native_stable_id']==302 else [0.,0.]) for p in identities()]
    x=dict(time_ms=400,team=0,period=1,relocation_id=0,dynamic_side=-1,guard_eligible=True,
        own_ids=list(range(300,311)),players=players,threat_ids=[321],quality=[[.9] if i==302 else [.1] for i in range(300,311)],
        actual_prior_marks=[[301,321]])
    return dict(physics_ms=400,team=0,mirror_sign=1,period=1,relocation_id=0,input=x,
        context=dict(initialized=True,team=0,period=1,relocation_id=0,dynamic_side=-1,eligible=True),
        reference_pairs=[[302,321]],pairs=[[301,321]],actual_pairs=[[301,321]],
        reasons=[dict(rank=0,target=321,native_owner=302,reference_owner=302,previous_owner=301,code='close_handover_retained',
            previous_distance_m=1.,native_distance_m=10.)])


def test_guard_and_actual_ownership_are_recomputed():
    from timepitch.grf.m1_evidence import validate_context
    rows,shots,r=context_fixture();r['transactions']=[transaction_fixture()]
    receipt=validate_context(r,rows,shots,identities())
    assert receipt['guards']==receipt['behavioral_changes']==1 and receipt['setters']==12
    r['transactions'][0]['actual_pairs']=[[302,321]]
    with pytest.raises(ValueError):validate_context(r,rows,shots,identities())


def test_valid_sign_and_mirrored_side_are_bound_to_replay_direction():
    from timepitch.grf.m1_evidence import validate_context
    rows,shots,r=context_fixture();tx=transaction_fixture();r['transactions']=[tx]
    tx['mirror_sign']=-1
    with pytest.raises(ValueError,match='mirror'):validate_context(r,rows,shots,identities())
    # Actual mirrored epoch: dynamic side changes, global attack reverses.
    tx['mirror_sign']=1;tx['input']['dynamic_side']=tx['context']['dynamic_side']=1
    for row in rows:row[17:19]=[-1,1]
    for f in r['frames']:f['row']['attack_direction']=[-1,1]
    assert validate_context(r,rows,shots,identities())['guards']==1


@pytest.mark.parametrize('field',['quality','mirror','mapping','reason','epoch','time','duplicate'])
def test_forged_guard_input_and_decision_fails(field):
    from timepitch.grf.m1_evidence import validate_context
    rows,shots,r=context_fixture();tx=transaction_fixture();r['transactions']=[tx]
    if field=='quality':tx['input']['quality'][2]=[.0]
    elif field=='mirror':tx['mirror_sign']=0
    elif field=='mapping':tx['input']['players'][0]['id']=1000
    elif field=='reason':tx['reasons'][0]['previous_distance_m']=.5
    elif field=='epoch':tx['period']=2
    elif field=='time':tx['physics_ms']=500
    elif field=='duplicate':r['transactions'].append(copy.deepcopy(tx))
    with pytest.raises(ValueError):validate_context(r,rows,shots,identities())


def test_zero_shots_is_insufficient_and_does_not_synthesize_a_window():
    from timepitch.grf.m1_evidence import validate_context
    r=dict(version='m1-shot-context-2',mode='observe',complete=True,overflowed=False,end_ms=100,
        triggers=[],observed_contacts=[],frames=[],transactions=[])
    receipt=validate_context(r,[row(),row(1,100,elapsed=100)],[],identities())
    assert receipt['observation']=='insufficient' and receipt['frames']==0


@pytest.mark.parametrize('corruption',['overflow','counter','observe_changes','invalid','regressed_bound'])
def test_full_run_policy_counters_reject_illegal_states(corruption):
    from timepitch.grf.m1_wire import policy_state,COUNTERS
    state=dict(version='m1-policy-counters-1',mode='observe',enabled=True,overflowed=False,**dict.fromkeys(COUNTERS,0))
    if corruption=='overflow':state['overflowed']=True
    elif corruption=='counter':state['ticks']=2000001
    elif corruption=='observe_changes':state['behavioral_changes']=1
    elif corruption=='invalid':state['invalid_inputs']=1
    elif corruption=='regressed_bound':state.update(ticks=1,references=4)
    with pytest.raises(ValueError):policy_state(state,'observe')
