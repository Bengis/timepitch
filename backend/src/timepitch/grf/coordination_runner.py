"""Portable K1 worker. All bindings and exclusive claim precede native import."""
import argparse
from contextlib import redirect_stdout
import base64
import json
import os
from pathlib import Path
import sys
from types import SimpleNamespace


def worker_identity(native,root,run_id,payload):
    # The package initializers contain only docstrings; these verifiers are stdlib only.
    sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
    from timepitch.grf.coordination_profile import PROJECT_ROOT,load_coordination_document,NATIVE,RUN_ROOT,sha
    from timepitch.grf.coordination_budget import CoordinationLedger
    from timepitch.grf.physical_wire import canonical,digest
    from timepitch.grf.coordination_wire import identity as check_identity
    project=PROJECT_ROOT;value=load_coordination_document(project)
    if root.resolve()!=(project/RUN_ROOT).resolve() or native.resolve()!=(project/NATIVE/'Release').resolve():raise ValueError('Canonical private worker paths required')
    mode='observe' if run_id=='K-observe-42' else 'apply'
    identity=dict(run_id=run_id,input_hash=payload['input_hash'],native_sha256=value['native_sha256'],
        profile_identity=digest(value),build_manifest_sha256=value['build_manifest_sha256'])
    check_identity(identity,mode)
    key='calibration/01' if mode=='observe' else '/'.join(run_id.split('/')[1:])
    if payload!=value['payloads'][key]:raise ValueError('Full frozen worker payload differs')
    profile=SimpleNamespace(project=project,identity=identity['profile_identity'],native_sha256=value['native_sha256'],
        payload=lambda key:value['payloads'][key])
    ledger=CoordinationLedger(root,profile)
    ledger.verify_reserved(run_id,SimpleNamespace(input_hash=payload['input_hash'],model_dump=lambda **_:payload))
    if '/heldout/' in run_id:ledger.verify_selection()
    evidence=root/'evidence'/run_id;launch=json.loads((evidence/'launch.json').read_bytes())
    if launch!=dict(identity=identity,mode=mode):raise ValueError('Exclusive launch witness mismatch')
    with (evidence/'worker-claimed.json').open('xb') as f:f.write(canonical(launch));f.flush();os.fsync(f.fileno())
    return identity,mode,evidence


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('native',type=Path);parser.add_argument('root',type=Path);parser.add_argument('run_id')
    args=parser.parse_args()  # --help exits before loading any profile, assets or native code.
    sys.path.insert(0,str(Path(__file__).resolve().parents[2]));sys.path.insert(0,str(Path(__file__).resolve().parent))
    from timepitch.grf.coordination_wire import CoordinationWriter,coordination_state,policy_value,write_coordination_policy,_json
    from timepitch.grf.candidate_wire import normalize_payload
    from timepitch.grf.physical_wire import canonical
    payload=_json(sys.stdin.buffer.read(32769))
    if len(canonical(payload))>32768:raise ValueError('Worker input exceeds32KiB')
    native=args.native.resolve();root=args.root.resolve()
    identity,mode,evidence=worker_identity(native,root,args.run_id,payload)
    payload=normalize_payload(payload)  # Stable native attribute application order, before core creation.
    sys.path.insert(0,str(native));dll=os.add_dll_directory(str(native))
    assets=Path(sys.executable).parent/'Lib/site-packages/gfootball_engine'
    os.environ['GFOOTBALL_DATA_DIR']=str(assets/'data');os.environ['GFOOTBALL_FONT']=str(assets/'fonts/AlegreyaSansSC-ExtraBold.ttf')
    output=sys.stdout;core=None
    def emit(value):output.write(canonical(value).decode()+'\n');output.flush()
    with redirect_stdout(sys.stderr):
        try:
            from native_setup import create_core
            from timepitch.grf.action_runner import ActionCapture
            core=create_core(payload)
            for p in payload['players']:
                for name,value in p['attributes'].items():core._env.probe_set_stat(0 if p['side']=='home' else 1,p['slot'],name,value)
            writer=CoordinationWriter(evidence/'coordination.jsonl',identity,mode)
            def sample(row):
                state=coordination_state(_json(core._env.probe_coordination_state()),mode)
                frame=core._env.probe_coordination_snapshot(int(row[1]),int(row[2]),int(row[19]))
                transactions=[_json(s) for s in core._env.probe_drain_coordination()]
                writer.append(row,_json(frame) if frame else None,transactions)
            capture=ActionCapture(core,payload,None,sample_observer=sample)
            core._env.probe_enable_coordination(mode)
            base_start=dict(core._env.probe_intervention_state());start=coordination_state(_json(core._env.probe_coordination_state()),mode,initial=True)
            for block in capture:emit(dict(type='chunk',data=base64.b64encode(capture.encode(block)).decode()))
            manifest=capture.manifest(identity['native_sha256']);writer.finish(manifest['trace_hash'])
            final=coordination_state(_json(core._env.probe_coordination_state()),mode)
            policy=policy_value(identity,mode,manifest['trace_hash'],base_start,dict(core._env.probe_intervention_state()),start,final)
            write_coordination_policy(evidence/'policy.json',policy);emit(dict(type='manifest',manifest=manifest))
        finally:
            if core:core.close()
            dll.close()
if __name__=='__main__':main()
