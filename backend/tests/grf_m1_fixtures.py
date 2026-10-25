"""Synthetic successor and ledger; these roots have no native engine/runtime."""
from pathlib import Path
import hashlib
from grf_action_fixtures import action_trace
from timepitch.grf.physical_wire import canonical,digest


def put(root,name,value):
    path=root/name;path.parent.mkdir(parents=True,exist_ok=True)
    path.write_bytes(canonical(value));return path


def synthetic_launch(root,run_id='M-observe-42'):
    from timepitch.grf import m1_verifier as v
    root=Path(root).resolve();campaign=root/v.RUN_ROOT
    (root/'.local/grf-physical-work').mkdir(parents=True,exist_ok=True)
    files={'backend/src/timepitch/runner.py':b'# fake portable source\n',
        '.local/runtime/python.exe':b'fake runtime, never executed',
        '.local/native/_gameplayfootball.pyd':b'fake native, never loaded',
        '.local/history/checkpoint.json':b'fake terminal parent'}
    for name,raw in files.items():
        p=root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(raw)
    build=put(root,v.STUDY+'/worker-build.json',{'synthetic':True})
    compat=put(root,v.STUDY+'/clock-compatibility.json',{'status':'compatible','synthetic':True})
    h=lambda name:v.sha(root/name)
    payload=action_trace()[0].input.model_dump(mode='json')
    d=dict(schema_version='m1-worker-profile-1',worker_status='offline-validated',native_authorized=False,web_admitted=False,
        parent_profile=v.PARENT,clock_policy=v.POLICY,python_path='.local/runtime/python.exe',native_dir='.local/native',
        native_sha256=h('.local/native/_gameplayfootball.pyd'),build_manifest_sha256=v.sha(build),
        source_sha256={'backend/src/timepitch/runner.py':h('backend/src/timepitch/runner.py')},
        runtime_sha256={'.local/runtime/python.exe':h('.local/runtime/python.exe')},
        static_sha256={'.local/native/_gameplayfootball.pyd':h('.local/native/_gameplayfootball.pyd'),v.STUDY+'/worker-build.json':v.sha(build)},
        parent_sha256={'.local/history/checkpoint.json':h('.local/history/checkpoint.json')},
        inventories=[dict(root='backend/src/timepitch',pattern='*.py',members=['backend/src/timepitch/runner.py']),
            dict(root='.local/runtime',pattern='*',members=['.local/runtime/python.exe']),
            dict(root='.local/native',pattern='*',members=['.local/native/_gameplayfootball.pyd'])],
        payloads={f'{split}/{i:02}':payload for split,n in (('calibration',8),('heldout',24)) for i in range(1,n+1)},
        compatibility_sha256=v.sha(compat),parent=dict(used=41,maximum=72,candidates=5,terminal_id='k1/calibration/03',
            files={'.local/history/checkpoint.json':h('.local/history/checkpoint.json')},heldout_opened=False,selection_sealed=False,legacy_retired=True))
    freeze=put(root,v.FREEZE,d);identity=digest(d)
    put(root,v.WITNESS,dict(schema_version='m1-worker-freeze-witness-1',profile_identity=identity,descriptor_sha256=v.sha(freeze)))
    approval=dict(schema_version='m1-worker-user-approval-1',profile_identity=identity,explicit_native=True,execute_phase=5,
        maximum=76,candidate_limit=6,run_ids=list(v.ALL_IDS),clock_policy=v.POLICY,user_statement='synthetic test only')
    put(campaign,'approval.json',approval)
    grant=dict(schema_version='m1-worker-authorization-1',profile_identity=identity,maximum=76,parent_used=41,parent_candidates=5,
        candidate_limit=6,run_ids=list(v.ALL_IDS),clock_policy=v.POLICY,compatibility_sha256=d['compatibility_sha256'],
        parent_snapshot=d['parent'],approval_sha256=v.sha(campaign/'approval.json'))
    for name in ('authorization.json','supplement.json','authorization-witness.json'):put(campaign,name,grant)
    put(root,v.ANCHOR,grant)
    state=dict(schema_version='m1-ledger-1',grant_sha256=digest(grant),runs={run_id:dict(state='reserved',profile_identity=identity,
        payload_sha256=digest(payload),result_sha256=None)},terminal_failure=None,observe_proof=None,
        calibration_report=None,selection=None,heldout_opened=False)
    if run_id!='M-observe-42':
        state['runs']['M-observe-42']=dict(state='ready');state['observe_proof']={'synthetic':True}
    write_state(campaign,state,grant)
    evidence=campaign/'evidence'/run_id;evidence.mkdir(parents=True)
    who=dict(run_id=run_id,mode=v.mode_for(run_id),input_hash=payload['input_hash'],native_sha256=d['native_sha256'],profile_identity=identity,
        build_manifest_sha256=d['build_manifest_sha256'])
    if '/heldout/' not in run_id:put(evidence,'launch.json',dict(identity=who,grant_sha256=digest(grant)))
    return campaign,payload,d


def write_state(campaign,state,grant):
    put(campaign,'checkpoint.json',state)
    raw=canonical(dict(seq=0,previous=hashlib.sha256(b'').hexdigest(),checkpoint=digest(state),event={'type':'synthetic reserve'}))+b'\n'
    (campaign/'events.jsonl').write_bytes(raw)
    receipt=dict(grant_sha256=digest(grant),checkpoint_sha256=digest(state),events_sha256=hashlib.sha256(raw).hexdigest())
    for name in ('registration.json','initialized.json'):put(campaign,name,receipt)
