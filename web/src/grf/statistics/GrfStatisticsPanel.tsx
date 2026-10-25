import {memo,useEffect,useRef,useState} from 'react';
import type {ReactNode} from 'react';
import type {GrfReplay,GrfStatisticsSummary} from '../../api';
import {getGrfStatistics} from '../../api';
import {useLanguage} from '../../i18n';
import {clockLabel} from '../../match/replay';
import {GrfStatisticsPlots} from './GrfStatisticsPlots';
import {useGrfStatsText} from './messages';
import {GrfPlayerTable} from './GrfPlayerTable';
import {useCentreText} from '../../match-centre/messages';
import type {GrfTab} from '../GrfMatchTabs';
import {MatchExtras} from '../../match-centre/MatchExtras';
import {grfExtras} from '../../match-centre/extras-model';

type Props={id:string;traceHash:string;onSeek:(playbackMs:number)=>void;view?:GrfTab;prefix?:string;details?:ReactNode;record?:GrfReplay};
const comparison=['team_possession_pct','goals','shots','assists','possession_pct','pass_attempts','pass_received','pass_intercepted','pass_interrupted',
  'pass_same_actor','pass_unresolved','confirmed_receipt_pct','recoveries','fouls','offsides','corners','penalties','team_length_m','team_width_m',
  'own_goals','own_goals_for','unattributed_goals'];
const priority=['shots','pass_attempts','confirmed_receipt_pct','recoveries','corners','team_possession_pct'];

