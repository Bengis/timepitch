import {useState} from 'react';
import type {HistoricalMatch,HistoricalStatistics} from './api';
import {useHistoricalText} from './messages';
import {ProvenanceBadge} from './provenance';
export function HistoricalAnalysis({match,statistics,cutoffLabel=''}:{match:HistoricalMatch;statistics:HistoricalStatistics|null;cutoffLabel?:string}){
  const h=useHistoricalText(),[page,setPage]=useState(0),[action,setAction]=useState(''),[team,setTeam]=useState(match.home_team.key);
  const names=new Map(match.lineups?.flatMap(l=>l.players.map(p=>[p.key,p.name] as const)));
  const points=statistics?.action_map.filter(p=>!action||p.type===action)??[];
  const edges=statistics?.pass_network.filter(e=>e.team_key===team)??[];
  const displayPage=Math.min(page,Math.max(0,Math.ceil(points.length/50)-1));
  const keys=[...new Set(edges.flatMap(e=>[e.player_key,e.recipient_key]))].sort();
  const nodes=new Map(keys.map((key,i)=>[key,{x:140+90*Math.cos(i/keys.length*2*Math.PI),y:110+75*Math.sin(i/keys.length*2*Math.PI)}]));
  return <div className="historical-analysis"><p>{h.snapshot} <strong>{statistics?.display_clock??cutoffLabel}</strong> · {statistics?.definition_version??'statsbomb-events-1'} <ProvenanceBadge kind="derived_from_events"/></p>
    <p>{h.notTracking}</p>
    <div className="historical-analysis-controls"><label>{h.mapFilter}<select value={action} onChange={e=>{setAction(e.target.value);setPage(0);}}><option value="">{h.all}</option>{[...new Set([action,...statistics?.action_map.map(p=>p.type)??[]])].filter(Boolean).map(type=><option key={type}>{type}</option>)}</select></label><label>{h.allTeams}<select value={team} onChange={e=>setTeam(e.target.value)}>{[match.home_team,match.away_team].map(t=><option key={t.key} value={t.key}>{t.name}</option>)}</select></label></div>
    {!statistics&&<p role="status">{h.loading}</p>}
    <div hidden={!statistics}>
    {!points.length&&!statistics?.pass_network.length&&<p>{h.noAnalysis}</p>}
    <section className="analysis-panel"><h3>{h.actionMap}</h3><svg className="historical-action-map" viewBox="-2 -2 109 72" role="img" aria-label={h.actionMap}>
      <rect x="0" y="0" width="105" height="68"/><path d="M52.5 0V68"/>{points.map((p,i)=><circle key={`${p.event_id}-${i}`} cx={p.location.x} cy={p.location.y} r={p.type==='Shot'?1.2:.5} className={p.team_key===match.home_team.key?'home-point':'away-point'}><title>{p.type} · {names.get(p.player_key??'')??p.player_key} · {p.event_id}</title></circle>)}
    </svg><p>{match.home_team.name} ● · {match.away_team.name} ○</p>
      <div className="historical-table"><table><caption>{h.actionMap} · {h.sourceRecorded}</caption><thead><tr><th>{h.eventId}</th><th>{h.eventType}</th><th>{h.player}</th><th>x / y (m)</th></tr></thead><tbody>{points.slice(displayPage*50,(displayPage+1)*50).map((p,i)=><tr key={`${p.event_id}-${i}`}><td>{p.event_id}</td><td>{p.type}</td><td>{names.get(p.player_key??'')??p.player_key??h.missing}</td><td>{p.location.x.toFixed(1)} / {p.location.y.toFixed(1)}</td></tr>)}</tbody></table></div>
      <div className="archive-pagination"><button disabled={!displayPage} onClick={()=>setPage(displayPage-1)}>{h.previous}</button><span>{displayPage+1} / {Math.max(1,Math.ceil(points.length/50))}</span><button disabled={(displayPage+1)*50>=points.length} onClick={()=>setPage(displayPage+1)}>{h.next}</button></div>
    </section>
    <section className="analysis-panel"><h3>{h.zones}</h3><div className="historical-table"><table><caption>{h.zones} · {h.derived}</caption><thead><tr><th>x (m)</th><th>{match.home_team.name}</th><th>{match.away_team.name}</th></tr></thead><tbody>{[0,35,70].map(x=><tr key={x}><th scope="row">{x}–{x+35}</th>{[match.home_team.key,match.away_team.key].map(team=><td key={team}>{points.filter(p=>p.team_key===team&&p.location.x>=x&&(p.location.x<x+35||x===70&&p.location.x===105)).length}</td>)}</tr>)}</tbody></table></div></section>
    <section className="analysis-panel"><h3>{h.network}</h3><p>{h.schematicNote}</p>
      <svg className="historical-network" viewBox="0 0 280 220" role="img" aria-label={h.schematic}>{edges.map(edge=>{const a=nodes.get(edge.player_key)!,b=nodes.get(edge.recipient_key)!;return <line key={`${edge.player_key}/${edge.recipient_key}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeWidth={Math.min(5,1+Math.log2(edge.count))}><title>{names.get(edge.player_key)??edge.player_key} → {names.get(edge.recipient_key)??edge.recipient_key}: {edge.count}</title></line>;})}{keys.map(key=>{const point=nodes.get(key)!;return <g key={key}><title>{names.get(key)??key}</title><circle cx={point.x} cy={point.y} r="6"/><text x={point.x} y={point.y-12} textAnchor="middle">{(names.get(key)??key).split(' ').at(-1)!.slice(0,12)}</text></g>;})}</svg>
      <div className="historical-table"><table><caption>{h.network} · {h.derived}</caption><thead><tr><th>{h.player}</th><th>{h.recipient}</th><th>{h.count}</th></tr></thead><tbody>{edges.map(edge=><tr key={`${edge.team_key}/${edge.player_key}/${edge.recipient_key}`}><th scope="row">{names.get(edge.player_key)??edge.player_key}</th><td>{names.get(edge.recipient_key)??edge.recipient_key}</td><td>{edge.count}</td></tr>)}</tbody></table></div></section>
    </div>
  </div>;
}
