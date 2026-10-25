"""Portable source-bound research worker. Football is imported only after all bindings."""
from contextlib import redirect_stdout
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import sys
if __package__:
    from .action_runner import ActionCapture
    from .candidate_wire import normalize_payload,normalize_state,write_policy
    from .physical_wire import canonical,digest
else:
    sys.path.insert(0,str(Path(__file__).resolve().parent))
    from action_runner import ActionCapture
    from candidate_wire import normalize_payload,normalize_state,write_policy
    from physical_wire import canonical,digest


def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def read(path):return json.loads(path.read_bytes())
def old_digest(value):return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest()


def worker_identity(native,root,run_id,payload):
    project=Path(__file__).resolve().parents[4]
    if root.resolve()!=(project/'.local/grf-physical-work/continuation').resolve():raise ValueError('Canonical continuation required')
    if not re.fullmatch(r'(c[45]/calibration/0[1-8]|selected/heldout/(0[1-9]|1[0-9]|2[0-4]))',run_id):raise ValueError('Original run ID required')
    state=read(root/'checkpoint.json');registration=read(root.parent/'continuation-registration.json')
    if registration!=dict(root=str(root),identity=state['identity'],parent_sha256=state['campaign']['parent_sha256'],checkpoint_sha256=old_digest(state)):
        raise ValueError('Reserved campaign changed')
    entry=state['runs'][run_id]
    if entry['state']!='reserved':raise ValueError('Already consumed or unreserved child')
    if run_id.startswith('selected/'):
        selection=read(root/'selection/freeze.json')
        expected=dict(root=str(root),identity=digest(selection),freeze_sha256=sha(root/'selection/freeze.json'))
        if read(root.parent/'continuation-selection-registration.json')!=expected or read(root.parent/'continuation-selection-initialized.json')!=expected:
            raise ValueError('Selection witness changed')
        candidate=selection['candidate_id']
    else:candidate=run_id.split('/')[0]
    if candidate not in ('c4','c5'):raise ValueError('Unknown candidate')
    binding_path=root/'candidate-bindings'/f'{candidate}.json';binding=read(binding_path)
    expected=dict(root=str(root),identity=digest(binding),binding_sha256=sha(binding_path))
    if read(root.parent/f'continuation-{candidate}-registration.json')!=expected or read(root.parent/f'continuation-{candidate}-initialized.json')!=expected:
        raise ValueError('Candidate witness changed')
    profile=binding['native_profile'];key='/'.join(run_id.split('/')[1:])
    expected_native=(project/f'.local/grf-{candidate}-native/Release').resolve()
    if native.resolve()!=expected_native or (project/profile['native_dir']).resolve()!=expected_native or payload!=binding['payloads'][key]:
        raise ValueError('Worker native/input changed')
    spec=dict(id=run_id,group=run_id.split('/')[1],input_hash=payload['input_hash'],native_sha256=profile['native_sha256'],maximum_ms=7440000)
    if entry['spec']!=spec or sha(native/'_gameplayfootball.pyd')!=profile['native_sha256']:raise ValueError('RunSpec/native mismatch')
    for name,h in {**binding['native_files'],**binding['measurement_sha256']}.items():
        path=(project/name).resolve()
        if not path.is_relative_to(project) or sha(path)!=h:raise ValueError('Worker source/artifact binding changed')
    identity=dict(run_id=run_id,input_hash=payload['input_hash'],native_sha256=profile['native_sha256'],
        profile_identity=digest(binding),build_manifest_sha256=profile['build_manifest_sha256'])
    evidence=root/'evidence'/run_id
    if read(evidence/'launch.json')!=identity:raise ValueError('Missing exclusive launch witness')
    if run_id.startswith('selected/') and (selection['profile_identity']!=identity['profile_identity'] or selection['heldout_payload_hashes'][key.split('/')[1]]!=digest(payload)):
        raise ValueError('Heldout payload differs from sealed selection')
    return identity,dict(policy_version=profile['policy_version'],policy=profile['policy']),evidence/'policy.json'


def main():
    native,root=map(lambda p:Path(p).resolve(),sys.argv[1:3]);run_id=sys.argv[3]
    payload=json.loads(sys.stdin.buffer.read(32769));identity,spec,path=worker_identity(native,root,run_id,payload)
    payload=normalize_payload(payload)  # Before scenario/core creation, not only before readback.
    sys.path.insert(0,str(native));dll=os.add_dll_directory(str(native))
    assets=Path(sys.executable).parent/'Lib/site-packages/gfootball_engine'
    os.environ['GFOOTBALL_DATA_DIR']=str(assets/'data');os.environ['GFOOTBALL_FONT']=str(assets/'fonts/AlegreyaSansSC-ExtraBold.ttf')
    output=sys.stdout;core=None
    def emit(value):output.write(canonical(value).decode()+'\n');output.flush()
    with redirect_stdout(sys.stderr):
        try:
            from native_setup import create_core
            core=create_core(payload)
            for p in payload['players']:
                for name,value in p['attributes'].items():core._env.probe_set_stat(0 if p['side']=='home' else 1,p['slot'],name,value)
            start=dict(core._env.probe_intervention_state());normalize_state(start,spec,initial=True)
            capture=ActionCapture(core,payload,None)
            for block in capture:emit(dict(type='chunk',data=base64.b64encode(capture.encode(block)).decode()))
            final=dict(core._env.probe_intervention_state());manifest=capture.manifest(identity['native_sha256'])
            write_policy(path,identity,spec,start,final,manifest['trace_hash'])
            emit(dict(type='manifest',manifest=manifest))
        finally:
            if core:core.close()
            dll.close()


if __name__=='__main__':main()
