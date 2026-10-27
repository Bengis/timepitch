"""Separately admitted summary batch. Old canary budgets and files stay read-only."""
from copy import deepcopy
from hashlib import sha256
import json
import math
from pathlib import Path
import sqlite3
import time
from uuid import UUID
from xml.etree import ElementTree as ET

from .ledger import SpeechRefused
from .provider import BASE_URL, FORMAT, require, validate_resource, inspect_capabilities, write_exclusive

PRIOR={'requests':4,'reservations':4,'ssmlBytes':1179}
BULK_LIMITS={'new_requests':50,'new_reservations':50,'new_ssml_bytes':13176,
             'cumulative_requests':54,'cumulative_reservations':54,'cumulative_ssml_bytes':14355,
             'speech_cost_ceiling_eur':0,'concurrency':1,'minimum_request_spacing_seconds':4,
             'automatic_retries':0,'stop_on_first_failure':True}
PRESETS={
    'en-neutral':dict(id='en-neutral',locale='en',language='en-US',voice='en-US-GuyNeural',style=None,rate='0%',pitch='0%'),
    'en-goal':dict(id='en-goal',locale='en',language='en-US',voice='en-US-GuyNeural',style='excited',rate='+5%',pitch='+3%'),
    'es-neutral':dict(id='es-neutral',locale='es',language='es-ES',voice='es-ES-AlvaroNeural',style=None,rate='0%',pitch='0%'),
    'es-goal-prosody-2':dict(id='es-goal-prosody-2',locale='es',language='es-ES',voice='es-ES-AlvaroNeural',style=None,rate='+5%',pitch='+3%',label='More energetic prosody'),
}
NS='{http://www.w3.org/2001/10/synthesis}'


def canonical(value):
    return json.dumps(value,sort_keys=True,ensure_ascii=False,separators=(',',':'),allow_nan=False).encode('utf-8')


def canonical_hash(value):
    return sha256(canonical(value)).hexdigest()


