import {useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import type {TeamSeason} from '../api';
import {getTeam} from '../api';
import {useLanguage} from '../i18n';
import {clockLabel} from '../match/replay';
import {TeamCrest} from '../catalog/TeamCrest';
import {leaders,type ExtraModel,type ExtraPlayer,type ExtraAction} from './extras-model';
import {useExtrasText} from './extras-messages';

const metricKeys=['goals','assists','shots','pass_attempts','pass_received','recoveries','saves','tackles'];
export function MatchExtras({model,onSeek,datasetVersion}:{model:ExtraModel;onSeek:(ms:number)=>void;datasetVersion:string}){
  const t=useExtrasText(),{locale}=useLanguage();
  const [player,setPlayer]=useState(''),[type,setType]=useState('all'),[side,setSide]=useState('all'),[page,setPage]=useState(0),[selected,setSelected]=useState('');
  const players=new Map(model.players.map(p=>[p.id,p]));
  const filtered=model.actions.filter(e=>(type==='all'||e.type===type)&&(side==='all'||e.side===side));
  const pages=Math.max(1,Math.ceil(filtered.length/12)),currentPage=Math.min(page,pages-1);
  const action=filtered.find(e=>e.id===selected);
  const number=(n:number)=>new Intl.NumberFormat(locale,{maximumFractionDigits:1}).format(n);
  const playerButton=(p:ExtraPlayer)=><button type="button" className="player-link" aria-label={`${t.playerCard} ${p.name}`} onClick={()=>setPlayer(p.id)}>{p.name}</button>;
  return <div className="match-extras">
    <section aria-label={t.highlights} className="standouts"><header><span className="eyebrow">{t.performance}</span><h3>{t.highlights}</h3><p className="small-note">{t.criterion}</p></header>
      <div className="standout-grid">{[['goals',t.scoring],['pass_received',t.creation],['recoveries',t.defending]].map(([metric,title])=>{
        const lead=leaders(model,metric);return <article className="standout-card" key={metric}><span className="eyebrow">{title}</span><p className="standout-value">{lead.players.length?number(lead.count):'—'} <small>{t.metric[metric]}</small></p>
          {lead.players.slice(0,2).map(p=><div className="standout-player" key={p.id}><TeamCrest compact teamKey={p.teamKey}/><div>{playerButton(p)}<small>{p.teamName}</small></div></div>)}
          {lead.players.length>1&&<p className="small-note">{t.shared} · {lead.players.length}</p>}
          {lead.players.length>2&&<details><summary>{t.all} ({lead.players.length})</summary>{lead.players.slice(2).map(p=><div key={p.id}>{playerButton(p)} <small>{p.teamName}</small></div>)}</details>}
          {!lead.players.length&&<p className="small-note">{t.none}</p>}</article>;
      })}</div>
    </section>
    <section className="action-explorer" aria-label={t.actions}><header className="section-line"><h3>{t.actions}</h3><span className="small-note">{filtered.length} {t.count}</span></header>
      {!model.complete&&<p className="provenance">{t.coverage}</p>}
      <div className="extras-filters"><label>{t.type}<select value={type} onChange={e=>{setType(e.target.value);setPage(0);setSelected('');}}><option value="all">{t.all}</option>{Object.entries(t.event).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
        <label>{t.team}<select value={side} onChange={e=>{setSide(e.target.value);setPage(0);setSelected('');}}><option value="all">{t.all}</option>{(['home','away'] as const).map(s=><option key={s} value={s}>{model.players.find(p=>p.side===s)?.teamName??s}</option>)}</select></label>
        <label>{t.playerCard}<select value={player} onChange={e=>setPlayer(e.target.value)}><option value="">{t.all}</option>{model.players.map(p=><option key={p.id} value={p.id}>{p.name} · {p.teamName}</option>)}</select></label></div>
      <div className="action-explorer-grid"><div><ol className="action-list">{filtered.slice(currentPage*12,currentPage*12+12).map(e=><li key={e.id}><button type="button" className={selected===e.id?'action-choice selected':'action-choice'} aria-pressed={selected===e.id} aria-label={`${t.inspect} ${t.event[e.type]??e.type} ${clockLabel(e.time)} ${players.get(e.players[0])?.name??t.unknown}`} onClick={()=>setSelected(e.id)}><time>{clockLabel(e.time)}</time><span><strong>{t.event[e.type]??e.type}</strong><small>{players.get(e.players[0])?.name??t.unknown}</small></span><span aria-hidden="true">→</span></button></li>)}</ol>
        {!filtered.length&&<p className="small-note">{t.empty}</p>}
        {pages>1&&<div className="action-pagination"><button className="secondary" disabled={currentPage===0} onClick={()=>setPage(currentPage-1)}>{t.previous}</button><span>{t.page} {currentPage+1} / {pages}</span><button className="secondary" disabled={currentPage>=pages-1} onClick={()=>setPage(currentPage+1)}>{t.next}</button></div>}
      </div>{action?<section aria-label={t.detail} className="recorded-action"><h4>{t.detail}</h4><p className="action-title">{clockLabel(action.time)} · {t.event[action.type]}</p><p className="outcome-tag">{t.outcome[action.outcome]??action.outcome}</p><div className="action-participants">{action.players.length?action.players.map((id,i)=><span key={id}>{i>0&&' · '}{players.has(id)?playerButton(players.get(id)!):t.unknown}</span>):t.unknown}</div>
        <ActionRoute action={action}/><button type="button" onClick={()=>onSeek(action.seek)}>{t.watch}</button>
        <details className="action-evidence"><summary>{t.evidence}</summary><p>{action.refs.join(', ')}</p><dl>{Object.entries(action.evidence).map(([key,value])=><div key={key}><dt>{key}</dt><dd>{String(value)}</dd></div>)}</dl></details>
      </section>:<div className="action-empty"><span aria-hidden="true">↗</span><p>{t.inspect} · {t.detail.toLowerCase()}</p></div>}</div>
    </section>
    {players.has(player)&&<PlayerCard key={player} player={players.get(player)!} metrics={model.metrics[player]??{}} datasetVersion={datasetVersion} onClose={()=>setPlayer('')}/>}
  </div>;
}

function ActionRoute({action}:{action:ExtraAction}){
  const t=useExtrasText();
  const valid=(p?:[number,number])=>p&&p.every(Number.isFinite)&&p[0]>=0&&p[0]<=105&&p[1]>=0&&p[1]<=68;
  if(!valid(action.start)||!valid(action.end))return <p className="small-note">{t.noRoute}{valid(action.start)&&` ${t.endpoint}: ${action.start!.map(n=>n.toFixed(1)).join(', ')} m`}</p>;
  return <><svg viewBox="-2 -2 109 72" className="action-route" role="img" aria-label={`${t.route}: ${action.start!.map(n=>n.toFixed(1)).join(', ')} → ${action.end!.map(n=>n.toFixed(1)).join(', ')} m`}>
    <rect width="105" height="68" rx="1"/><path d="M52.5 0V68 M0 14H16.5V54H0 M105 14H88.5V54H105"/><circle cx="52.5" cy="34" r="9.15"/>
    <line className="action-route-line" x1={action.start![0]} y1={action.start![1]} x2={action.end![0]} y2={action.end![1]}/><circle className="action-route-start" cx={action.start![0]} cy={action.start![1]} r="1.8"/><circle className="action-route-end" cx={action.end![0]} cy={action.end![1]} r="2.4"/>
  </svg><p className="small-note">{t.routeNote}</p></>;
}

export function PlayerCard({player,metrics,datasetVersion,onClose}:{player:ExtraPlayer;metrics:Record<string,number>;datasetVersion:string;onClose:()=>void}){
  const t=useExtrasText(),{locale}=useLanguage(),dialog=useRef<HTMLDialogElement>(null),titleId=useId();
  const [snapshot,setSnapshot]=useState<{team:TeamSeason|null;failed:boolean}|null>(null);
  useLayoutEffect(()=>{const previous=document.activeElement;const element=dialog.current;if(element){if(typeof element.showModal==='function')element.showModal();else element.setAttribute('open','');}return()=>{if(element?.open){if(typeof element.close==='function')element.close();else element.removeAttribute('open');}if(previous instanceof HTMLElement)previous.focus();};},[]);
  useEffect(()=>{const control=new AbortController();setSnapshot(null);
    if(!player.teamKey){setSnapshot({team:null,failed:true});return;}
    getTeam(player.teamKey,control.signal).then(team=>{if(!control.signal.aborted)setSnapshot({team,failed:false});}).catch(()=>{if(!control.signal.aborted)setSnapshot({team:null,failed:true});});
    return()=>control.abort();
  },[player.teamKey]);
  const sourcePlayer=snapshot?.team?.players.find(p=>p.key===player.sourceKey);
  const num=(n:number)=>new Intl.NumberFormat(locale,{maximumFractionDigits:2}).format(n);
  const season=Number(player.teamKey.split(':').at(-1));
  return <dialog ref={dialog} className="player-card" aria-labelledby={titleId} onCancel={e=>{e.preventDefault();onClose();}} onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();onClose();}}}>
    <header className="player-card-header"><TeamCrest teamKey={player.teamKey}/><div><span className="eyebrow">{player.teamName}</span><h2 id={titleId}>{player.name}</h2><p>{player.role}{Number.isFinite(season)&&season>0?` · ${season}/${String(season+1).slice(-2)}`:''}</p></div><button type="button" className="secondary" aria-label={t.close} onClick={onClose}>×</button></header>
    <section><h3>{t.performance}</h3><dl className="player-card-metrics">{metricKeys.filter(key=>Number.isFinite(metrics[key])).map(key=><div key={key}><dt>{t.metric[key]}</dt><dd>{num(metrics[key])}</dd></div>)}</dl>{!metricKeys.some(key=>Number.isFinite(metrics[key]))&&<p>{t.noMetric}</p>}</section>
    <section><h3>{t.historical}</h3><p className="small-note">{t.historicalNote}</p>{!snapshot?<p role="status">{t.loading}</p>:sourcePlayer?<><p className="small-note">{t.source}: {snapshot.team!.source} · {snapshot.team!.season_label}</p>{snapshot.team!.dataset_version!==datasetVersion&&<p className="provenance">{t.changed}</p>}<dl className="player-card-metrics">{['appearances','minutes','goals',snapshot.team!.source==='fpl'?'assists_fpl':'assists'].map(key=>{const metric=sourcePlayer.stats[key];return <div key={key}><dt>{t.metric[key]}</dt><dd>{metric?.value==null?'—':num(metric.value)}{metric&&metric.status!=='measured'&&<small>{metric.status}</small>}</dd></div>;})}</dl></>:<p>{t.noHistory}</p>}</section>
    <section><h3>{t.attributes}</h3>{player.attributes&&Object.keys(player.attributes).length?<><p className="small-note">{t.attributeNote}</p><dl className="player-card-metrics">{Object.entries(player.attributes).map(([key,value])=><div key={key}><dt>{t.attribute[key]??key}</dt><dd>{num(value)}</dd></div>)}</dl></>:<p className="small-note">{t.noAttributes}</p>}</section>
  </dialog>;
}
