import {useEffect,useState} from 'react';
import {getMatches,getGrfMatches} from '../api';
import {readComparison,type ComparisonResult,type MatchupPrefill} from './api';
import {readComparisonLink,writeComparisonLink,clearComparisonLink,type ComparisonLink} from './matchup';
import {useComparisonText} from './comparison-messages';
import type {TeamSelection} from '../match/useTeam';

export function PreparationNote({value,home,away,onExact,onDismiss}:{value:MatchupPrefill;home:TeamSelection;away:TeamSelection;onExact:()=>void;onDismiss:()=>void}){
  const t=useComparisonText();
  const status=[home.preparationStatus,away.preparationStatus];
  return <aside className="historical-preparation" aria-label={t.source}><header><h2>{t.source}</h2><button onClick={onDismiss} aria-label={t.clear}>×</button></header>
    <p>{status.includes('failed')?t.failed:status.includes('loading')?t.preparing:status.every(s=>s==='exact')?t.exactCopied:status.includes('edited')?t.edited:t.clubsOnly}</p>
    <dl>{(['home','away'] as const).map(side=><div key={side}><dt>{side==='home'?t.home:t.away} · {value[side].catalog_key}</dt><dd>{t.formation}: {value[side].source_formation??t.unavailable}</dd></div>)}</dl>
    {!value.exact_xi_available&&<p>{t.notExact}</p>}
    <ul>{[...new Set([...value.home.differences,...value.away.differences])].map(code=><li key={code}>{t[code as keyof typeof t]??code}</li>)}</ul>
    <button disabled={!value.exact_xi_available||status.includes('loading')} onClick={onExact}>{t.exact}</button>
  </aside>;
}

export function HistoricalComparison({historicalMatchId,datasetVersion,engine,simulationId}:{historicalMatchId:number;datasetVersion:string;engine:'timepitch'|'grf';simulationId:string}){
  const t=useComparisonText(),[data,setData]=useState<ComparisonResult|null>(null),[error,setError]=useState(false);
  useEffect(()=>{
    const controller=new AbortController();setError(false);setData(null);
    void readComparison(historicalMatchId,engine,simulationId,controller.signal).then(value=>{
      if(value.historical_match_id!==historicalMatchId||value.historical_dataset_version!==datasetVersion||value.engine!==engine||value.simulation_id!==simulationId)throw new Error('Comparison identity changed');
      if(!controller.signal.aborted)setData(value);
    }).catch(()=>{if(!controller.signal.aborted)setError(true);});
    return()=>controller.abort();
  },[historicalMatchId,datasetVersion,engine,simulationId]);
  if(error)return <p role="alert">{t.error}</p>;
  if(!data||data.historical_match_id!==historicalMatchId||data.historical_dataset_version!==datasetVersion||data.engine!==engine||data.simulation_id!==simulationId)return <p role="status">{t.loading}</p>;
  const number=(value:number|null)=>value===null?t.unavailable:Number.isInteger(value)?value:value.toFixed(2);
  return <section className="historical-comparison" aria-label={t.comparison}><p>{t.note}</p><p>{t.engine}: {engine==='grf'?'GRF':'TimePitch'} · {data.engine_version} · {t.seed}: {data.seed}</p>
    <details><summary>{t.differences}</summary><dl>{(['home','away'] as const).map(side=><div key={side}><dt>{side==='home'?t.home:t.away}</dt><dd>{data.historical_formations[side]??t.unavailable} → {data.simulated_formations[side]}</dd></div>)}</dl><ul>{data.lineup_differences.map(code=><li key={code}>{t[code as keyof typeof t]??code}</li>)}</ul></details>
    <div className="comparison-grid">{data.rows.map(row=><article key={row.metric} className="comparison-metric"><header><h3>{t[row.metric]}</h3><span className="evidence-badge">{t[row.status]}</span></header>
      <div className="historical-table"><table><caption>{t[row.metric]}</caption><thead><tr><th>{t.source}</th><th>{t.home}</th><th>{t.away}</th></tr></thead><tbody><tr><th scope="row">{t.historical}</th><td>{number(row.historical.home)}</td><td>{number(row.historical.away)}</td></tr><tr><th scope="row">{t.simulated}</th><td>{number(row.simulated.home)}</td><td>{number(row.simulated.away)}</td></tr>{row.status==='comparable'&&row.delta&&<tr><th scope="row">{t.delta}</th><td>{number(row.delta.home)}</td><td>{number(row.delta.away)}</td></tr>}</tbody></table></div>
      <details><summary>{t.definitions}</summary><p>{t.historical}: {row.historical.definition}</p><p>{t.simulated}: {row.simulated.definition}</p></details>
      {row.metric==='shots'&&row.simulated.definition==='grf-native-shot-actions'&&<p>{t.grfShots}</p>}
    </article>)}</div><details><summary>{t.definitions}</summary><p>{data.trace_hash}</p><p>{data.historical_dataset_version}</p><ul>{data.issues.map(code=><li key={code}>{code}</li>)}</ul></details>
  </section>;
}