def validate_bulk(raw:bytes,auth:dict,history:dict)->dict:
    require(auth.get('version')=='speech-summary-authorization-1' and auth.get('authorized') is True,'bulk_unauthorized')
    require(auth.get('artifact_file_sha256')==sha256(raw).hexdigest(),'bulk_file_hash')
    a=json.loads(raw);p=a['proposal']
    require(a.get('version')=='speech-summary-artifact-1','bulk_artifact_version')
    require(a.get('artifactSha256')==auth.get('artifact_sha256')==canonical_hash({k:v for k,v in a.items() if k!='artifactSha256'}),'bulk_artifact_hash')
    require(p.get('proposalSha256')==canonical_hash({k:v for k,v in p.items() if k!='proposalSha256'}),'bulk_proposal_hash')
    require(canonical(auth.get('limits'))==canonical(BULK_LIMITS),'bulk_authorization_limits')
    require(isinstance(auth.get('id'),str) and 1<=len(auth['id'])<=128,'bulk_grant_id')
    require(str(UUID(auth['subscription_id']))==auth['subscription_id'],'bulk_subscription')
    require(canonical(a['history'])==canonical(history),'bulk_history')
    require(a.get('namesSource')=='display' and p['selection']['markerTiming']=='held','bulk_choices')
    require(p.get('version')=='speech-summary-plan-1' and p.get('authorized') is False and p.get('synthesisRequests')==0 and p.get('reservationsCreated')==0,'bulk_dry_only')
    require(p['budget']['prior']==PRIOR and p['budget']['cached']==0 and p['budget']['speechCostCeilingEur']==0,'bulk_prior_usage')
    selected=p['selected'];require(len(selected)==50 and len({x['cue']['id'] for x in selected})==50,'bulk_fifty_unique_cues')
    items=[]
    for s in selected:
        c=s['cue'];binding=c['binding'];preset=PRESETS.get(binding['preset']['id'])
        require(preset is not None and binding['preset']==preset,'bulk_preset')
        expected=('en-goal' if c['locale']=='en' else 'es-goal-prosody-2') if c['kind'] in ('goal','own_goal') else f"{c['locale']}-neutral"
        require(preset['id']==expected and c['id'].endswith(':'+expected),'bulk_preset_kind')
        require(all(c[k]==preset[k] for k in ('locale','voice','style')) and c['format']==FORMAT,'bulk_voice_format')
        body=c['ssml'].encode('utf-8')
        require(0<len(body)<=13176 and len(body)==c['bytes'] and sha256(body).hexdigest()==c['ssmlSha256'],'bulk_payload')
        require(sha256(c['text'].encode('utf-8')).hexdigest()==c['textSha256'] and b'<!' not in body,'bulk_text')
        root=ET.fromstring(body);require(root.tag==NS+'speak' and root.attrib=={'version':'1.0','{http://www.w3.org/XML/1998/namespace}lang':preset['language']} and len(root)==1,'bulk_ssml_root')
        voice=root[0];require(voice.tag==NS+'voice' and voice.attrib=={'name':preset['voice']} and len(voice)==1,'bulk_ssml_voice')
        prosody=voice[0]
        if preset['style']:
            require(prosody.tag=='{https://www.w3.org/2001/mstts}express-as' and prosody.attrib=={'style':preset['style']} and len(prosody)==1,'bulk_ssml_style');prosody=prosody[0]
        require(prosody.tag==NS+'prosody' and prosody.attrib=={'rate':preset['rate'],'pitch':preset['pitch']} and len(prosody)==0 and ''.join(root.itertext())==c['text'],'bulk_ssml_prosody')
        require(binding=={'version':'azure-speech-dry-1','sourceSha256':canonical_hash(p['source']),'eventId':c['eventId'],'atMs':c['atMs'],
                         'window':binding['window'],'preset':preset,'format':FORMAT,'textSha256':c['textSha256'],'ssmlSha256':c['ssmlSha256']}
                and canonical_hash(binding)==c['cacheKey'],'bulk_cue_binding')
        slot=s['slot'];length=slot['toMs']-slot['fromMs']
        require(s['asset'] is None and s['durationState']=='unmeasured' and s['latestStartMs'] is None and s['maxStartupMs']==250,'bulk_cache_state')
        require(math.isfinite(length) and length>250 and s['maxAudioMs']==length-250 and s['replayAtMs']==c['atMs'],'bulk_slot')
        require(binding['window']['fromMs']<=c['atMs'] and c['playUntilMs']==binding['window']['toMs'] and c['maxDurationMs']==c['playUntilMs']-c['atMs']-250,'bulk_cue_window')
        if slot['clock']=='presentation':
            require(slot['phase'] in ('opening','halftime','second-half','fulltime') and slot['fromMs']==0 and slot['toMs']==15000 and c['playUntilMs']==c['atMs']+15000,'bulk_presentation')
        else:
            require(slot['clock']=='replay' and slot['fromMs']==c['atMs'] and slot['toMs']==c['playUntilMs'],'bulk_replay_slot')
        items.append({'cue_id':c['id'],'locale':c['locale'],'voice':c['voice'],'style':c['style'],'format':FORMAT,'ssml':c['ssml'],
                      'ssml_sha256':c['ssmlSha256'],'ssml_utf8_bytes':c['bytes'],'preset_id':preset['id'],'cache_key':c['cacheKey'],
                      'max_audio_ms':s['maxAudioMs'],'phase':slot['phase'],'replay_at_ms':s['replayAtMs']})
    total=sum(i['ssml_utf8_bytes'] for i in items)
    require(total==13176 and p['budget']['proposedNew']=={'requests':50,'reservations':50,'ssmlBytes':total} and p['budget']['proposedCumulative']=={'requests':54,'reservations':54,'ssmlBytes':14355},'bulk_budget')
    return{'binding':a['artifactSha256'],'authorization':deepcopy(auth),'subscription_id':auth['subscription_id'],'items':items,'prior':dict(PRIOR),'history':deepcopy(history)}


