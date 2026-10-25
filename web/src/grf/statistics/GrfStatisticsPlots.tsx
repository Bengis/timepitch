import {useState} from 'react';
import type {ReactNode} from 'react';
import type {GrfStatisticsSummary} from '../../api';
import {clockLabel} from '../../match/replay';
import {useCentreText} from '../../match-centre/messages';
import {useGrfStatsText} from './messages';

function Field({label,children,points=[]}:{label:string;children:ReactNode;points?:{x:number;y:number}[]}){
  const left=Math.min(-5,...points.map(p=>p.x-2)),top=Math.min(-5,...points.map(p=>p.y-2));
  const width=Math.max(110,...points.map(p=>p.x+2))-left,height=Math.max(73,...points.map(p=>p.y+2))-top;
  return <svg className="grf-stat-field" viewBox={`${left} ${top} ${width} ${height}`} role="img" aria-label={label}>
    <rect x={left} y={top} width={width} height={height} fill="#122d22"/>
    <g stroke="#7eab83" strokeWidth=".35" fill="none"><rect width="105" height="68"/><path d="M52.5 0V68 M0 13.84H16.5V54.16H0 M105 13.84H88.5V54.16H105"/><circle cx="52.5" cy="34" r="9.15"/></g>{children}
  </svg>;
}

