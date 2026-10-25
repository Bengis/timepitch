import { useEffect,useMemo,useRef,useState } from 'react';
import type { MatchRecord,StatisticsBundle } from '../../api';
import { getStatistics } from '../../api';
import { useLanguage } from '../../i18n';
import { isSpatial } from '../replay';
import { MetricTable } from './MetricTable';
import { StatisticsPlots } from './StatisticsPlots';
import { metricGroups,statisticsClock,useStatsText } from './messages';

export function StatisticsPanel({matchId,record,timeMs,onInspect}:{matchId:string;record:MatchRecord;timeMs:number;onInspect?:(id:string)=>void}){
  const {locale}=useLanguage(),t=useStatsText();
  const key=matchId+'|'+record.trace_hash;
  const current=useRef({key,locale,timeMs});current.current={key,locale,timeMs};
  const serial=useRef(0),abort=useRef<AbortController|null>(null);
  const [snapshot,setSnapshot]=useState<{key:string;data:StatisticsBundle}|null>(null);
  const [pending,setPending]=useState<{key:string;cut:number}|null>(null),[error,setError]=useState(false);
  const [scope,setScope]=useState('teams'),[player,setPlayer]=useState(''),[group,setGroup]=useState<keyof typeof metricGroups>('chance');
  useEffect(()=>{serial.current++;abort.current?.abort();setPending(null);setError(false);},[key,locale]);
  useEffect(()=>()=>{serial.current++;abort.current?.abort();},[]);
  useEffect(()=>{
    if(pending&&(pending.key!==key||pending.cut>timeMs)){serial.current++;abort.current?.abort();setPending(null);}
    if(snapshot&&(snapshot.key!==key||snapshot.data.end_ms>timeMs))setSnapshot(null);
  },[key,timeMs,pending,snapshot]);
  const final=timeMs>=5400000;
  const persisted=final&&isSpatial(record)?record.statistics:null;
  const data=persisted??(snapshot?.key===key&&snapshot.data.end_ms<=timeMs?snapshot.data:null);
  async function inspect(){
    const cut=Math.max(0,Math.min(5400000,Math.floor(timeMs/250)*250)),request=++serial.current;
    abort.current?.abort();const control=new AbortController();abort.current=control;
    const captured={key,locale};setPending({key,cut});setError(false);
    const active=()=>!control.signal.aborted&&request===serial.current&&current.current.key===captured.key&&current.current.locale===captured.locale&&current.current.timeMs>=cut;
    try{
      const result=await getStatistics(matchId,cut,control.signal);
      if(active()){
        if(result.end_ms!==cut)throw new Error('Unexpected statistics cutoff');
        setSnapshot({key:captured.key,data:result});
      }
    }catch(error){if(active()&&!(error instanceof DOMException&&error.name==='AbortError'))setError(true);}
    finally{if(active())setPending(null);}
  }
  const selected=record.initial_frame.players.find(p=>p.key===player)??record.initial_frame.players[0];
  const columns=useMemo(()=>!data?[]:scope==='teams'?[
    {name:record.home_name,metrics:data.by_team.home??{}},{name:record.away_name,metrics:data.by_team.away??{}}]:[
    {name:selected?.name??t.player,metrics:data.by_player[selected?.key??'']??{}}],
    [data,scope,selected?.key,selected?.name,record.home_name,record.away_name,t.player]);
  return <section className="statistics-panel" aria-label={t.title}>
    <div className="section-line"><h2>{final?t.final:t.title}</h2><button className="secondary" onClick={inspect} disabled={Boolean(pending)}>{t.inspect}</button></div>
    {pending&&<p role="status">{t.loading} {statisticsClock(pending.cut,locale)}</p>}
    {error&&<p role="alert">{t.error}</p>}
    {data&&<div data-testid="statistics-result" data-end-ms={data.end_ms} data-trace-hash={record.trace_hash}>
      <p className="statistics-cutoff">{t.through} <strong>{statisticsClock(data.end_ms,locale)}</strong> · {t.simulated}</p>
      <p className="small-note">{t.note}</p>
      <div className="statistics-controls"><label>{t.scope}<select value={scope} onChange={e=>setScope(e.target.value)}><option value="teams">{t.team}</option><option value="player" disabled={!record.initial_frame.players.length}>{t.player}</option></select></label>
        {scope==='player'&&<label>{t.choosePlayer}<select value={selected?.key??''} onChange={e=>setPlayer(e.target.value)}>{record.initial_frame.players.map(p=><option key={p.key} value={p.key}>{p.name} · {p.side==='home'?record.home_name:record.away_name}</option>)}</select></label>}
        <label>{t.group}<select value={group} onChange={e=>setGroup(e.target.value as keyof typeof metricGroups)}>{Object.keys(metricGroups).map(id=><option key={id} value={id}>{t[id as keyof typeof metricGroups]}</option>)}</select></label>
      </div>
      <MetricTable ids={metricGroups[group]} definitions={data.definitions} columns={columns} onInspect={onInspect}/>
      <StatisticsPlots plots={data.plots??{}} endMs={data.end_ms} home={record.home_name} away={record.away_name} players={record.initial_frame.players} playerKey={scope==='player'?selected?.key:undefined} onInspect={onInspect}/>
      <p className="small-note">{t.models}</p>
    </div>}
  </section>;
}
