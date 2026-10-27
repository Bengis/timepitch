"""Single-child recovery of TP296, using the existing registry and an exact sealed proposal."""
from copy import deepcopy
from hashlib import sha256
import json
import os
from pathlib import Path
import sqlite3
from uuid import UUID

from .bulk import canonical, canonical_hash, PRIOR, run_bulk
from .ledger import SpeechRefused
from .provider import require

PARENT_BINDING='6719d7ee87b30f8280bdbc67a36f1715a28c61cf6e3dd0930bf92581983e62f8'
EXPECTED_ARTIFACT_SHA256='f94e82e03ac5deea8cc44459d4a3da6fdaf71efb79c61cd765d25abff72335a9'
EXPECTED_FILE_SHA256='7f523767c31165cc42524e00ca52c747f16ee4a452e43e8c788aa4d4b4a2e6ec'
STARTING_USAGE={'requests':15,'reservations':15,'ssmlBytes':4149}
RECOVERY_LIMITS={'new_requests':40,'new_reservations':40,'new_ssml_bytes':10322,
                 'cumulative_requests':55,'cumulative_reservations':55,'cumulative_ssml_bytes':14471,
                 'speech_cost_ceiling_eur':0,'concurrency':1,'minimum_request_spacing_seconds':4,
                 'automatic_retries':0,'stop_on_first_failure':True}


def validate_recovery(raw:bytes,authorization:dict,history:dict)->dict:
    require(authorization.get('version')=='speech-summary-recovery-authorization-1' and authorization.get('authorized') is True,'recovery_unauthorized')
    require(sha256(raw).hexdigest()==authorization.get('artifact_file_sha256')==EXPECTED_FILE_SHA256,'recovery_file_hash')
    a=json.loads(raw)
    require(a.get('artifactSha256')==authorization.get('artifact_sha256')==EXPECTED_ARTIFACT_SHA256
            and canonical_hash({k:v for k,v in a.items() if k!='artifactSha256'})==EXPECTED_ARTIFACT_SHA256,'recovery_artifact_hash')
    require(a.get('version')=='speech-summary-recovery-artifact-1' and a.get('authorized') is False and a.get('synthesisRequests')==a.get('reservationsCreated')==0,'recovery_dry_only')
    require(a['parentArtifactSha256']==authorization.get('parent_binding')==history['parentBinding']==PARENT_BINDING,'recovery_parent')
    require(canonical(authorization.get('limits'))==canonical(RECOVERY_LIMITS),'recovery_limits')
    require(history['prior']==a['budget']['prior']==STARTING_USAGE and canonical(a['proof'])==canonical(history['proof'])
            and authorization.get('history_sha256')==canonical_hash(history['proof']),'recovery_history')
    require(isinstance(authorization.get('id'),str) and 1<=len(authorization['id'])<=128,'recovery_grant_id')
    try:require(str(UUID(authorization['subscription_id']))==authorization['subscription_id'],'recovery_subscription')
    except (ValueError,KeyError,TypeError):raise SpeechRefused('recovery_subscription') from None
    require(isinstance(authorization.get('output_root'),str) and bool(authorization['output_root']),'recovery_output')
    selected=a['selected'];require(len(selected)==50 and len({s['cue']['id'] for s in selected})==50,'recovery_fifty_cues')
    require(sum(s['asset'] is not None for s in selected)==10 and all(s['asset'] is not None for s in selected[:10])
            and sum(s['editorial'] is not None for s in selected)==6,'recovery_cache_or_edits')
    require(len(history['evidence']['db']['batches'])==1 and history['evidence']['db']['batches'][0]['status']=='stopped','recovery_parent_not_stopped')
    items=[]
    for original_index,s in enumerate(selected):
        if s['asset'] is not None:continue
        c=s['cue'];body=c['ssml'].encode('utf-8')
        require(len(body)==c['bytes'] and sha256(body).hexdigest()==c['ssmlSha256'],'recovery_payload')
        items.append({'cue_id':c['id'],'locale':c['locale'],'voice':c['voice'],'style':c['style'],'format':c['format'],
                      'ssml':c['ssml'],'ssml_sha256':c['ssmlSha256'],'ssml_utf8_bytes':c['bytes'],'preset_id':c['binding']['preset']['id'],
                      'cache_key':c['cacheKey'],'max_audio_ms':s['maxAudioMs'],'phase':s['slot']['phase'],'replay_at_ms':s['replayAtMs'],'original_index':original_index})
    require(len(items)==40 and sum(i['ssml_utf8_bytes'] for i in items)==10322 and a['budget']['cached']==10
            and a['budget']['proposedNew']=={'requests':40,'reservations':40,'ssmlBytes':10322}
            and a['budget']['proposedCumulative']=={'requests':55,'reservations':55,'ssmlBytes':14471} and a['budget']['speechCostCeilingEur']==0,'recovery_budget')
    return{'binding':a['artifactSha256'],'parent_binding':PARENT_BINDING,'authorization':deepcopy(authorization),
           'subscription_id':authorization['subscription_id'],'items':items,'history':deepcopy(history),'prior':dict(PRIOR)}


