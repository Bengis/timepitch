"""Operator-only recovery entry point. No generation without a new exact positive authorization."""
import argparse
from hashlib import sha256
import json
from pathlib import Path
import subprocess

import httpx

from .__main__ import azure_json,probe_audio,REPOSITORY_ROOT
from .bulk import canonical,canonical_hash
from .bulk_cli import local_path,verify_history_files
from .bulk_recovery import SummaryRecoveryLedger,validate_recovery,run_recovery,existing_registry
from .ledger import SpeechRefused
from .provider import BASE_URL,require,validate_resource,write_exclusive


def read_history(root:Path,node:Path)->dict:
    code="import {readSummaryRecoveryHistory} from './scripts/prepare_speech_summary_recovery.mjs';const e=await readSummaryRecoveryHistory();console.log(JSON.stringify({prior:e.prior,parentBinding:e.parentBinding,proof:e.proof,evidence:{db:e.evidence.db,anchor:e.evidence.anchor}}));"
    result=subprocess.run([str(node),'--input-type=module','-e',code],cwd=root,capture_output=True,timeout=30,check=False)
    require(result.returncode==0,'recovery_history_check_failed');return json.loads(result.stdout)


def verify_recovery_files(root:Path,proof:dict):
    # The canonical DB is deliberately extended; the pinned parent rows are checked separately.
    immutable=[e for e in proof['files'] if e['file'].replace('\\','/')!='.local/speech-summary-ledger.sqlite3']
    verify_history_files(root,{'files':immutable})


def preflight(root:Path,artifact:Path,authorization:Path,node:Path):
    raw=local_path(root,artifact).read_bytes();auth=json.loads(local_path(root,authorization).read_bytes())
    require(auth.get('authorized') is True,'recovery_unauthorized')
    require(auth.get('artifact_file_sha256')==sha256(raw).hexdigest(),'recovery_file_hash')
    history=read_history(root,node);plan=validate_recovery(raw,auth,history)
    old=json.loads(local_path(root,root/'.local/speech-tp291-run/authorization.json').read_bytes())
    require(auth['subscription_id']==old['subscription_id'],'recovery_subscription_changed')
    output=local_path(root,Path(auth['output_root']),existing=False)
    require(not output.exists(),'recovery_output_already_exists')
    registry=local_path(root,root/'.local/speech-summary-ledger.sqlite3');existing_registry(registry)
    verify_history_files(root,history['proof'])
    return plan,output


def make_client():
    return httpx.Client(base_url=BASE_URL,transport=httpx.HTTPTransport(retries=0),follow_redirects=False,trust_env=False,timeout=45)


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('artifact','authorization','node','azure-python','ffprobe'):parser.add_argument('--'+name,type=Path,required=True)
    args=parser.parse_args(argv)
    plan,output=preflight(REPOSITORY_ROOT,args.artifact,args.authorization,args.node)
    require(all(p.is_file() for p in (args.node,args.azure_python,args.ffprobe)),'missing_local_tool')
    output.mkdir()
    write_exclusive(output/'execution-intent.json',canonical({'version':'speech-summary-recovery-intent-1','grant_id':plan['authorization']['id'],
        'parent_binding':plan['parent_binding'],'artifact_sha256':plan['binding'],'history_sha256':canonical_hash(plan['history']['proof']),'limits':plan['authorization']['limits']}))
    ledger=None;key=None
    try:
        ledger=SummaryRecoveryLedger(REPOSITORY_ROOT/'.local/speech-summary-ledger.sqlite3',plan);ledger.claim()
        write_exclusive(output/'history-revalidated.json',canonical(plan['history']))
        def guard():verify_recovery_files(REPOSITORY_ROOT,plan['history']['proof']);ledger.check_parent()
        def resource():return azure_json(args.azure_python,plan['subscription_id'],[
            'cognitiveservices','account','show','--name','timepitch-speech-f0','--resource-group','timepitch'])
        guard();metadata=resource();validate_resource(plan,metadata)
        write_exclusive(output/'resource-proof.json',canonical({'name':metadata['name'],'kind':metadata['kind'],'sku':metadata['sku']['name'],'location':metadata['location'],'identity_verified':True}))
        secret=azure_json(args.azure_python,plan['subscription_id'],[
            'cognitiveservices','account','keys','list','--name','timepitch-speech-f0','--resource-group','timepitch'])
        key=secret.pop('key1');secret.clear();del secret
        with make_client() as client:
            result=run_recovery(plan,metadata,key,ledger,client,output,lambda p:probe_audio(args.ffprobe,p),verify_resource=resource,verify_history=guard)
    except Exception as error:
        code=str(error) if isinstance(error,SpeechRefused) else type(error).__name__
        result={'status':'stopped','error':code,'samples':[],'speech_cost_ceiling_eur':0}
        if ledger:
            if ledger.binding:
                current=ledger.db.execute('SELECT status FROM batches WHERE binding=?',(ledger.binding,)).fetchone()
                if current and current[0]=='claimed':ledger.finish('stopped')
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
    except Exception as error:
        print(json.dumps({'status':'refused_before_execution','error':str(error) if isinstance(error,SpeechRefused) else type(error).__name__}));raise SystemExit(1)
