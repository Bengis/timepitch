import type {EngineCapability} from '../api';
import {useGrfText} from './messages';
export type Engine='timepitch'|'grf'|'touchlines';
export function EngineSelector({value,capabilities,disabled,onChange}:{value:Engine;capabilities:EngineCapability[]|null;disabled:boolean;onChange:(engine:Engine)=>void}){
  const g=useGrfText(),grf=capabilities?.find(v=>v.id==='grf'),touchlines=capabilities?.find(v=>v.id==='touchlines');
  return <div className="engine-selector"><label>{g.engine}<select value={value} disabled={disabled} onChange={e=>onChange(e.target.value as Engine)}>
    {/* TP242: el motor TimePitch ya no se ofrece; solo aparece si GRF no está disponible y es el que queda. */}
    {value==='timepitch'&&<option value="timepitch">TimePitch</option>}<option value="grf" disabled={!grf?.available}>{g.grfName}</option>
    {/* TP243: segunda opción, solo si el servidor la ofrece. */}
    {touchlines?.available&&<option value="touchlines">{g.touchlinesName}</option>}
  </select></label><p className="small-note" role="status">{!capabilities?g.checking:!grf?.available?(grf?.reason?g[grf.reason]:g.unavailable):value==='grf'?g.limits:value==='touchlines'?g.touchlinesNote:''}</p></div>;
}
