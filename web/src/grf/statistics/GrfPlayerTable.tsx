import {Fragment,useState} from 'react';
import type {GrfReplay,GrfStatisticsSummary} from '../../api';
import {useCentreText} from '../../match-centre/messages';
import {useGrfStatsText} from './messages';
import {PlayerCard} from '../../match-centre/MatchExtras';
import {grfExtras} from '../../match-centre/extras-model';
import {useExtrasText} from '../../match-centre/extras-messages';

const groups={overview:['goals','assists','shots','recoveries'],
  passing:['pass_attempts','pass_received','confirmed_receipt_pct','pass_intercepted','pass_interrupted','pass_same_actor','pass_unresolved'],
  defending:['recoveries','fouls','offsides','own_goals']};
const all=[...new Set(Object.values(groups).flat())];
export function GrfPlayerTable({data,value,record}:{data:GrfStatisticsSummary;value:(metric:GrfStatisticsSummary['by_team'][string][string]|undefined)=>string;record?:GrfReplay}){
  const t=useGrfStatsText(),c=useCentreText();
  const [group,setGroup]=useState<keyof typeof groups>('overview'),[side,setSide]=useState('home'),[expanded,setExpanded]=useState<string[]>([]);
  const columns=groups[group];
  const x=useExtrasText(),[card,setCard]=useState('');
  const model=card?grfExtras(data,record):null,selected=model?.players.find(p=>p.id===card);
  return <><h3>{t.players}</h3><div className="player-filters">
    <div className="segmented" role="group" aria-label={t.playerTeam}>{(['home','away','all'] as const).map(s=><button key={s} aria-pressed={side===s} onClick={()=>setSide(s)}>{s==='home'?data.home_name:s==='away'?data.away_name:t.allTeams}</button>)}</div>
    <div className="segmented" role="group" aria-label={t.playerGroup}>{(Object.keys(groups) as (keyof typeof groups)[]).map(g=><button key={g} aria-pressed={group===g} onClick={()=>setGroup(g)}>{t[g]}</button>)}</div>
  </div><div className="table-scroll player-table-wrap" tabIndex={0}><table className="player-table"><caption>{t.players}</caption><thead><tr><th>{t.player}</th>{side==='all'&&<th className="desktop-cell">{t.team}</th>}<th className="desktop-cell">{t.role}</th>{columns.map((name,i)=><th key={name} aria-label={t.metrics[name]} className={i>=3?'extended-cell':''}><span className="desktop-label">{t.metrics[name]}</span><abbr className="mobile-label" title={t.metrics[name]}>{c.short[name]??t.metrics[name]}</abbr></th>)}<th className="player-expand"><span className="sr-only">{c.more}</span></th></tr></thead>
    <tbody>{data.players.filter(p=>side==='all'||p.side===side).map(p=>{
      const open=expanded.includes(p.id);
      return <Fragment key={p.id}><tr><th scope="row"><button className="player-link" aria-label={`${x.playerCard} ${p.name}`} onClick={()=>setCard(p.id)}>{p.name}</button><small className="mobile-label">{p.role}{side==='all'?` · ${p.side==='home'?data.home_name:data.away_name}`:''}</small></th>{side==='all'&&<td className="desktop-cell">{p.side==='home'?data.home_name:data.away_name}</td>}<td className="desktop-cell">{p.role}</td>{columns.map((name,i)=><td key={name} className={i>=3?'extended-cell':''}>{value(data.by_player[p.id]?.[name])}</td>)}<td className="player-expand"><button aria-label={`${c.playerDetail} ${p.name}`} aria-expanded={open} aria-controls={`player-${p.id}`} onClick={()=>setExpanded(v=>open?v.filter(id=>id!==p.id):[...v,p.id])}>{open?'−':'+'}</button></td></tr>
      {open&&<tr className="player-details"><td colSpan={columns.length+(side==='all'?4:3)}><h4 id={`player-${p.id}`}>{p.name} · {c.allGroups}</h4><dl>{all.map(name=><div key={name}><dt>{t.metrics[name]}</dt><dd>{value(data.by_player[p.id]?.[name])}</dd></div>)}</dl></td></tr>}</Fragment>;
    })}</tbody></table></div><p className="small-note mobile-label">{c.abbreviations}</p>
    {group==='passing'&&<p className="small-note">{t.playerPassNote} {t.passNote}</p>}
    {selected&&model&&<PlayerCard key={selected.id} player={selected} metrics={model.metrics[selected.id]??{}} datasetVersion={record?.input.dataset_version??''} onClose={()=>setCard('')}/>}</>;
}
