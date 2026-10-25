"""Controlled subprocess protocol; never used as native match acceptance."""
import base64,json,sys,time
from pathlib import Path
root=Path(sys.argv[1]);mode=sys.argv[2]
sys.stdin.buffer.read()
if mode=='hang':time.sleep(60);raise SystemExit(1)
manifest=json.loads((root/'manifest.json').read_text())
for ref in manifest['chunks']:
    index=ref['index']
    if mode=='reorder' and index==0:index=1
    print(json.dumps({'type':'chunk','data':base64.b64encode((root/f'{index}.zlib').read_bytes()).decode()}),flush=True)
    if mode=='partial':time.sleep(60);raise SystemExit(1)
    if mode=='duplicate':
        print(json.dumps({'type':'chunk','data':base64.b64encode((root/f'{index}.zlib').read_bytes()).decode()}),flush=True)
        break
if mode=='hash':manifest['trace_hash']='f'*64
if mode=='no_manifest':raise SystemExit(0)
print(json.dumps({'type':'manifest','manifest':manifest}),flush=True)
