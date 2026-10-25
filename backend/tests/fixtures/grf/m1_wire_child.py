"""Stdlib fake protocol child; cannot create a core or import native GRF."""
import base64
import builtins
from pathlib import Path
import sys
import time
import zlib

original=builtins.__import__
def guarded(name,*args,**kwargs):
    if name.split('.')[0] in ('gfootball','gfootball_engine','_gameplayfootball'):
        raise AssertionError('Native GRF forbidden in fake child')
    return original(name,*args,**kwargs)
builtins.__import__=guarded
sys.path.insert(0,str(Path(__file__).resolve().parents[3]/'src'))
from timepitch.grf.physical_wire import COLUMNS,canonical,pack_samples

sys.stdin.buffer.read(32769)
rows=[]
for i in range(3):
    values=dict.fromkeys(COLUMNS,0)
    values.update(index=i,physics_ms=i*100,period=1,period_elapsed_ms=i*100,
        owner_team=-1,owner_slot=-1,home_attack=1,away_attack=-1)
    for side in ('home','away'):
        for slot in range(11):values[f'{side}_{slot}_active']=values[f'{side}_{slot}_fatigue']=1
    rows.append([values[k] for k in COLUMNS])
chunk=dict(schema_version='grf-actions-chunk-1',index=0,columns=COLUMNS,samples=rows,
    activity=[[0]*22]*3,events=[],contact_roles=[],semantic_events=[])
raw=zlib.compress(canonical(pack_samples(chunk)))
print(canonical(dict(type='chunk',data=base64.b64encode(raw).decode())).decode(),flush=True)
if sys.argv[1]=='hang':time.sleep(15)
else:print('{"type":"failure","error_type":"FakeChildFailure","last_observed_ms":300}',flush=True)