class BulkLedger:
    """One canonical counter across batches; per-batch outputs cannot reset it."""
    def __init__(self,path:Path,prior:dict,history_sha:str):
        self.path=path;self.binding=None;anchor=path.with_suffix('.anchor.json')
        require(prior==PRIOR and len(history_sha)==64,'bulk_prior_anchor')
        metadata={'version':'speech-summary-ledger-1','prior':prior,'historySha256':history_sha}
        exists=path.exists();require(exists==anchor.exists(),'bulk_registry_incomplete')
        if not exists:write_exclusive(anchor,canonical(metadata))
        require(json.loads(anchor.read_bytes())==metadata,'bulk_registry_anchor')
        try:
            self.db=sqlite3.connect(path);self.db.row_factory=sqlite3.Row
            self.db.execute('PRAGMA foreign_keys=ON');self.db.execute('PRAGMA synchronous=FULL')
            if not exists:
                self.db.executescript('''CREATE TABLE meta(id INTEGER PRIMARY KEY CHECK(id=1),body TEXT NOT NULL);
                CREATE TABLE batches(binding TEXT PRIMARY KEY,grant_id TEXT UNIQUE NOT NULL,output TEXT UNIQUE NOT NULL,status TEXT NOT NULL);
                CREATE TABLE attempts(binding TEXT REFERENCES batches(binding),item INTEGER CHECK(item>=0 AND item<50),hash TEXT NOT NULL,
                    bytes INTEGER CHECK(bytes>0),sent INTEGER NOT NULL DEFAULT 0 CHECK(sent IN (0,1)),state TEXT,receipt TEXT,PRIMARY KEY(binding,item));
                CREATE TABLE events(id INTEGER PRIMARY KEY AUTOINCREMENT,binding TEXT,item INTEGER,phase TEXT,body TEXT);''')
                self.db.execute('INSERT INTO meta VALUES(1,?)',(canonical(metadata).decode(),));self.db.commit()
            require(self.db.execute('PRAGMA quick_check').fetchone()[0]=='ok','bulk_registry_corrupt')
            require(json.loads(self.db.execute('SELECT body FROM meta WHERE id=1').fetchone()[0])==metadata,'bulk_registry_metadata')
            self.prior=dict(prior)
            usage=self.cumulative_summary();require(usage['requests']<=54 and usage['reservations']<=54 and usage['ssml_utf8_bytes']<=14355,'bulk_registry_over_limit')
        except (sqlite3.Error,TypeError,ValueError,IndexError):raise SpeechRefused('bulk_registry_invalid') from None

    def event(self,phase,item=None,body=None):
        self.db.execute('INSERT INTO events(binding,item,phase,body) VALUES(?,?,?,?)',(self.binding,item,phase,json.dumps(body)))

    def claim(self,grant_id,binding,output):
        try:
            with self.db:
                self.db.execute('INSERT INTO batches VALUES(?,?,?,?)',(binding,grant_id,output,'claimed'))
                self.binding=binding;self.event('claimed',body={'output':output})
        except sqlite3.IntegrityError:raise SpeechRefused('bulk_already_claimed') from None

    def reserve(self,item,digest,size):
        try:
            self.db.execute('BEGIN IMMEDIATE')
            require(self.binding and self.db.execute('SELECT status FROM batches WHERE binding=?',(self.binding,)).fetchone()[0]=='claimed','bulk_not_active')
            count,total=self.db.execute('SELECT count(*),coalesce(sum(bytes),0) FROM attempts').fetchone()
            require(count<50 and self.prior['requests']+count<54 and self.prior['reservations']+count<54 and type(size) is int and size>0 and total+size<=13176 and self.prior['ssmlBytes']+total+size<=14355,'bulk_limit')
            require(type(item) is int and 0<=item<50 and isinstance(digest,str) and len(digest)==64,'bulk_item')
            self.db.execute('INSERT INTO attempts(binding,item,hash,bytes,state) VALUES(?,?,?,?,?)',(self.binding,item,digest,size,'reserved'))
            self.event('reserved',item,{'bytes':size,'hash':digest});self.db.commit()
        except (sqlite3.IntegrityError,SpeechRefused):self.db.rollback();raise SpeechRefused('bulk_reservation_refused') from None

    def mark_sent(self,item):
        with self.db:
            row=self.db.execute("UPDATE attempts SET sent=1,state='sent_uncertain' WHERE binding=? AND item=? AND sent=0 AND state='reserved'",(self.binding,item))
            require(row.rowcount==1,'bulk_already_sent');self.event('sent_uncertain',item)

    def receipt(self,item,state,receipt):
        with self.db:
            row=self.db.execute('UPDATE attempts SET state=?,receipt=? WHERE binding=? AND item=?',(state,json.dumps(receipt),self.binding,item))
            require(row.rowcount==1,'bulk_receipt_without_attempt');self.event(state,item,receipt)

    def attempts(self):
        return[dict(r) for r in self.db.execute('SELECT * FROM attempts WHERE binding=? ORDER BY item',(self.binding,))]

    def summary(self):
        count,sent,size=self.db.execute('SELECT count(*),coalesce(sum(sent),0),coalesce(sum(bytes),0) FROM attempts WHERE binding=?',(self.binding,)).fetchone()
        return{'reservations':count,'sent':sent,'reserved_ssml_bytes':size}

    def cumulative_summary(self):
        count,sent,size=self.db.execute('SELECT count(*),coalesce(sum(sent),0),coalesce(sum(bytes),0) FROM attempts').fetchone()
        return{'requests':self.prior['requests']+max(count,sent),'reservations':self.prior['reservations']+count,
               'ssml_utf8_bytes':self.prior['ssmlBytes']+size,'synthesis_sent':self.prior['requests']+sent,'speech_cost_ceiling_eur':0}

    def finish(self,status):
        with self.db:
            self.db.execute('UPDATE batches SET status=? WHERE binding=?',(status,self.binding));self.event(status)

    def close(self):self.db.close()