def existing_registry(path:Path):
    """Never create a replacement DB/anchor and never follow linked inputs."""
    for file in (path,path.with_suffix('.anchor.json')):
        require(file.is_file(),'recovery_registry_missing')
        for p in (file,*file.parents):require(not p.is_symlink() and not p.is_junction(),'recovery_registry_link')
    for suffix in ('-wal','-journal'):
        side=Path(str(path)+suffix)
        require(not side.is_symlink() and not side.is_junction(),'recovery_registry_link')
        require(not side.exists() or side.stat().st_size==0,'recovery_registry_uncheckpointed')


class SummaryRecoveryLedger:
    def __init__(self,path:Path,plan:dict):
        self.path=path;self.plan=deepcopy(plan);self.binding=None;self.db=None
        require(plan['authorization'].get('authorized') is True and plan['authorization']['limits']==RECOVERY_LIMITS,'recovery_unauthorized')
        existing_registry(path)
        require(json.loads(path.with_suffix('.anchor.json').read_bytes())==plan['history']['evidence']['anchor'],'recovery_anchor_changed')
        try:
            self.db=sqlite3.connect(path.resolve().as_uri()+'?mode=rw',uri=True,timeout=10)
            self.db.row_factory=sqlite3.Row;self.db.execute('PRAGMA foreign_keys=ON');self.db.execute('PRAGMA synchronous=FULL')
            require(self.db.execute('PRAGMA quick_check').fetchone()[0]=='ok','recovery_registry_corrupt')
            self.check_parent()
        except (sqlite3.Error,ValueError,TypeError,SpeechRefused):
            if self.db:self.db.close()
            raise SpeechRefused('recovery_registry_invalid') from None

    def _rows(self,table,binding=None):
        order=' ORDER BY item' if table=='attempts' else ' ORDER BY id' if table=='events' else ''
        clause=' WHERE binding=?' if binding else ''
        return[dict(r) for r in self.db.execute('SELECT * FROM '+table+clause+order,(binding,) if binding else ())]

    def _links(self):
        exists=self.db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='summary_recoveries'").fetchone()
        return self._rows('summary_recoveries') if exists else []

    def check_parent(self):
        expected=self.plan['history']['evidence']['db'];parent=self.plan['parent_binding']
        require(self._rows('meta')==expected['meta'],'recovery_meta_changed')
        require(json.loads(self._rows('meta')[0]['body'])['prior']==PRIOR,'recovery_prior_reset')
        for table in ('batches','attempts','events'):require(self._rows(table,parent)==expected[table],'recovery_parent_changed')
        links=self._links();require(len(links)<=1 and all(l['parent_binding']==parent for l in links),'recovery_link_invalid')
        allowed={parent,*[l['child_binding'] for l in links]}
        require({r['binding'] for r in self._rows('batches')}==allowed and all(r['binding'] in allowed for r in self._rows('attempts')),'recovery_unknown_batch')
        if not links:require(sha256(self.path.read_bytes()).hexdigest()==self.plan['history']['proof']['registrySha256'],'recovery_registry_reset_or_changed')
        else:
            link=links[0];rows=self._rows('batches',link['child_binding'])
            require(len(rows)==1 and rows[0]['grant_id']==link['grant_id'] and rows[0]['output']==link['output'],'recovery_link_changed')
            if link['child_binding']==self.plan['binding']:
                require(link['authorization_sha256']==canonical_hash(self.plan['authorization']) and link['limits']==canonical(RECOVERY_LIMITS).decode(),'recovery_authorization_changed')
                rows=self._rows('attempts',self.plan['binding']);events=self._rows('events',self.plan['binding'])
                reserved=[e for e in events if e['phase']=='reserved']
                require(len(rows)==len(reserved) and {r['item'] for r in rows}=={e['item'] for e in reserved},'recovery_child_changed')
                for row in rows:
                    require(type(row['item']) is int and 0<=row['item']<40,'recovery_item')
                    item=self.plan['items'][row['item']]
                    require(row['hash']==item['ssml_sha256'] and row['bytes']==item['ssml_utf8_bytes'],'recovery_attempt_changed')
                    own=[e for e in events if e['item']==row['item']]
                    require(own and own[0]['phase']=='reserved' and json.loads(own[0]['body'])=={'bytes':item['ssml_utf8_bytes'],'hash':item['ssml_sha256']}
                            and row['state']==own[-1]['phase'] and row['sent']==int(any(e['phase']=='sent_uncertain' for e in own)),'recovery_child_changed')
                    if row['state'] in ('received','failed_or_uncertain'):require(json.loads(row['receipt'])==json.loads(own[-1]['body']),'recovery_child_receipt_changed')
        require(all(r['binding'] in allowed for r in self._rows('events')),'recovery_unknown_event')
        usage=self.cumulative_summary()
        require(usage['requests']<=55 and usage['reservations']<=55 and usage['ssml_utf8_bytes']<=14471,'recovery_global_limit')

    def _event(self,phase,item=None,body=None):
        self.db.execute('INSERT INTO events(binding,item,phase,body) VALUES(?,?,?,?)',(self.binding,item,phase,json.dumps(body)))

    def claim(self):
        try:
            self.db.execute('BEGIN IMMEDIATE');self.check_parent();require(not self._links(),'recovery_already_claimed')
            self.db.execute('''CREATE TABLE IF NOT EXISTS summary_recoveries(parent_binding TEXT PRIMARY KEY REFERENCES batches(binding),
              child_binding TEXT UNIQUE NOT NULL REFERENCES batches(binding),grant_id TEXT UNIQUE NOT NULL,output TEXT UNIQUE NOT NULL,
              authorization_sha256 TEXT NOT NULL,limits TEXT NOT NULL)''')
            a=self.plan['authorization'];output=os.path.normcase(str(Path(a['output_root']).resolve()))
            self.binding=self.plan['binding']
            self.db.execute('INSERT INTO batches VALUES(?,?,?,?)',(self.binding,a['id'],output,'claimed'))
            self.db.execute('INSERT INTO summary_recoveries VALUES(?,?,?,?,?,?)',(self.plan['parent_binding'],self.binding,a['id'],output,canonical_hash(a),canonical(RECOVERY_LIMITS).decode()))
            self._event('claimed',body={'parent':self.plan['parent_binding'],'authorization_sha256':canonical_hash(a),'limits':RECOVERY_LIMITS})
            self.db.commit()
        except (sqlite3.Error,SpeechRefused):self.db.rollback();self.binding=None;raise SpeechRefused('recovery_claim_refused') from None

    def _active(self):
        require(self.binding==self.plan['binding'] and self._rows('batches',self.binding)[0]['status']=='claimed','recovery_not_active')

    def reserve(self,item,digest,size):
        try:
            self.db.execute('BEGIN IMMEDIATE');self.check_parent();self._active()
            current=self.summary();total=self.cumulative_summary()
            require(type(item) is int and item==current['reservations'] and 0<=item<40,'recovery_item')
            expected=self.plan['items'][item]
            require(type(size) is int and size==expected['ssml_utf8_bytes'] and digest==expected['ssml_sha256'],'recovery_payload')
            require(current['reserved_ssml_bytes']+size<=10322 and total['reservations']<55 and total['requests']<55 and total['ssml_utf8_bytes']+size<=14471,'recovery_limit')
            self.db.execute('INSERT INTO attempts(binding,item,hash,bytes,sent,state) VALUES(?,?,?,?,0,?)',(self.binding,item,digest,size,'reserved'))
            self._event('reserved',item,{'bytes':size,'hash':digest});self.db.commit()
        except (sqlite3.Error,SpeechRefused):self.db.rollback();raise SpeechRefused('recovery_reservation_refused') from None

    def mark_sent(self,item):
        with self.db:
            self.check_parent();self._active()
            row=self.db.execute("UPDATE attempts SET sent=1,state='sent_uncertain' WHERE binding=? AND item=? AND state='reserved' AND sent=0",(self.binding,item))
            require(row.rowcount==1,'recovery_already_sent');self._event('sent_uncertain',item)

    def receipt(self,item,state,receipt):
        with self.db:
            self._active();require(state in ('received','failed_or_uncertain'),'recovery_receipt_state')
            row=self.db.execute("UPDATE attempts SET state=?,receipt=? WHERE binding=? AND item=? AND state IN ('reserved','sent_uncertain')",(state,json.dumps(receipt),self.binding,item))
            require(row.rowcount==1,'recovery_receipt_without_attempt');self._event(state,item,receipt)

    def summary(self):
        count,sent,size=self.db.execute('SELECT count(*),coalesce(sum(sent),0),coalesce(sum(bytes),0) FROM attempts WHERE binding=?',(self.binding,)).fetchone()
        return{'reservations':count,'sent':sent,'reserved_ssml_bytes':size}

    def cumulative_summary(self):
        parent=self.plan['parent_binding']
        old_count,old_sent,old_size=self.db.execute('SELECT count(*),coalesce(sum(sent),0),coalesce(sum(bytes),0) FROM attempts WHERE binding=?',(parent,)).fetchone()
        count,sent,size=self.db.execute('SELECT count(*),coalesce(sum(sent),0),coalesce(sum(bytes),0) FROM attempts WHERE binding<>?',(parent,)).fetchone()
        witness=[dict(r) for r in self.db.execute("SELECT item,phase FROM events WHERE binding<>? AND phase IN ('reserved','sent_uncertain')",(parent,))]
        reserved=[r for r in witness if r['phase']=='reserved']
        if all(type(r['item']) is int and 0<=r['item']<40 for r in reserved):
            count=max(count,len(reserved));size=max(size,sum(self.plan['items'][r['item']]['ssml_utf8_bytes'] for r in reserved))
        else:count=max(count,40);size=max(size,10322)
        sent=max(sent,sum(r['phase']=='sent_uncertain' for r in witness))
        # A damaged parent must stop the job, but must never refund its previously proven consumption.
        old=self.plan['history']['evidence']['db']['attempts']
        count+=max(old_count,len(old));sent+=max(old_sent,sum(r['sent'] for r in old));size+=max(old_size,sum(r['bytes'] for r in old))
        return{'requests':4+max(count,sent),'reservations':4+count,'ssml_utf8_bytes':1179+size,'synthesis_sent':4+sent,'speech_cost_ceiling_eur':0}

    def finish(self,status):
        with self.db:
            self._active();require(status in ('stopped','completed'),'recovery_status')
            if status=='completed':require(self.summary()['reservations']==40 and all(r['sent']==1 and r['state']=='received' for r in self._rows('attempts',self.binding)),'recovery_incomplete')
            self.db.execute('UPDATE batches SET status=? WHERE binding=?',(status,self.binding));self._event(status)

    def close(self):self.db.close()


def run_recovery(plan,resource,key,ledger,client,output,probe,*,verify_resource,verify_history,**clock):
    require(canonical(plan)==canonical(ledger.plan),'recovery_plan_changed')
    for item in plan['items']:require(sha256(item['ssml'].encode('utf-8')).hexdigest()==item['ssml_sha256'] and len(item['ssml'].encode('utf-8'))==item['ssml_utf8_bytes'],'recovery_payload_changed')
    def guard():ledger.check_parent();verify_history()
    return run_bulk(plan,resource,key,ledger,client,output,probe,verify_resource=verify_resource,verify_history=guard,verify_completion=guard,**clock)
