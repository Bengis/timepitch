"""Fixed private M1 child. Verification and exclusive claim precede imports."""
import argparse
import base64
from contextlib import redirect_stdout
from dataclasses import fields
import os
from pathlib import Path
import sys


def capture_worker(core,payload,launch,emit):
    """Internal core seam, exercised with fake actors only in the offline suite."""
    from timepitch.grf.m1_capture import M1Capture
    from timepitch.grf.m1_wire import write_exclusive,write_context,policy_state
    from timepitch.grf.shot_context_wire import _json,MAX_EXPANDED
    from timepitch.grf.physical_wire import digest
    capture=None;env=core._env
    try:
        capture=M1Capture(core,payload,launch)
        initial=policy_state(_json(env.probe_m1_policy_state()),launch.mode,initial=True)
        base_start=dict(env.probe_intervention_state())
        for block in capture:emit(dict(type='chunk',data=base64.b64encode(capture.encode(block)).decode()))
        manifest=capture.manifest(launch.native_sha256)
        final=policy_state(_json(env.probe_m1_policy_state()),launch.mode)
        context=env.probe_finish_shot_context_v2(True)
        if type(context) is not str or len(context.encode())>MAX_EXPANDED:raise ValueError('Context getter budget')
        write_context(launch.evidence/'contexts.zlib',launch.identity,manifest['trace_hash'],_json(context))
        write_exclusive(launch.evidence/'policy.json',dict(version='m1-worker-policy-1',identity=launch.identity,
            trace_hash=manifest['trace_hash'],mapping=capture.mapping,start=initial,final=final,
            base_start=base_start,base_final=dict(env.probe_intervention_state())))
        emit(dict(type='manifest',manifest=manifest))
    except Exception as error:
        # No complete manifest. A prefix hash is explicitly a different identity.
        prefix_hash=digest(capture.refs if capture is not None else [])
        clock=None
        if capture is not None:
            clock={f.name:getattr(capture.clock,f.name) for f in fields(capture.clock) if f.name!='ledger'}
            clock['ledger_entries']=len(capture.clock.ledger)
        failure=dict(type='failure',error_type=type(error).__name__,error=str(error)[:1000],
            last_observed_ms=capture.last_observed_ms if capture is not None else None,
            last_emitted_ms=capture.refs[-1]['physics_end'] if capture is not None and capture.refs else None,
            clock=clock,prefix_hash=prefix_hash)
        try:
            context=env.probe_finish_shot_context_v2(False)
            if type(context) is not str or len(context.encode())>MAX_EXPANDED:raise ValueError('Partial context budget')
            write_context(launch.evidence/'partial-contexts.zlib',launch.identity,prefix_hash,_json(context))
            failure['partial_context']='partial-contexts.zlib'
        except Exception as diagnostic_error:failure['partial_context_error']=type(diagnostic_error).__name__
        write_exclusive(launch.evidence/'child-failure.json',failure)
        # The compact transport failure excludes the potentially large restart ledger.
        emit({k:v for k,v in failure.items() if k!='clock'})
        raise


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root',type=Path,nargs='?');parser.add_argument('run_id',nargs='?')
    parser.add_argument('--status',action='store_true');args=parser.parse_args()
    if args.status:
        print('{"native_imported":false,"native_authorized":false,"status":"offline-worker"}');return
    if args.root is None or args.run_id is None:parser.error('root and run_id required')
    sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
    sys.path.insert(0,str(Path(__file__).resolve().parent))
    from timepitch.grf.m1_verifier import PROJECT,verify_launch,recheck_launch,artifact
    from timepitch.grf.shot_context_wire import _json
    from timepitch.grf.physical_wire import canonical
    from timepitch.grf.candidate_wire import normalize_payload
    payload=_json(sys.stdin.buffer.read(32769))
    if len(canonical(payload))>32768:raise ValueError('Frozen input exceeds32KiB')
    launch=verify_launch(PROJECT,args.root,args.run_id,payload)
    native=artifact(PROJECT,launch.document['native_dir'])
    if Path(sys.executable).resolve()!=artifact(PROJECT,launch.document['python_path']):raise ValueError('Pinned child runtime required')
    recheck_launch(launch,payload)  # Last source/permission check; claim is already consumed.
    sys.path.insert(0,str(native));dll=os.add_dll_directory(str(native))
    assets=Path(sys.executable).parent/'Lib/site-packages/gfootball_engine'
    os.environ['GFOOTBALL_DATA_DIR']=str(assets/'data');os.environ['GFOOTBALL_FONT']=str(assets/'fonts/AlegreyaSansSC-ExtraBold.ttf')
    core=None;output=sys.stdout
    def emit(value):output.write(canonical(value).decode()+'\n');output.flush()
    with redirect_stdout(sys.stderr):
        try:
            from native_setup import create_core
            normalized=normalize_payload(payload);core=create_core(normalized)
            for p in normalized['players']:
                for name,value in p['attributes'].items():core._env.probe_set_stat(0 if p['side']=='home' else 1,p['slot'],name,value)
            capture_worker(core,payload,launch,emit)
        finally:
            if core is not None:core.close()
            dll.close()


if __name__=='__main__':main()
