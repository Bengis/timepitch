"""Transport fixture: emits retained bytes only; never imports native GRF."""
import gzip,json,os
from pathlib import Path
import sys,time
source=Path(sys.argv[1]);mode=sys.argv[2]
if mode=='sleep':time.sleep(60);sys.exit(0)
payload=json.loads(sys.stdin.buffer.read())
record=json.loads(gzip.decompress(source.read_bytes()))
assert payload['input_hash']==record['input']['input_hash']
record.pop('input');record.pop('trace_hash')
record['input_hash']=payload['input_hash']
if mode=='bulk':
    # Only a saved-data transport child. No native environment or fake core time.
    sys.path.insert(0,str(Path(__file__).resolve().parents[3]/'src/timepitch/grf'))
    from native_json import encode_native_result,write_native_json
    from performance import StageTimings,emit_worker_profile
    timing=StageTimings(os.getenv('TIMEPITCH_GRF_PROFILE')=='1')
    start=timing.start()
    try:
        text=timing.call('json_encode',encode_native_result,record)
        timing.call('json_write',write_native_json,text,sys.stdout)
    finally:timing.stop('json_output',start)
    emit_worker_profile(timing,payload['input_hash'],'passed',sys.stderr)
    sys.exit(0)
json.dump(record,sys.stdout,separators=(',',':'),allow_nan=False)
sys.stdout.flush()
if os.getenv('TIMEPITCH_GRF_PROFILE')=='1':
    prefix='TIMEPITCH_GRF_PROFILE_V1 '
    report={'schema':'grf-worker-profile-1','input_hash':payload['input_hash'],'status':'passed',
            'wall_ns':100000000,'timings_ns':{'core_step':60000000},'calls':{'core_step':2},
            'native_step_ns':50000000}
    if mode=='invalid_profile':report['private_data']='must not be retained'
    if mode=='foreign_profile':report['input_hash']='f'*64
    frame=prefix+json.dumps(report,separators=(',',':'))+'\n'
    sys.stderr.write(frame)
    if mode=='duplicate_profile':sys.stderr.write(frame)
