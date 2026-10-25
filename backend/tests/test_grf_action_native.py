"""Eight continuation cases, eleven cumulative processes including TP033.

Directed F3-r2/F4 failures are retained after the explicitly authorized TP034
combined-evidence acceptance; do not relaunch cases to make them pass.
"""
import json
import os
import pytest
from grf_action_native_helpers import ROOT,CONTINUATION_LIMITS,run_action_case,read_segment
from timepitch.grf.action_models import ActionInput
from timepitch.grf.physical_models import ActivityInput

pytestmark=pytest.mark.skipif(os.getenv('TIMEPITCH_TEST_GRF_ACTIONS')!='1',reason='Explicit ledgered action-native acceptance required')
WORK=ROOT/'.local/grf-action-work/acceptance'


@pytest.mark.parametrize('case_id',list(CONTINUATION_LIMITS))
def test_ledgered_native_case(case_id):
    result=run_action_case(case_id,WORK)
    frozen=json.loads((ROOT/'research/engine-evaluation/2026-10-17-grf-actions/acceptance-r2.json').read_text())
    spec=frozen['cases'][case_id]
    request=(ActionInput if spec['kind']=='actions' else ActivityInput).model_validate(frozen['inputs'][spec['input']])
    blocks,segment,_=read_segment(WORK/case_id/'stdout.jsonl',request,native_sha256=frozen['files'][spec['native_dir']+'/_gameplayfootball.pyd'])
    assert len(segment['readbacks'])==66
    assert segment['physics_ms']==spec['maximum_ms'] and result['peak_private_bytes']>0
    if spec['kind']=='control':return
    fixture_id=case_id.split('-')[0]
    events=[e for c in blocks for e in c.semantic_events]
    raw={e.seq:(e,r) for c in blocks for e,r in zip(c.events,c.contact_roles)}
    releases=[e for e in events if e.kind=='release']
    if fixture_id=='F1':
        hand=[e for e in releases if e.intent=='pass' and e.origin=='retainer_distribution']
        assert hand,'Keeper fixture did not exercise a native distribution release'
        first=hand[0];retained=[e for e,r in raw.values() if r==1 and e.actor_team==first.actor_team and e.player==first.slot and e.actual_time_ms<first.physics_ms]
        assert len(retained)>1,'Keeper must retain before releasing'
        assert sum(e.release_key==first.release_key for e in releases)==1
        assert any(e.kind=='retention_start' and e.slot==first.slot for e in events)
        assert any(e.kind=='retention_end' and e.retention_end_reason=='released' for e in events)
    elif fixture_id=='F2':
        throws=[e for e in releases if e.intent=='pass' and e.origin=='set_piece_pass' and e.restart_kind=='throw_in']
        assert throws,'Throw-in fixture did not exercise a native pass release'
        assert any(raw[e.raw_event_seq][0].touch_type==1 for e in throws),'Expected non-kicked throw-in contact'
    elif fixture_id=='F3':
        clearances=[e for e in releases if e.origin=='emergency_clearance']
        assert clearances,'Pressure fixture did not exercise emergency release'
        assert all(e.intent=='clearance' for e in clearances)
        assert {raw[e.raw_event_seq][0].kind for e in clearances}>={'shot','high_pass'},'Both native emergency animation routes must be observed'
    elif case_id=='F4':
        from timepitch.grf.action_statistics import _ActionAccumulator
        from timepitch.grf.action_codec import ActionStreamValidator
        reducer=_ActionAccumulator(request.players);validator=ActionStreamValidator(request,frozen['files'][spec['native_dir']+'/_gameplayfootball.pyd'])
        for c in blocks:
            validator.append(c)
            watermark=min([c.samples[-1][1],*(e.actual_time_ms for e,_,_ in validator.pending.values())])
            reducer.add_chunk(c,watermark)
        outcome=reducer.finish(segment['physics_ms'],1)
        assert any(p.outcome=='intercepted' for p in outcome['passes']),'Expected a native deliberate rival control after pass release'
        assert any(e.kind=='control' for e in events)
        rows={int(r[0]):r for c in blocks for r in c.samples}
        assert any((rows[e.sample_index][13],rows[e.sample_index][14])!=(e.actor_team,e.slot) for e in releases),'Expected anticipatory contact without sampled ownership'
    else:
        control_id=case_id.replace('-actions','-control');control_spec=frozen['cases'][control_id]
        control_request=ActivityInput.model_validate(frozen['inputs'][control_spec['input']])
        controls,control,_=read_segment(WORK/control_id/'stdout.jsonl',control_request)
        assert segment['observations_sha256']==control['observations_sha256']
        assert segment['observation_count']==control['observation_count']
        assert segment['readbacks']==control['readbacks']
        assert [c.samples for c in blocks]==[c.samples for c in controls]
        assert [c.events for c in blocks]==[c.events for c in controls]
        assert [c.activity for c in blocks]==[c.activity for c in controls]
