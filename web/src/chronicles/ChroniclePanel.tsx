import { useEffect,useRef,useState } from 'react';
import type { Locale } from '../i18n';
import type { SessionIdentity } from '../match-centre/session';
import { ChronicleHttpError,createChronicle,getChronicle,getChronicleStatus,lookupChronicle,type AzureJobView,type AzureStatus,type ChronicleRequest } from './api';
import { chronicleText } from './messages';

export type ChroniclePanelProps={identity:SessionIdentity;locale:Locale;completed:boolean;revealed:boolean;
  onSeekEvidence:(refs:readonly string[])=>void;availableEventRefs?:readonly string[];onModeChange?:(enabled:boolean)=>void};
type View={identity:SessionIdentity;locale:Locale;job:AzureJobView|null;capability:AzureStatus|null;error:number|null;loading:boolean;posting:boolean};
type Context={valid:()=>boolean;controller:AbortController;accept:(job:AzureJobView|null)=>void;fail:(error:unknown)=>void;busy:boolean};

export function ChroniclePanel({identity,locale,completed,revealed,onSeekEvidence,availableEventRefs=[],onModeChange}:ChroniclePanelProps){
  const text=chronicleText(locale),[view,setView]=useState<View|null>(null);
  const current=useRef({identity,locale,completed,revealed});current.current={identity,locale,completed,revealed};
  const mode=useRef(onModeChange);mode.current=onModeChange;
  const context=useRef<Context|null>(null);
  useEffect(()=>{
    if(identity.source==='historical'||identity.source==='recorded'||!completed){mode.current?.(false);return;}
    if(!revealed)return;
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
    const valid=()=>!controller.signal.aborted&&current.current.identity===identity&&current.current.locale===locale&&current.current.completed&&current.current.revealed;
    const request:ChronicleRequest={engine:identity.source,match_id:identity.id,trace_hash:identity.revision,locale};
    const fail=(error:unknown)=>{if(valid())setView(old=>old?{...old,job:null,error:error instanceof ChronicleHttpError?error.status:0,loading:false,posting:false}:old);};
    const accept=(job:AzureJobView|null)=>{
      if(!valid())return;
      if(job&&(job.profile!=='azure-chronicle-1'||job.engine!==request.engine||job.match_id!==request.match_id||job.trace_hash!==request.trace_hash||job.locale!==locale||
          (job.checked&&(job.checked.locale!==locale||job.checked.fact_hash!==job.fact_hash||job.checked.semantic_verified!==false)))){
        fail(new ChronicleHttpError(409));return;
      }
      setView(old=>old?{...old,job,error:null,loading:false,posting:false}:old);
      clearTimeout(timer);
      if(job&&(job.state==='queued'||job.state==='running'))timer=setTimeout(()=>{
        if(valid())void getChronicle(job.id,controller.signal).then(accept).catch(fail);
      },1000);
    };
    const ctx={valid,controller,accept,fail,busy:false};context.current=ctx;
    setView({identity,locale,job:null,capability:null,error:null,loading:true,posting:false});
    void getChronicleStatus(controller.signal).then(value=>{
      if(!valid())return;mode.current?.(value.mode!=='off');
      setView(old=>old?{...old,capability:value}:old);
    }).catch(()=>{ /* Unknown capability cannot admit generation; saved reads still work. */ });
    void lookupChronicle(request,controller.signal).then(accept).catch(fail);
    return()=>{controller.abort();clearTimeout(timer);if(context.current===ctx)context.current=null;};
  },[identity,locale,completed,revealed]);
  const v=view?.identity===identity&&view.locale===locale?view:null;
  const generate=()=>{
    const ctx=context.current;
    if(!ctx||!ctx.valid()||ctx.busy||!v?.capability?.generation_allowed||v.error!==null||v.job||identity.source==='historical'||identity.source==='recorded')return;
    ctx.busy=true;setView(old=>old?{...old,posting:true}:old);
    void createChronicle({engine:identity.source,match_id:identity.id,trace_hash:identity.revision,locale},ctx.controller.signal)
      .then(ctx.accept).catch(ctx.fail).finally(()=>{ctx.busy=false;});
  };
  const gate=identity.source==='historical'?text.historical:!completed?text.unfinished:!revealed?text.unrevealed:null;
  const checked=v?.job?.state==='ready'?v.job.checked:null;
  const error=v?.error===404?text.missing:v?.error===409?text.conflict:v?.error===429?text.allowance:v?.error===503?text.service:text.failure;
  const evidence=(index:number)=>{
    const e=checked?.evidence[index];if(!e)return null;
    const refs=e.event_refs.filter(ref=>availableEventRefs.includes(ref));
    return <details className="chronicle-evidence"><summary>{text.evidence} · {e.fact_ids.length}</summary>
      <ul>{e.facts.map(f=><li key={f.id}><code>{f.id}</code><pre>{JSON.stringify(f,null,2)}</pre></li>)}</ul>
      {refs.length?<button onClick={()=>onSeekEvidence(refs)}>{text.watch}</button>:<p>{text.noEvent}</p>}
    </details>;
  };
  let index=1;
  return <section className="chronicle-panel" aria-label={text.title}>
    <header><h2>{text.title}</h2><span className="chronicle-provider">Azure</span></header>
    {gate?<p role="status">{gate}</p>:<>
      <p className="chronicle-scope">{text.final}</p>
      <p className="small-note">{text.notice}</p>
      <div role="status" aria-live="polite">{v?.posting?text.queued:v?.loading?text.loading:v?.job?text[v.job.state]:''}</div>
      {v?.error!==null&&v?.error!==undefined&&<p role="alert">{error}</p>}
      {!v?.job&&!v?.loading&&v?.capability?.generation_allowed&&v.capability.supported_engines.includes(identity.source as 'grf'|'timepitch')&&
        <button onClick={generate} disabled={v.posting||v.error!==null}>{text.generate}</button>}
      {!checked&&!v?.job&&!v?.loading&&v?.capability&&!v.capability.supported_engines.includes(identity.source as 'grf'|'timepitch')&&<p>{text.unsupported}</p>}
      {!checked&&!v?.job&&!v?.capability?.generation_allowed&&!v?.loading&&<p>{v?.capability?.mode==='off'?text.disabled:text.unknown}</p>}
      {(v?.posting||v?.job?.state==='queued'||v?.job?.state==='running')&&<p className="small-note">{text.liability}</p>}
      {checked&&<article className="chronicle-report">
        <p className="chronicle-provenance">{text.ai} · {text.model} · {text.language}: {locale.toUpperCase()}</p>
        <p className="chronicle-result">{text.result}: {checked.header.home_name} {checked.header.score[0]} : {checked.header.score[1]} {checked.header.away_name}</p>
        <h3>{checked.draft.headline.text}</h3>{evidence(0)}
        {checked.draft.paragraphs.map((p,i)=><div className="chronicle-paragraph" key={i}>{p.sentences.map((s,j)=>{const n=index++;return <div key={j}><p>{s.text}</p>{evidence(n)}</div>;})}</div>)}
        <p className="chronicle-caveat" role="note">{text.semantic}</p>
        <aside aria-label={text.coverage}>{checked.coverage_notes.map((note,i)=><p key={i}>{note}</p>)}</aside>
        <p className="small-note">{text.revision}: <code>{identity.revision}</code> · azure-chronicle-1</p>
      </article>}
    </>}
  </section>;
}
