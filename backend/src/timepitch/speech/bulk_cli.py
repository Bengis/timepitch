"""Single-use local operator entry point for the specifically authorized summary."""
import argparse
from hashlib import sha256
import json
import os
from pathlib import Path
import subprocess

import httpx

from .__main__ import azure_json, probe_audio, REPOSITORY_ROOT
from .bulk import BulkLedger, validate_bulk, run_bulk, canonical, canonical_hash
from .ledger import SpeechRefused
from .provider import BASE_URL, require, validate_resource, write_exclusive


def local_path(root:Path,path:Path,*,existing=True)->Path:
    base=root/'.local';absolute=Path(os.path.abspath(path))
    require(absolute.is_relative_to(base) and absolute!=base,'bulk_local_path')
    for parent in [absolute,*absolute.parents]:
        require(not parent.is_symlink() and not parent.is_junction(),'bulk_linked_path')
        if parent==root:break
    require(not existing or absolute.is_file(),'bulk_local_file_missing')
    return absolute


def verify_history_files(root:Path,proof:dict):
    for entry in proof['files']:
        file=local_path(root,root/entry['file'])
        if file.suffix=='.sqlite3':
            for suffix in ('-wal','-journal'):
                side=Path(str(file)+suffix)
                require(not side.is_symlink() and not side.is_junction(),'bulk_history_link')
                require(not side.exists() or side.stat().st_size==0,'bulk_history_uncheckpointed')
        require(sha256(file.read_bytes()).hexdigest()==entry['sha256'],'bulk_history_changed')


def preflight(root:Path,artifact:Path,authorization:Path,node:Path):
    artifact=local_path(root,artifact);authorization=local_path(root,authorization)
    raw=artifact.read_bytes();auth=json.loads(authorization.read_bytes())
    require(auth.get('authorized') is True,'bulk_unauthorized')
    require(auth.get('artifact_file_sha256')==sha256(raw).hexdigest(),'bulk_file_hash')
    # The earlier inspector checks the canonical parent/recovery graph, ledger totals and original receipts.
    code="import {readSpeechHistory} from './scripts/prepare_speech_summary.mjs';const e=await readSpeechHistory();console.log(JSON.stringify({prior:e.prior,proof:e.proof}));"
    inspected=subprocess.run([str(node),'--input-type=module','-e',code],cwd=root,capture_output=True,timeout=30,check=False)
    require(inspected.returncode==0,'bulk_history_check_failed')
    history=json.loads(inspected.stdout);plan=validate_bulk(raw,auth,history['proof'])
    require(plan['prior']==history['prior'],'bulk_prior_mismatch')
    old=json.loads(local_path(root,root/'.local/speech-tp291-run/authorization.json').read_bytes())
    require(auth['subscription_id']==old['subscription_id'],'bulk_subscription_changed')
    output=local_path(root,Path(auth['output_root']),existing=False)
    require(not output.exists(),'bulk_output_already_exists')
    verify_history_files(root,plan['history'])
    return plan,output


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('artifact','authorization','node','azure-python','ffprobe'):parser.add_argument('--'+name,type=Path,required=True)
    args=parser.parse_args(argv)
    # No intent, global registry, resource/catalog/key access occurs before these gates.
    plan,output=preflight(REPOSITORY_ROOT,args.artifact,args.authorization,args.node)
    require(all(p.is_file() for p in (args.node,args.azure_python,args.ffprobe)),'missing_local_tool')
    output.mkdir()
    write_exclusive(output/'execution-intent.json',canonical({'version':'speech-summary-intent-1','grant_id':plan['authorization']['id'],
        'artifact_sha256':plan['binding'],'artifact_file_sha256':plan['authorization']['artifact_file_sha256'],
        'history_sha256':canonical_hash(plan['history']),'limits':plan['authorization']['limits']}))
    ledger=None;key=None
    try:
        ledger=BulkLedger(REPOSITORY_ROOT/'.local/speech-summary-ledger.sqlite3',plan['prior'],canonical_hash(plan['history']))
        ledger.claim(plan['authorization']['id'],plan['binding'],str(output.resolve()))
        write_exclusive(output/'history-revalidated.json',canonical(plan['history']))
        def guard():verify_history_files(REPOSITORY_ROOT,plan['history'])
        def resource():return azure_json(args.azure_python,plan['subscription_id'],[
            'cognitiveservices','account','show','--name','timepitch-speech-f0','--resource-group','timepitch'])
        guard();metadata=resource();validate_resource(plan,metadata)
        write_exclusive(output/'resource-proof.json',canonical({'name':metadata['name'],'kind':metadata['kind'],
            'sku':metadata['sku']['name'],'location':metadata['location'],'identity_verified':True}))
        secret=azure_json(args.azure_python,plan['subscription_id'],[
            'cognitiveservices','account','keys','list','--name','timepitch-speech-f0','--resource-group','timepitch'])
        key=secret.pop('key1');secret.clear();del secret
        with httpx.Client(base_url=BASE_URL,transport=httpx.HTTPTransport(retries=0),follow_redirects=False,trust_env=False,timeout=45) as client:
            result=run_bulk(plan,metadata,key,ledger,client,output,lambda p:probe_audio(args.ffprobe,p),verify_resource=resource,verify_history=guard)
    except Exception as error:
        code=str(error) if isinstance(error,SpeechRefused) else type(error).__name__
        result={'status':'stopped','error':code,'samples':[],'speech_cost_ceiling_eur':0}
        if ledger:
            if ledger.binding:ledger.finish('stopped')
            result.update(usage=ledger.summary(),cumulative_usage=ledger.cumulative_summary())
    finally:
        key=None
        if ledger:ledger.close()
    write_exclusive(output/'result.json',canonical(result))
    print(json.dumps({'status':result['status'],'error':result.get('error'),'samples_received':sum(s.get('state')=='received' for s in result['samples']),
                      'samples_recorded':len(result['samples']),'usage':result.get('usage'),'cumulative_usage':result.get('cumulative_usage')}))
    return 0 if result['status']=='completed' else 1


if __name__=='__main__':
    try:raise SystemExit(main())
    except SpeechRefused as error:print(json.dumps({'status':'refused_before_execution','error':str(error)}));raise SystemExit(1)
