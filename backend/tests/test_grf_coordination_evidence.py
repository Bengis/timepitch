"""Offline ownership evidence and immutable historical-source boundaries."""
import hashlib
import importlib
import importlib.util
import json
from copy import deepcopy
from pathlib import Path

import pytest


def api():
    name = 'timepitch.grf.coordination_evidence'
    assert importlib.util.find_spec(name) is not None, 'Missing retained coordination evidence'
    return importlib.import_module(name)


def frame(t, target=5, *, active=True, **context):
    return dict(physics_ms=t, sample_index=t // 100,
        context=dict(period=1, relocation_id=0, discontinuity=False, **context),
        records=[dict(team=1, slot=2, active=active, evaluation_available=True,
            evaluation_ms=t, evaluation_sequence=t//100,
            current_position=[0, 0, 0], geometrically_nearest_opponent=9,
            fields=dict(values=dict(marker_target_team=0, marker_target_slot=target, dynamic_role=1)))])


def shot(*, phase='open_play', goal=True, distance=5):
    return dict(phase_class=phase, goal=goal, raw_event_seq=1, period=1,
        contact_nearest_outfield_m=distance, minimum_nearest_outfield_last_2s_m=distance,
        last_confirmed_receipt=None,
        snapshots=[dict(offset_ms=-2000, nearest_outfield_distance_m=distance,
            goal_side_outfield=2, goal_side_DEF=1)])


def test_marking_is_not_nearest_player():
    r=api().summarize_probe([frame(100)])
    assert r['observed_targets'][0]['target_slot']==5
    assert r['native_assignment_transactions'] is None
    assert 'geometrically_nearest_opponent' not in json.dumps(r)


def test_cached_transition_is_not_atomic_handover():
    r=api().summarize_probe([frame(100),frame(200,9)])
    assert len(r['cached_target_transitions'])==1
    assert r['cached_target_transitions'][0]['kind']=='observed_cached_target_change'
    assert r['native_assignment_transactions'] is None


def test_sparse_inputs_remain_unavailable():
    f=frame(100);f['records'][0]['fields']['values']={}
    r=api().summarize_probe([f])
    assert r['observed_targets'][0]['availability']=='unavailable'
    assert r['quality_matrix'] is None and r['formation_targets'] is None
    assert r['observed_targets'][0]['target_slot'] is None


@pytest.mark.parametrize('barrier',['gap','reset','half','inactive','missing_context','old_evaluation'])
def test_reset_halftime_inactive_gap_blocks_history(barrier):
    a,b=frame(100),frame(200,9)
    frames=[a,b]
    if barrier=='gap':b['physics_ms']=400;b['sample_index']=4;b['records'][0]['evaluation_ms']=390
    elif barrier=='reset':b['context']['relocation_id']=1;b['context']['discontinuity']=True
    elif barrier=='half':b['context']['period']=2
    elif barrier=='inactive':frames=[a,frame(200,active=False),frame(300,9)]
    elif barrier=='missing_context':b.pop('context')
    else:b['context']['discontinuity']=True;b['records'][0]['evaluation_ms']=50
    assert api().summarize_probe(frames)['cached_target_transitions']==[]


def test_penalties_not_open_play():
    r=api().summarize_shots([shot(),shot(phase='penalty'),shot(phase='other_set_piece_or_unknown')])
    assert r['open_play_goals']['n']==1
    assert r['open_play_goals']['rival_at_least_4m']==1
    assert r['context_shots']==3 and r['penalty_shots']==1


def test_missing_history_does_not_count_as_coverage():
    s=shot();s['snapshots']=[];s['minimum_nearest_outfield_last_2s_m']=None
    r=api().summarize_shots([s])
    assert r['open_play_goals']['no_goal_side_outfield'] is None
    assert r['open_play_goals']['last_frame_available']==0
    assert r['open_play_goals']['already_wide_2s_before']==0
    assert r['open_play_goals']['two_second_snapshot_available']==0


def test_probe_does_not_mutate_input_or_claim_gameplay_outcome():
    frames=[frame(100),frame(200,9)];before=deepcopy(frames)
    r=api().summarize_probe(frames)
    assert frames==before
    assert not {'qualified','predicted_goals','calibrated'} & set(r)


def fake_archive(root):
    module=api();archive=root/module.ARCHIVE
    source={f'backend/src/timepitch/f{i}.py':hashlib.sha256(b'old\n').hexdigest() for i in range(108)}
    source['backend/src/timepitch/grf/assets.json']=hashlib.sha256(b'old\n').hexdigest()
    for name in source:
        path=archive/'source'/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(b'old\n')
        live=root/name;live.parent.mkdir(parents=True,exist_ok=True);live.write_bytes(b'old\n')
    record=dict(schema_version='grf-coordination-legacy-source-1',archive=module.ARCHIVE,
        archived_from_commit='a'*40,profile_identity='b'*64,source_count=109,
        measurement_sha256=source,parent_files={},evidence_sha256={},reference_analysis_sha256='c'*64,
        usage_at_archive=dict(used=37,candidates=4),accepted_probe_files=175)
    raw=json.dumps(record,sort_keys=True,separators=(',',':')).encode()
    path=root/module.STUDY/'legacy-source-binding.json';path.parent.mkdir(parents=True);path.write_bytes(raw)
    marker=dict(schema_version='grf-coordination-archive-witness-1',binding_sha256=hashlib.sha256(raw).hexdigest(),
        profile_identity=record['profile_identity'],source_count=109,archived_from_commit=record['archived_from_commit'])
    for p in (archive/'initialized.json',root/module.ARCHIVE_WITNESS):p.write_text(json.dumps(marker))
    return archive,path