export function HistoricalComparisonPanel({historicalMatchId,datasetVersion}:{historicalMatchId:number;datasetVersion:string}){
  const t=useComparisonText(),[link,setLink]=useState<ComparisonLink|null>(readComparisonLink);
  const [choices,setChoices]=useState<{engine:'timepitch'|'grf';id:string;label:string}[]|null>(null),[error,setError]=useState(false),[partial,setPartial]=useState(false);
  useEffect(()=>{
    const controller=new AbortController();
    let generation=0;
    const refresh=()=>{const current=++generation;void Promise.allSettled([getMatches(controller.signal),getGrfMatches(controller.signal)]).then(results=>{
      if(controller.signal.aborted||current!==generation)return;
      const [timepitch,grf]=results.map(result=>result.status==='fulfilled'?result.value:[]);
      const failures=results.filter(result=>result.status==='rejected').length;
      setError(failures===2);setPartial(failures===1);
      setChoices([...timepitch.filter(j=>j.state==='ready').map(j=>({engine:'timepitch' as const,id:j.id,label:`TimePitch · ${j.config.home_key} — ${j.config.away_key} · ${j.config.seed}`})),...grf.filter(j=>j.state==='ready').map(j=>({engine:'grf' as const,id:j.id,label:`GRF · ${j.config.home_key} — ${j.config.away_key} · ${j.config.seed}`}))]);
    }).catch(()=>{if(!controller.signal.aborted&&current===generation)setError(true);});};
    refresh();
    const update=()=>{setLink(readComparisonLink());refresh();};window.addEventListener('timepitch:comparison-change',update);
    return()=>{controller.abort();window.removeEventListener('timepitch:comparison-change',update);};
  },[historicalMatchId]);
  const current=link?.historicalMatchId===historicalMatchId?link:null;
  return <section className="comparison-chooser"><h2>{t.comparison}</h2><label>{t.choose}<select value={current?`${current.engine}/${current.simulationId}`:''} onChange={e=>{
    const selected=choices?.find(c=>`${c.engine}/${c.id}`===e.target.value);
    if(selected){const link={historicalMatchId,engine:selected.engine,simulationId:selected.id};setLink(link);writeComparisonLink(link);}else {setLink(null);clearComparisonLink();}
  }}><option value="">{t.choose}</option>{choices?.map(c=><option key={`${c.engine}/${c.id}`} value={`${c.engine}/${c.id}`}>{c.label}</option>)}</select></label>
    {error?<p role="alert">{t.error}</p>:<>{partial&&<p role="alert">{t.partialHistory}</p>}{choices?.length===0&&<p>{t.noMatches}</p>}</>}
    {current&&<HistoricalComparison historicalMatchId={historicalMatchId} datasetVersion={datasetVersion} engine={current.engine} simulationId={current.simulationId}/>}
  </section>;
}