export function GrfStatisticsPlots({summary:s,onSeek}:{summary:GrfStatisticsSummary;onSeek:(ms:number)=>void}){
  const c=useCentreText(),[map,setMap]=useState('shots');
  const t=useGrfStatsText(),[side,setSide]=useState<'home'|'away'>('home'),[phase,setPhase]=useState(1),[player,setPlayer]=useState('');
  const shape=s.team_shape.filter(v=>v.side===side&&v.phase===phase);
  const names=new Map(s.players.map(p=>[p.id,p.name]));
  const selected=(id:string)=>!player||id===player;
  const shots=s.shots.filter(v=>v.side===side&&v.phase===phase&&selected(v.actor_id));
  const positions=s.positions.filter(v=>v.side===side&&v.phase===phase);
  const nodes=new Map(positions.map(v=>[v.player_id,v]));
  const edges=s.pass_edges.filter(v=>v.side===side&&(!player||v.source_id===player||v.target_id===player));
  const phaseEdges=edges.filter(v=>v.phase===phase);
  const connected=new Set(phaseEdges.flatMap(e=>[e.source_id,e.target_id]));
  const bins=new Map<string,{col:number;row:number;duration_ms:number}>();
  for(const cell of s.occupancy.filter(v=>v.side===side&&v.phase===phase&&selected(v.player_id))){
    const key=cell.col+':'+cell.row,bin=bins.get(key)??{col:cell.col,row:cell.row,duration_ms:0};bin.duration_ms+=cell.duration_ms;bins.set(key,bin);
  }
  const cells=[...bins.values()],max=Math.max(1,...cells.map(c=>c.duration_ms));
  return <div className="grf-stats-plots"><div className="segmented map-switch" role="group" aria-label={c.allMaps}>{[['shots',t.shotMap],['network',t.network],['occupancy',t.occupancy],['shape',t.shape]].map(([key,label])=><button key={key} aria-pressed={map===key} onClick={()=>setMap(key)}>{label}</button>)}</div><div className="grf-plot-controls">
    <label>{t.team}<select value={side} onChange={e=>{setSide(e.target.value as 'home'|'away');setPlayer('');}}><option value="home">{s.home_name}</option><option value="away">{s.away_name}</option></select></label>
    <label>{t.half}<select value={phase} onChange={e=>setPhase(Number(e.target.value))}><option value="1">{t.first}</option><option value="2">{t.second}</option></select></label>
    <label>{t.player}<select disabled={map==='shape'} value={player} onChange={e=>setPlayer(e.target.value)}><option value="">{t.allPlayers}</option>{s.players.filter(p=>p.side===side).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
  </div><div className="grf-plot-grid">
    <section hidden={map!=='shots'}><h3>{t.shotMap}</h3><Field label={t.shotMap} points={shots}>{shots.map(v=><circle key={v.seq} cx={v.x} cy={v.y} r="1.7" fill={v.outcome==='goal'?'#ffcf69':'#b9f47a'} stroke="#0c1715" strokeWidth=".4"><title>{names.get(v.actor_id)} · {clockLabel(v.match_time_ms)} · {v.outcome==='goal'?t.goal:t.unresolved}</title></circle>)}</Field>
      <p className="small-note">{t.shotNote}</p><details><summary>{t.data}</summary><div className="table-scroll" tabIndex={0}><table><caption>{t.shotMap}</caption><thead><tr><th>{t.player}</th><th>{t.time}</th><th>{t.result}</th><th>X / Y (m)</th></tr></thead><tbody>{shots.map(v=><tr key={v.seq}><td>{names.get(v.actor_id)}</td><td><button className="secondary" onClick={()=>onSeek(v.playback_ms)}>{clockLabel(v.match_time_ms)}</button></td><td>{v.outcome==='goal'?t.goal:t.unresolved}</td><td>{v.x.toFixed(1)} / {v.y.toFixed(1)}</td></tr>)}</tbody></table>{shots.length===0&&<p>{t.none}</p>}</div></details></section>
    <section hidden={map!=='network'}><h3>{t.network}</h3><Field label={t.network} points={positions}>
      {phaseEdges.map(v=>{const a=nodes.get(v.source_id),b=nodes.get(v.target_id);return a&&b?<line key={v.source_id+v.target_id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#deb85a" strokeWidth={Math.min(1.6,.3+v.count*.15)}><title>{names.get(v.source_id)} → {names.get(v.target_id)}: {v.count}</title></line>:null;})}
      {positions.filter(v=>selected(v.player_id)||connected.has(v.player_id)).map(v=><g key={v.player_id}><circle cx={v.x} cy={v.y} r="2.1" fill="#b9f47a"/><text x={v.x} y={v.y+.8} textAnchor="middle" fill="#122d22" fontSize="2.2">{(s.players.find(p=>p.id===v.player_id)?.slot??0)+1}</text><title>{names.get(v.player_id)}</title></g>)}
    </Field><p className="small-note">{t.positions} · {phase===1?t.first:t.second}</p><details><summary>{t.data}</summary><div className="table-scroll" tabIndex={0}><table><caption>{t.network} · {phase===1?t.first:t.second}</caption><thead><tr><th>{t.from}</th><th>{t.to}</th><th>{t.count}</th></tr></thead><tbody>{phaseEdges.map(v=><tr key={v.source_id+v.target_id}><td>{names.get(v.source_id)}</td><td>{names.get(v.target_id)}</td><td>{v.count}</td></tr>)}</tbody></table>
      <table><caption>{t.positions}</caption><thead><tr><th>{t.player}</th><th>X / Y (m)</th></tr></thead><tbody>{positions.filter(v=>selected(v.player_id)).map(v=><tr key={v.player_id}><td>{names.get(v.player_id)}</td><td>{v.x.toFixed(1)} / {v.y.toFixed(1)}</td></tr>)}</tbody></table></div></details>
      <details><summary>{t.receipt} · {t.final}</summary><div className="table-scroll" tabIndex={0}><table><caption>{t.network} · {t.final}</caption><thead><tr><th>{t.from}</th><th>{t.to}</th><th>{t.half}</th><th>{t.count}</th></tr></thead><tbody>{edges.map(v=><tr key={v.source_id+v.target_id+v.phase}><td>{names.get(v.source_id)}</td><td>{names.get(v.target_id)}</td><td>{v.phase===1?t.first:t.second}</td><td>{v.count}</td></tr>)}</tbody></table></div></details></section>
    <section hidden={map!=='occupancy'}><h3>{t.occupancy}</h3><Field label={t.occupancy}>{cells.map(c=><rect key={c.col+':'+c.row} x={c.col*105/12} y={c.row*68/8} width={105/12} height={68/8} fill="#f5bc57" opacity={.1+.75*c.duration_ms/max}><title>{c.col+1} / {c.row+1}: {(c.duration_ms/1000).toFixed(1)} {t.seconds}</title></rect>)}</Field>
      <details><summary>{t.data}</summary><div className="table-scroll" tabIndex={0}><table><caption>{t.occupancy}</caption><thead><tr><th>X / Y</th><th>{t.exposure}</th></tr></thead><tbody>{cells.map(c=><tr key={c.col+':'+c.row}><td>{c.col+1} / {c.row+1}</td><td>{(c.duration_ms/1000).toFixed(1)} {t.seconds}</td></tr>)}</tbody></table></div></details></section>
    <section hidden={map!=='shape'}><h3>{t.shape}</h3><div className="table-scroll" tabIndex={0}><table><caption>{t.shape}</caption><thead><tr><th>{t.team}</th><th>{t.half}</th><th>{t.length}</th><th>{t.width}</th></tr></thead><tbody>{shape.map(v=><tr key={v.side+v.phase}><th scope="row">{v.side==='home'?s.home_name:s.away_name}</th><td>{v.phase===1?t.first:t.second}</td><td>{v.length_m.toFixed(1)} m</td><td>{v.width_m.toFixed(1)} m</td></tr>)}</tbody></table>{shape.length===0&&<p>{t.na}</p>}</div></section>
  </div></div>;
}
