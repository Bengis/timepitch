"""Synthetic child exercising the real parent transport; never imports GRF."""
import base64,json,sys,time,zlib
from pathlib import Path
root=Path(sys.argv[1]);mode=sys.argv[2]
sys.stdin.buffer.read()
if mode=='hang':time.sleep(60);raise SystemExit(1)
manifest=json.loads((root/'manifest.json').read_text())
for ref in manifest['chunks']:
    index=ref['index']
    if mode=='omitted' and index==1:continue
    if mode=='reorder' and index==0:index=1
    raw=(root/f'{index}.zlib').read_bytes()
    if mode=='role' and index==0:
        data=json.loads(zlib.decompress(raw));data['contact_roles']=[0]
        raw=zlib.compress(json.dumps(data).encode())
    print(json.dumps({'type':'chunk','data':base64.b64encode(raw).decode()}),flush=True)
    if mode=='partial':time.sleep(60);raise SystemExit(1)
    if mode=='duplicate':
        print(json.dumps({'type':'chunk','data':base64.b64encode(raw).decode()}),flush=True);break
if mode=='overflow':manifest['overflowed']=True
if mode=='counts':manifest['semantic_event_count']=0
if mode=='no_manifest':raise SystemExit(0)
print(json.dumps({'type':'manifest','manifest':manifest}),flush=True)
