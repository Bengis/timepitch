"""Replay a complete synthetic capture with portable3.10, never football."""
import base64,json,struct,sys
from pathlib import Path
source,policy=map(Path,sys.argv[1:3]);identity=json.loads(sys.argv[3]);spec=json.loads(sys.argv[4]);mode=sys.argv[5]
sys.path.insert(0,sys.argv[6]);from candidate_wire import write_policy
sys.stdin.buffer.read()
start=dict(policy_version=spec['policy_version'],**{k:struct.unpack('<f',struct.pack('<f',v))[0] for k,v in spec['policy'].items()},
    marking_eligible=0,marking_raised=0,area_slide_eligible=0,area_slide_rejected=0,invalid_inputs=0)
manifest=json.loads((source/'manifest.json').read_bytes())
for ref in manifest['chunks']:
    raw=(source/f'{ref["index"]}.zlib').read_bytes()
    print(json.dumps(dict(type='chunk',data=base64.b64encode(raw).decode())),flush=True)
if mode=='ok':write_policy(policy,identity,spec,start,start|dict(marking_eligible=2,marking_raised=1),manifest['trace_hash'])
print(json.dumps(dict(type='manifest',manifest=manifest)),flush=True)
