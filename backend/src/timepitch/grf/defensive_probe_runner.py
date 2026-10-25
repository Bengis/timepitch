"""Portable research worker. Its only additional output is the bounded file sidecar."""
from contextlib import redirect_stdout
import base64
import hashlib
import json
import os
from pathlib import Path
import sys
if __package__:
    from .action_runner import ActionCapture
    from .defensive_probe_wire import DefenseSidecarWriter,in_window
    from .physical_wire import canonical
else:
    sys.path.insert(0,str(Path(__file__).resolve().parent))
    from action_runner import ActionCapture
    from defensive_probe_wire import DefenseSidecarWriter,in_window
    from physical_wire import canonical


def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()


def research_identity(descriptor_path,native,sidecar):
    """Verify the actual artifacts before importing the football module."""
    project=Path(__file__).resolve().parents[4]
    expected=project/'research/engine-evaluation/2026-10-17-grf-physical-validation/defensive-probe.json'
    if descriptor_path.resolve()!=expected.resolve():raise ValueError('Canonical research descriptor required')
    d=json.loads(descriptor_path.read_bytes());build_path=project/d['probe_build_manifest'];build=json.loads(build_path.read_bytes())
    output=(project/'.local/grf-defense-native/Release').resolve()
    if (native.resolve()!=output or (project/build['binary_output']).resolve()!=output or
        sidecar.resolve()!=(project/'.local/grf-physical-work/defensive-probe/evidence/D-defense-42/defense.jsonl').resolve() or
        build['build']['exit_code']!=0 or build['previous_native_binary_sha256']!=d['control']['native_sha256'] or
        sha(native/'_gameplayfootball.pyd')!=build['native_binary_sha256'] or build['dependencies']!=d['control']['dependencies']):
        raise ValueError('Research worker artifact binding')
    for name,expected_sha in build['dependencies'].items():
        if Path(name).name!=name or sha(native/name)!=expected_sha:raise ValueError('Research dependency changed')
    identity=dict(input_hash=d['control']['input_hash'],native_sha256=build['native_binary_sha256'],
        descriptor_sha256=sha(descriptor_path),build_manifest_sha256=sha(build_path))
    launch=json.loads(sidecar.with_name('launch.json').read_bytes())
    if launch!=identity:raise ValueError('Missing single-launch witness')
    return d,identity


def observe_sample(engine,writer,windows,row):
    t=int(row[1])
    if in_window(t,windows) is None:return
    snapshot=engine.probe_defense_snapshot()
    if snapshot['enabled'] is not True or snapshot['overflowed'] is not False or snapshot['physics_ms']!=t:
        raise ValueError('Native defense sample clock/overflow')
    writer.append(t,int(row[0]),snapshot['records'])


def main():
    native,descriptor_path,sidecar=(Path(p).resolve() for p in sys.argv[1:])
    descriptor,identity=research_identity(descriptor_path,native,sidecar)
    payload=json.loads(sys.stdin.buffer.read(32769))
    if payload['input_hash']!=identity['input_hash']:raise ValueError('Research input changed')
    project=Path(__file__).resolve().parents[4]
    control=json.loads((project/descriptor['control']['result_path']/'manifest.json').read_bytes())
    if payload!=control['input']:raise ValueError('Research input is not exact retained input')
    sys.path.insert(0,str(native));dll=os.add_dll_directory(str(native))
    assets=Path(sys.executable).parent/'Lib/site-packages/gfootball_engine'
    os.environ['GFOOTBALL_DATA_DIR']=str(assets/'data')
    os.environ['GFOOTBALL_FONT']=str(assets/'fonts/AlegreyaSansSC-ExtraBold.ttf')
    output=sys.stdout
    def emit(value):output.write(canonical(value).decode()+'\n');output.flush()
    core=None;writer=None
    with redirect_stdout(sys.stderr):
        try:
            from native_setup import create_core
            core=create_core(payload)
            for p in payload['players']:
                for name,value in p['attributes'].items():core._env.probe_set_stat(0 if p['side']=='home' else 1,p['slot'],name,value)
            writer=DefenseSidecarWriter(sidecar,identity,descriptor['windows'])
            capture=ActionCapture(core,payload,None,sample_observer=lambda row:observe_sample(core._env,writer,descriptor['windows'],row))
            core._env.probe_enable_defense([(w['start_ms'],w['end_ms']) for w in descriptor['windows']])
            for block in capture:emit(dict(type='chunk',data=base64.b64encode(capture.encode(block)).decode()))
            snapshot=core._env.probe_defense_snapshot()
            if snapshot['enabled'] is not True or snapshot['overflowed'] is not False:raise ValueError('Native defense overflow/disabled')
            manifest=capture.manifest(identity['native_sha256']);writer.finish(manifest['trace_hash'])
            emit(dict(type='manifest',manifest=manifest))
        finally:
            if writer:writer.close()
            if core:core.close()
            dll.close()


if __name__=='__main__':main()