def test_parent_archive_is_not_refreshed_after_source_change(tmp_path):
    module=api();archive,binding=fake_archive(tmp_path);before=binding.read_bytes()
    old=tmp_path/'backend/src/timepitch/f0.py';old.write_bytes(b'new\n')
    (tmp_path/'backend/src/timepitch/new.py').write_bytes(b'added\n')
    result=module.verify_source_archive(tmp_path)
    assert result['historical_source_files']==109
    assert result['live_source_closure_matches'] is False
    assert result['live_modified']==['backend/src/timepitch/f0.py']
    assert result['live_added']==['backend/src/timepitch/new.py']
    assert binding.read_bytes()==before
    assert (archive/'source/backend/src/timepitch/f0.py').read_bytes()==b'old\n'


@pytest.mark.parametrize('failure',['source','binding','witness','both_witnesses','outside_path'])
def test_changed_or_missing_archive_fails_closed(tmp_path,failure):
    module=api();archive,binding=fake_archive(tmp_path)
    if failure=='source':(archive/'source/backend/src/timepitch/f0.py').write_bytes(b'changed')
    elif failure=='binding':binding.write_bytes(binding.read_bytes()+b' ')
    elif failure=='witness':(archive/'initialized.json').unlink()
    elif failure=='both_witnesses':
        (archive/'initialized.json').unlink();(tmp_path/module.ARCHIVE_WITNESS).unlink()
    else:
        # The witness is rebound, but an archive may still never read outside its root.
        data=json.loads(binding.read_text());data['archive']='../elsewhere';binding.write_text(json.dumps(data))
    with pytest.raises(ValueError):module.verify_source_archive(tmp_path)


def test_mixed_trace_diagnostic_rejected():
    module=api()
    fixture=module.FixtureEvidence('x',{'trace_hash':'a'}, {'trace_hash':'b'}, {'trace_hash':'a'}, {'trace_hash':'a'}, None)
    with pytest.raises(ValueError,match='identity'):module.analyze_coordination(module.EvidenceInputs((fixture,)))


def geometry_fixture(*,barrier=False):
    from grf_action_fixtures import action_trace
    from grf_physical_fixtures import row
    fields={f'away_{slot}_{axis}_m':value for slot in range(1,11)
        for axis,value in (('x',20),('y',20))}
    fields.update(home_9_x_m=40,home_9_y_m=0,away_1_x_m=42,away_1_y_m=0)
    rows=[row(i,i*100,elapsed=i*100,in_play=1,**fields) for i in range(3)]
    if barrier:rows[1][7]=1
    manifest,chunks=action_trace(rows=rows)
    key=dict(trace_hash=manifest.trace_hash,input_hash=manifest.input.input_hash)
    actions=dict(**key,shots=[dict(actor_team=0,slot=9,period=1,origin='open_play_shot',raw_event_seq=1,
        context=dict(available=True,frame_sample_index=1,attack_direction=1,actor_xy_m=[44,0]))])
    defense=dict(**key,shots=[shot()])
    summary=dict(**key,score=[0,0],players=[dict(id='inactive',coverage=None,periods=[dict(period=2,active_ms=0,distance_m=None)])])
    return api().FixtureEvidence('c4/01',actions,defense,summary,manifest.model_dump(mode='json'),lambda:iter(chunks))


def test_collective_geometry_uses_shooter_and_defenders_from_same_frame():
    r=api().analyze_coordination(api().EvidenceInputs((geometry_fixture(),))).as_dict()
    f=r['fixtures'][0]
    assert f['geometry']['shots']==1
    # The shooter was x40 at the frame, x44 at contact: x42 is goal-side only in the same frame.
    assert f['geometry']['rows'][0]['central_goal_side_outfield']==1
    assert f['geometry']['native_ownership'] is None
    assert f['player_coverage']['n']==0
    assert f['missing_half_exposure']==[dict(player_id='inactive',period=2,active_ms=0)]
    assert f['geometry']['period']=={'1':{'shots':1}}
    assert f['geometry']['defending_side']=={'away':{'shots':1}}


def test_geometry_cannot_cross_reset_even_with_stale_diagnostic():
    with pytest.raises(ValueError,match='discontinuity'):
        api().analyze_coordination(api().EvidenceInputs((geometry_fixture(barrier=True),)))


def test_same_cached_identity_cannot_change_target():
    a,b=frame(100),frame(200,9)
    b['records'][0]['evaluation_sequence']=a['records'][0]['evaluation_sequence']
    b['records'][0]['evaluation_ms']=a['records'][0]['evaluation_ms']
    with pytest.raises(ValueError,match='Cached evaluation changed'):api().summarize_probe([a,b])


def test_missing_sample_chunks_does_not_fabricate_zero_pressure():
    from dataclasses import replace
    fixture=replace(geometry_fixture(),chunks=None)
    result=api().analyze_coordination(api().EvidenceInputs((fixture,))).as_dict()['fixtures'][0]['geometry']
    assert result['availability']=='unavailable'
    assert result['eligible_shots']==1 and result['shots']==0
    assert result['no_central_goal_side'] is None and result['nearest_overload'] is None


def test_input_hash_mismatch_rejected_even_when_trace_label_matches():
    fixture=geometry_fixture();fixture.summary['input_hash']='wrong'
    with pytest.raises(ValueError,match='input identity'):
        api().analyze_coordination(api().EvidenceInputs((fixture,)))


def test_offline_analysis_never_imports_football(monkeypatch):
    import builtins
    original=builtins.__import__
    def guarded(name,*args,**kwargs):
        assert not name.startswith(('football','gfootball','_gameplayfootball'))
        return original(name,*args,**kwargs)
    monkeypatch.setattr(builtins,'__import__',guarded)
    assert api().analyze_coordination(api().EvidenceInputs((geometry_fixture(),))).as_dict()['fixtures']
