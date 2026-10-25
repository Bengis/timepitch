import { memo,useState } from 'react';
import type { PlotPoint,RenderFrame } from '../../api';
import { useLanguage } from '../../i18n';
import { clockLabel } from '../replay';
import { useStatsText } from './messages';

export const StatisticsPlots=memo(function StatisticsPlots({plots,endMs,home,away,players,playerKey,onInspect}:{
  plots:Record<string,PlotPoint[]>;endMs:number;home:string;away:string;players:RenderFrame['players'];
  playerKey?:string;onInspect?:(id:string)=>void;
}){
  const t=useStatsText(),{locale}=useLanguage();
  const [type,setType]=useState('shots'),[side,setSide]=useState('all'),[phase,setPhase]=useState('in_possession');
  const network=type==='passes';
  const plotKey=type==='occupancy'?'occupancy_'+phase:network?'pass_edges':type;
  const effectiveSide=type==='occupancy'&&side==='all'?'home':side;
  const points=(plots[plotKey]??[]).filter(p=>p.time_ms<=endMs&&(effectiveSide==='all'||p.side===effectiveSide)
    &&(type==='xg'||!playerKey||p.player_key===playerKey||(network&&p.related_player_key===playerKey)));
  const names=new Map(players.map(p=>[p.key,p.name]));
  const color=(s:string)=>s==='home'?'#efa36a':'#88d1e1';
  const label=type==='effort'?t.effortChart:t[type as 'shots'|'xg'|'actions'|'occupancy'|'passes'];
  const pitch=type==='shots'||type==='actions'||type==='occupancy';
  const max=Math.max(1,...points.map(p=>p.value));
  const format=(v:number)=>new Intl.NumberFormat(locale,{maximumFractionDigits:2}).format(v);
  const axis=(v:number)=>new Intl.NumberFormat(locale,{notation:'compact',maximumFractionDigits:1}).format(v);
  const series=new Map<string,PlotPoint[]>();
  if(!pitch&&!network)for(const point of points){const key=type==='xg'?point.side:point.player_key??point.side;series.set(key,[...(series.get(key)??[]),point]);}
  function node(key:string){
    const player=players.find(p=>p.key===key);
    const roster=players.filter(p=>p.side===player?.side),index=roster.findIndex(p=>p.key===key);
    const angle=-Math.PI/2+2*Math.PI*index/Math.max(1,roster.length),both=effectiveSide==='all';
    const center=both?(player?.side==='home'?157.5:472.5):315,radius=both?112:155;
    return {x:center+radius*Math.cos(angle),y:204+radius*Math.sin(angle),slot:index+1};
  }
  function path(data:PlotPoint[]){
    let d='M 60 378';
    for(const p of data){const x=60+p.time_ms/Math.max(1,endMs)*550,y=378-p.value/max*340;d+=type==='xg'?` H ${x} V ${y}`:` L ${x} ${y}`;}
    return type==='xg'?d+' H 610':d;
  }
  return <section className="statistics-plots"><h3>{t.plots}</h3>
    <div className="statistics-controls"><label>{t.chart}<select value={type} onChange={e=>setType(e.target.value)}>
      <option value="shots">{t.shots}</option><option value="xg">{t.xg}</option><option value="actions">{t.actions}</option><option value="passes">{t.passes}</option><option value="occupancy">{t.occupancy}</option><option value="effort">{t.effortChart}</option>
    </select></label><label>{t.side}<select value={effectiveSide} onChange={e=>setSide(e.target.value)}>
      <option value="all" disabled={type==='occupancy'}>{t.team}</option><option value="home">{home}</option><option value="away">{away}</option>
    </select></label>{type==='occupancy'&&<label>{t.phase}<select value={phase} onChange={e=>setPhase(e.target.value)}><option value="in_possession">{t.inPossession}</option><option value="out_of_possession">{t.outOfPossession}</option></select></label>}</div>
    <p className="chart-legend"><span className="home-legend">● {home}</span><span className="away-legend">● {away}</span></p>
    {type==='xg'&&<p className="small-note">{t.xgTeamNote}</p>}
    {points.length?<figure><svg viewBox="0 0 630 408" role="img" aria-label={label} className="statistics-chart">
      <title>{label}</title>
      {network?<>
        <defs>{['home','away'].map(s=><marker key={s} id={'pass-arrow-'+s} markerWidth="6" markerHeight="6" refX="6" refY="3" orient="auto"><path d="M 0 0 L 6 3 L 0 6 Z" fill={color(s)}/></marker>)}</defs>
        {points.map((p,i)=>{const a=node(p.player_key??''),b=node(p.related_player_key??''),length=Math.max(1,Math.hypot(b.x-a.x,b.y-a.y));return <path key={p.event_id??i} d={`M ${a.x} ${a.y} L ${b.x-15*(b.x-a.x)/length} ${b.y-15*(b.y-a.y)/length}`} stroke={color(p.side)} strokeWidth="1.5" strokeOpacity=".3" markerEnd={'url(#pass-arrow-'+p.side+')'} fill="none" tabIndex={0} role="button"
          aria-label={`${t.inspectEvent} ${p.event_id} · ${clockLabel(p.time_ms)} · ${names.get(p.player_key??'')} → ${names.get(p.related_player_key??'')}`}
          onClick={()=>p.event_id&&onInspect?.(p.event_id)} onKeyDown={e=>{if((e.key==='Enter'||e.key===' ')&&p.event_id){e.preventDefault();onInspect?.(p.event_id);}}}><title>{names.get(p.player_key??'')} → {names.get(p.related_player_key??'')}</title></path>;})}
        {players.filter(p=>effectiveSide==='all'||p.side===effectiveSide).map(p=>{const n=node(p.key);return <g key={p.key}><circle cx={n.x} cy={n.y} r="13" fill={color(p.side)} stroke={p.key===playerKey?'#fff':'#152e24'} strokeWidth={p.key===playerKey?3:1}><title>{p.side==='home'?home:away} · {p.name}</title></circle><text x={n.x} y={n.y+4} textAnchor="middle" fill="#14241c" fontSize="12">{n.slot}</text></g>;})}
      </>:pitch?<><rect x="1" y="1" width="628" height="406" fill="#152e24" stroke="#789687"/>
        <path d="M 315 0 V 408 M 0 104 H 99 V 304 H 0 M 630 104 H 531 V 304 H 630" fill="none" stroke="#789687"/>
        <circle cx="315" cy="204" r="55" fill="none" stroke="#789687"/>
        {points.map((p,i)=>type==='occupancy'?<rect key={i} x={(p.x??0)*6-26.25} y={(p.y??0)*6-25.5} width="52.5" height="51" fill={color(p.side)} fillOpacity={.12+.7*p.value/max}><title>{format(p.value)} {locale==='es'?'jugador·s':'player·s'}</title></rect>:
          <circle key={p.event_id??i} cx={(p.x??0)*6} cy={(p.y??0)*6} r={type==='shots'?5+Math.sqrt(Math.max(0,p.value))*13:4}
            fill={color(p.side)} fillOpacity=".7" stroke="#fff" strokeWidth=".7" tabIndex={0} role="button"
            aria-label={`${t.inspectEvent} ${p.event_id} · ${clockLabel(p.time_ms)} · ${names.get(p.player_key??'')??''}`}
            onClick={()=>p.event_id&&onInspect?.(p.event_id)} onKeyDown={e=>{if((e.key==='Enter'||e.key===' ')&&p.event_id){e.preventDefault();onInspect?.(p.event_id);}}}>
            <title>{clockLabel(p.time_ms)} · {names.get(p.player_key??'')} · {format(p.value)}</title></circle>)}
      </>:<><path d="M 60 20 V 378 H 610" fill="none" stroke="#789687"/>
        {[0,.5,1].map(f=><g key={f}><path d={`M 60 ${378-f*340} H 610`} stroke="#355346" strokeDasharray="4 4"/><text x="3" y={378-f*340} fill="#dbe8dd" fontSize="13">{axis(f*max)}</text></g>)}
        <text x="60" y="402" fill="#dbe8dd" fontSize="13">0:00</text><text x="550" y="402" fill="#dbe8dd" fontSize="13">{clockLabel(endMs)}</text>
        {[...series].map(([key,values])=><path key={key} d={path(values)} fill="none" stroke={color(values[0].side)} strokeWidth="2"><title>{names.get(key)??(key==='home'?home:away)}</title></path>)}
      </>}
    </svg><figcaption>{network?t.passNote:type==='occupancy'?t.occupancyUnit+' '+(phase==='in_possession'?t.inPossession:t.outOfPossession):type==='effort'?t.distanceUnit:type==='actions'?t.actionNote:pitch?t.direction:t.teamXg}</figcaption></figure>:<p className="small-note">{t.noChart}</p>}
    {Boolean(points.length)&&<details className="chart-data"><summary>{t.chartData} · {points.length}</summary><div className="table-scroll" tabIndex={0} role="region" aria-label={t.chartData}><table>
      <thead><tr><th>{t.time}</th><th>{t.side}</th><th>{type==='xg'?t.shooter:t.player}</th>{network&&<th>{t.receiver}</th>}{pitch&&<th>{t.position}</th>}<th>{type==='xg'?t.teamXg:t.value}</th></tr></thead>
      <tbody>{points.map((p,i)=><tr key={i}><td>{p.event_id?<button className="secondary" onClick={()=>onInspect?.(p.event_id!)}>{clockLabel(p.time_ms)}</button>:clockLabel(p.time_ms)}</td>
        <td>{p.side==='home'?home:away}</td><td>{names.get(p.player_key??'')??'—'}</td>{network&&<td>{names.get(p.related_player_key??'')??'—'}</td>}{pitch&&<td>{format(p.x??0)}, {format(p.y??0)}</td>}<td>{format(p.value)} {type==='occupancy'?(locale==='es'?'jugador·s':'player·s'):type==='effort'?'m':type==='shots'||type==='xg'?'xG':''}</td></tr>)}</tbody>
    </table></div></details>}
  </section>;
});