def run_bulk(plan,resource,key,ledger,client,output,probe,*,verify_resource,verify_history,sleep=time.sleep,now=time.monotonic,verify_completion=None):
    require(output.resolve()==Path(plan['authorization']['output_root']).resolve(),'output_mismatch')
    require(str(client.base_url).rstrip('/')==BASE_URL and not client.follow_redirects,'transport_target')
    result={'status':'stopped','samples':[],'error':None,'speech_cost_ceiling_eur':0};active=None;receipt=None;last=None
    try:
        verify_history();validate_resource(plan,resource)
        capabilities=inspect_capabilities(plan,key,client,output);result['capability_receipt']='capabilities.json'
        require(capabilities['error'] is None,'bulk_catalog_failed')
        require(all(c['compatible'] for c in capabilities['checks']),'bulk_voice_capability')
        for index,item in enumerate(plan['items']):
            if last is not None:sleep(max(0,4-(now()-last)))
            verify_history();validate_resource(plan,verify_resource())
            ledger.reserve(index,item['ssml_sha256'],item['ssml_utf8_bytes']);active=index
            receipt={'index':index,'cue_id':item['cue_id'],'cache_key':item['cache_key'],'artifact_sha256':plan['binding'],
                     'voice':item['voice'],'style':item['style'],'preset_id':item['preset_id'],'ssml_bytes':item['ssml_utf8_bytes'],
                     'ssml_sha256':item['ssml_sha256'],'max_audio_ms':item['max_audio_ms'],'phase':item['phase'],'replay_at_ms':item['replay_at_ms']}
            ledger.mark_sent(index);last=now()
            response=client.post('/cognitiveservices/v1',content=item['ssml'].encode('utf-8'),headers={
                'Ocp-Apim-Subscription-Key':key,'Content-Type':'application/ssml+xml','X-Microsoft-OutputFormat':FORMAT,'User-Agent':'TimePitch-Speech-Summary/1'})
            body=response.content;receipt.update(http_status=response.status_code,response_sha256=sha256(body).hexdigest(),response_bytes=len(body))
            audio=64<=len(body)<=2_000_000 and (body[:3]==b'ID3' or body[0]==255 and body[1]&224==224)
            if audio:
                file=output/f'{index+1:03d}-{item["locale"]}-{item["preset_id"]}.mp3';write_exclusive(file,body)
                receipt.update(file=file.name,audio_sha256=sha256(body).hexdigest(),audio_bytes=len(body))
            require(response.status_code==200,f'synthesis_http_{response.status_code}')
            require(audio and response.headers.get('content-type','').split(';')[0] in ('audio/mpeg','audio/mp3'),'audio_content')
            metadata=probe(file);receipt.update(metadata)
            require(metadata['codec']=='mp3' and metadata['sample_rate']==24000 and metadata['channels']==1 and metadata['bit_rate']==48000 and math.isfinite(metadata['duration_s']) and metadata['duration_s']>0,'audio_metadata')
            duration=round(metadata['duration_s']*1000,3);deadline=round(min(250,item['max_audio_ms']-duration),3)
            receipt.update(duration_ms=duration,native_start_deadline_ms=deadline)
            require(duration<=item['max_audio_ms'] and deadline>0,'audio_duration_exceeds_slot')
            receipt['state']='received';write_exclusive(output/f'{index+1:03d}.receipt.json',canonical(receipt))
            ledger.receipt(index,'received',receipt);result['samples'].append(receipt);active=None
        if verify_completion is not None:verify_completion()
        result['status']='completed'
    except Exception as error:
        code=str(error) if isinstance(error,SpeechRefused) else type(error).__name__;result['error']=code
        if active is not None:
            receipt={**(receipt or {}),'error':code,'state':'failed_or_uncertain'}
            target=output/f'{active+1:03d}.receipt.json'
            if not target.exists():
                try:write_exclusive(target,canonical(receipt))
                except OSError:result['receipt_write_failed']=True
            ledger.receipt(active,'failed_or_uncertain',receipt);result['samples'].append(receipt)
    ledger.finish(result['status']);result['usage']=ledger.summary();result['cumulative_usage']=ledger.cumulative_summary()
    return result
