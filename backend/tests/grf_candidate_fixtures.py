"""Fake budget/native files; catalogue inputs are real, no football can load."""
import copy
import json
from pathlib import Path
import shutil
from timepitch.grf import physical_campaign_budget as budget
from timepitch.grf.physical_wire import canonical
from test_grf_candidate_profiles import ROOT,api


def seed_project(tmp_path,monkeypatch):
    m=api();monkeypatch.setattr(budget,'PROJECT_ROOT',tmp_path)
    for name in [m.CAMPAIGN,m.DESIGN,m.STUDY+'/intervention.json',
                 'research/data-audit/2026-10-16/derived/coverage.sqlite',
                 '.local/grf-physical-work/benchmark/checkpoint.json']:
        dest=tmp_path/name;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(ROOT/name,dest)
    shutil.copytree(ROOT/'backend/src/timepitch',tmp_path/'backend/src/timepitch',ignore=shutil.ignore_patterns('__pycache__'))
    campaign=budget._read(tmp_path/m.CAMPAIGN);root=tmp_path/'.local/grf-physical-work/continuation'
    budget.initialize_continuation(tmp_path/campaign['parent_checkpoint'],campaign,root,approved=True)
    raw=json.loads((ROOT/m.STUDY/'c4-profile.json').read_bytes())
    native=tmp_path/raw['native_dir'];native.mkdir(parents=True)
    (native/'_gameplayfootball.pyd').write_bytes(b'Fake nonloadable native file for isolated ledger tests')
    raw['native_sha256']=budget._sha(native/'_gameplayfootball.pyd')
    for i,name in enumerate(raw['dependencies']):(native/name).write_bytes(f'Synthetic dependency {i}'.encode())
    raw['dependencies']={p.name:budget._sha(p) for p in native.glob('*.dll')}
    native_profile=tmp_path/m.STUDY/'c4-profile.json';native_profile.write_bytes(canonical(raw))
    paths=[native_profile,*native.iterdir()]
    refs={p.relative_to(tmp_path).as_posix():budget._sha(p) for p in paths}
    def fake_native(project,candidate):
        if project!=tmp_path or candidate!='c4':raise ValueError('No C5 fake/native')
        return copy.deepcopy(raw),dict(refs)
    # Only the native-file loader is doubled; production registration/hash guards remain real.
    monkeypatch.setattr(m,'_native_artifacts',fake_native)
    return m,root,campaign


def bind(tmp_path,monkeypatch):
    m,root,campaign=seed_project(tmp_path,monkeypatch)
    return m,root,campaign,m.bind_candidate_profile(tmp_path,'c4',root)


def reserve(root,profile,id='c4/calibration/01'):
    key='/'.join(id.split('/')[1:])
    return budget.reserve_run(root,budget.RunSpec(id,id.split('/')[1],profile.payloads[key]['input_hash'],profile.native_sha256,7440000))


def save_ready_report(root,profile,*,eligible=False):
    from test_grf_action_gates import rows,eligible_rows
    from timepitch.grf.action_gates import evaluate_action_gates
    values=eligible_rows() if eligible else rows(candidate=profile.id)
    for r in values:
        id=profile.id+'/calibration/'+r['fixture_id'];key='calibration/'+r['fixture_id']
        if profile.id=='c5':r['policy_counters']['area_slide_rejected']=1
        r.update(profile_identity=profile.identity,input_hash=profile.payloads[key]['input_hash'],
            native_binary_sha256=profile.native_sha256,trace_hash='e'*64)
        reserve(root,profile,id)
        path=root/'evidence'/id;path.mkdir(parents=True,exist_ok=True)
        (path/'manifest.json').write_bytes(b'{}')
        (path/'measurement.json').write_bytes(canonical(r))
        files={p.name:budget._sha(p) for p in path.iterdir()}
        budget.finish_run(root,id,state='ready',evidence=dict(result_path=path.relative_to(root).as_posix(),files=files))
    report=dict(schema_version='grf-action-campaign-report-1',candidate_id=profile.id,split='calibration',
        profile_identity=profile.identity,rows=values,gates=evaluate_action_gates(values,expected=8))
    report['qualified']=all(report['gates'].values())
    path=root/'reports'/f'{profile.id}-calibration.json';path.parent.mkdir(exist_ok=True);path.write_bytes(canonical(report))
    return report


def bind_fake_c5(project,monkeypatch,m,root,c4):
    import copy
    from timepitch.grf.candidate_wire import float_bits
    raw=copy.deepcopy(m.read_native_profile(project,'c4'));raw.update(id='c5',policy_version='c5-marking-area-risk-1',
        native_dir='.local/grf-c5-native/Release',parent_profile_sha256=budget._sha(project/m.STUDY/'c4-profile.json'))
    raw['policy']['own_area_duel_floor']=.9;raw['expected_float32_bits']['own_area_duel_floor']=float_bits(.9)
    path=project/raw['native_dir'];path.mkdir(parents=True)
    (path/'_gameplayfootball.pyd').write_bytes(b'Fake incremental C5; never load')
    raw['native_sha256']=budget._sha(path/'_gameplayfootball.pyd')
    for name in raw['dependencies']:shutil.copy2(c4.native_dir/name,path/name)
    profile_path=project/m.STUDY/'c5-profile.json';profile_path.write_bytes(canonical(raw))
    refs={p.relative_to(project).as_posix():budget._sha(p) for p in [profile_path,*path.iterdir()]}
    previous=m._native_artifacts
    def native(where,candidate):
        if candidate=='c5':return copy.deepcopy(raw),dict(refs)
        return previous(where,candidate)
    monkeypatch.setattr(m,'_native_artifacts',native)
    return m.bind_candidate_profile(project,'c5',root)