export const GrfStatisticsPanel=memo(function GrfStatisticsPanel({id,traceHash,onSeek,view='summary',prefix='grf',details,record}:Props){
  const c=useCentreText(),t=useGrfStatsText(),{locale}=useLanguage(),key=id+'|'+traceHash,current=useRef(key);current.current=key;
  const [snapshot,setSnapshot]=useState<{key:string;data:GrfStatisticsSummary}|null>(null);
  const [error,setError]=useState<string|null>(null),[attempt,setAttempt]=useState(0);

  const panel=(name:GrfTab)=>({role:'tabpanel',id:`${prefix}-panel-${name}`,'aria-labelledby':`${prefix}-tab-${name}`,hidden:view!==name,tabIndex:0});
  useEffect(()=>{
    const control=new AbortController();setError(null);
    getGrfStatistics(id,control.signal).then(data=>{
      if(control.signal.aborted||current.current!==key)return;
      if(data.trace_hash!==traceHash||data.statistics_version!=='grf-statistics-1')throw new Error('Statistics identity mismatch');
      setSnapshot({key,data});
    }).catch(()=>{if(!control.signal.aborted&&current.current===key)setError(key);});
    return()=>control.abort();
  },[id,traceHash,key,attempt]);
  const pendingPanel=view==='match'?{hidden:true}:panel(view);
  if(error===key)return <section className="grf-statistics" {...pendingPanel}>{view==='data'&&details}<p role="alert">{t.error}</p><button onClick={()=>setAttempt(v=>v+1)}>{t.retry}</button></section>;
  const data=snapshot?.key===key?snapshot.data:null;
  if(!data)return <section className="grf-statistics" {...pendingPanel}>{view==='data'&&details}<p role="status">{t.loading}</p></section>;
  const names=new Map(data.players.map(p=>[p.id,p.name]));
  const number=(value:number,digits=1)=>new Intl.NumberFormat(locale,{maximumFractionDigits:digits}).format(value);
  const value=(metric:GrfStatisticsSummary['by_team'][string][string]|undefined)=>{
    if(metric?.value==null)return t.na;
    const unit=data.definitions[metric.definition_id]?.unit;
    return number(metric.value,unit==='count'?0:1)+(unit==='percent'?' %':unit==='m'?' m':'');
  };
  const possess=['home','away'].map(s=>data.by_team[s]?.team_possession_pct?.value??null);
  const shares=(home:number,away:number)=>[home/(home+away)*100,away/(home+away)*100];
  const assigned=data.by_team.home?.team_possession_pct?.denominator;
  const unassigned=assigned!=null&&data.coverage.eligible_ms>0?100*Math.max(0,data.coverage.eligible_ms-assigned)/data.coverage.eligible_ms:null;
  const table=(metrics:string[],caption:string,bars=false)=><div className="grf-stats-comparison table-scroll" tabIndex={0}><table><caption>{caption}</caption><thead><tr><th>{t.metric}</th><th>{data.home_name}</th><th>{data.away_name}</th></tr></thead><tbody>{metrics.map(name=>{
    const home=data.by_team.home?.[name]?.value,away=data.by_team.away?.[name]?.value,total=(home??0)+(away??0);
    return <tr key={name}><th scope="row">{t.metrics[name]}{bars&&home!=null&&away!=null&&total>0&&<span className="comparison-bar" aria-hidden="true"><i style={{width:`${shares(home,away)[0]}%`}}/><i style={{width:`${shares(home,away)[1]}%`}}/></span>}</th>{['home','away'].map(side=><td key={side}>{value(data.by_team[side]?.[name])}</td>)}</tr>;
  })}</tbody></table></div>;
  return <section className="grf-statistics" data-statistics-version={data.statistics_version} hidden={view==='match'}>
    <header className="grf-stats-header"><div><span className="eyebrow">GRF · {t.final}</span><h2>{t.title}</h2></div>
      <strong>{data.home_name} {data.score[0]} : {data.score[1]} {data.away_name}{data.full_time_ms!==null&&<small>{clockLabel(data.full_time_ms)}</small>}</strong></header>
    {!data.coverage.events_complete&&<p className="provenance">{t.noEvents}</p>}
    {!data.coverage.native_clock_available&&<p className="provenance">{t.noClock}</p>}
    <div {...panel('summary')}><MatchExtras key={key} model={grfExtras(data,record)} onSeek={onSeek} datasetVersion={record?.input.dataset_version??''}/><div className="summary-layout"><div className="summary-main"><h3>{c.keyStats}</h3>{table(priority,t.comparison,true)}
    {possess.every(v=>v!==null)&&possess[0]!+possess[1]!>0&&<div className="grf-possession" aria-label={t.metrics.team_possession_pct}>
      <div className="grf-possession-bar" aria-hidden="true"><i style={{width:`${shares(possess[0]!,possess[1]!)[0]}%`}}/><i style={{width:`${shares(possess[0]!,possess[1]!)[1]}%`}}/></div>
      <p>{data.home_name} {number(possess[0]!)} % · {data.away_name} {number(possess[1]!)} %</p><p className="small-note">{t.teamPossessionNote} {unassigned!==null&&`${t.unassigned}: ${number(unassigned)} %`}</p></div>}
    <details className="additional-team"><summary>{c.additional}</summary>{table(comparison.filter(name=>!priority.includes(name)),c.additional)}</details>
    <p className="small-note">{t.passNote}</p></div><aside className="summary-moments"><h3>{c.events}</h3>
    {data.goals.length>0&&<ol className="grf-goals">{data.goals.map(g=><li key={g.seq}>
      <button className="secondary" onClick={()=>onSeek(g.playback_ms)}>{clockLabel(g.match_time_ms)}</button>
      <span>{g.actor_id?names.get(g.actor_id):t.unknown}{g.own_goal?` · ${t.ownGoal}`:''}</span>
      <small>{g.side==='home'?data.home_name:data.away_name}{g.assist_id?` · ${t.assist}: ${names.get(g.assist_id)}`:''}</small>
    </li>)}</ol>}
    {!data.goals.length&&<p className="small-note">{data.coverage.events_complete?`${t.metrics.goals}: 0`:t.noEvents}</p>}</aside></div>
    </div>
    <div {...panel('players')} className="grf-player-statistics"><GrfPlayerTable data={data} value={value} record={record}/></div>
    <div {...panel('maps')}><GrfStatisticsPlots summary={data} onSeek={onSeek}/></div>
    <div {...panel('effort')}><h3>{t.effortTitle}</h3><p className="provenance">{t.effortNote}</p>
      <div className="table-scroll" tabIndex={0}><table><caption>{t.effortTitle}</caption><tbody>
        <tr><th scope="row">{t.exposure}</th><td>{data.coverage.native_clock_available?`${number((data.coverage.eligible_ms??0)/1000)} ${t.seconds}`:t.na}</td></tr>
        <tr><th scope="row">{t.excluded}</th><td>{data.coverage.native_clock_available?`${number((data.coverage.excluded_ms??0)/1000)} ${t.seconds}`:t.na}</td></tr>
        {[t.distance,t.averageSpeed,t.maximumSpeed,t.highSpeed].map(name=><tr key={name}><th scope="row">{name}</th><td>{t.na}</td></tr>)}
      </tbody></table></div></div>
    <div {...panel('data')}>
    {details}
    <p className="small-note">{t.exposure}: {data.coverage.native_clock_available?`${number((data.coverage.eligible_ms??0)/1000)} ${t.seconds}`:t.na} · {t.outside}: {data.coverage.native_clock_available?`${number((data.coverage.outside_player_ms??0)/1000)} ${t.seconds}`:t.na}</p>
    {!data.coverage.activity_verified&&data.coverage.native_clock_available&&<p className="small-note">{t.unverified}</p>}
    <p className="small-note">{t.positionNote}</p><p className="small-note">{t.free}: {data.coverage.free_ball_pct==null?t.na:`${number(data.coverage.free_ball_pct)} %`} · {t.directControlNote}</p>
    <p className="provenance">{t.unavailableStats}</p><p className="small-note">{t.teamOnly}</p>
    <details className="grf-stat-definitions"><summary>{t.version}</summary><dl>{Object.entries(data.definitions).map(([name,d])=><div key={name}><dt>{t.metrics[name]??name}</dt><dd>{locale==='es'?(t.definitions[name]??t.countDefinition):d.description}</dd></div>)}</dl></details>
    </div>
  </section>;
});
