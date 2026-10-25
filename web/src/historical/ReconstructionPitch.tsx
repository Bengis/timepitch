import {Pitch} from '../match/Pitch';
import type {SceneFrame} from '../match/retroScene';
import type {EventAnchor,ReconstructionFrame} from './api';
import {useHistoricalText} from './messages';
import {MatchLayers} from '../match-centre/MatchLayers';
type Person=Omit<SceneFrame['players'][number],'x'|'y'>;
export function reconstructionSceneFrame(frame:ReconstructionFrame,people:ReadonlyMap<number,Person>,showSynthetic:boolean,score:SceneFrame['score']={home:0,away:0}):SceneFrame{
  return {clock_ms:frame.period_ms,period:frame.period,score,carrier:null,possession:null,
    ball:showSynthetic&&frame.ball?{x:frame.ball[0],y:frame.ball[1]}:null,
    players:showSynthetic?frame.players.flatMap(([index,x,y])=>{const person=people.get(index);return person?[{...person,x,y}]:[];}):[]};
}
export function ReconstructionPitch({frame,previous,anchors,showSynthetic,people=new Map(),score={home:0,away:0},showAnchors=true,cut=false,clock='',home='',away=''}:{frame:ReconstructionFrame;previous:ReconstructionFrame;anchors:readonly EventAnchor[];showSynthetic:boolean;people?:ReadonlyMap<number,Person>;score?:SceneFrame['score'];showAnchors?:boolean;cut?:boolean;clock?:string;home?:string;away?:string}){
  const h=useHistoricalText();
  const current=reconstructionSceneFrame(frame,people,showSynthetic,score),before=reconstructionSceneFrame(previous,people,showSynthetic,score);
  const located=anchors.filter(a=>a.location&&a.period===frame.period&&a.period_ms!==null&&a.period_ms<=frame.period_ms&&frame.period_ms-a.period_ms<=2000);
  // Compatibility bridge for recorded-frame callers; live sessions use MatchCentre.
  const layers={anchors:located.map(a=>({id:a.id,eventId:a.event_id,entityId:a.entity_key,elapsedMs:a.period_ms,point:a.location,status:a.status,reason:a.reason??null,refs:[a.event_id],details:{...a}})),cuts:[]};
  return <section className="reconstruction-pitch"><Pitch frame={current} previous={before} home={home} away={away} showPlayerRole={false} restarting={cut||previous.period!==frame.period} displayClockLabel={clock} ariaLabel={h.pitch} fieldClassName="reconstruction-field" renderOverlay={projection=><MatchLayers layers={layers} projection={projection} elapsedMs={frame.period_ms} showAnchors={showAnchors} label={h.recordedAnchors}/>}/>
    <div className="motion-status">{!frame.ball&&<p>{h.gap}</p>}{cut&&<p>{h.cut}</p>}</div>
    {showAnchors&&<details className="anchor-evidence"><summary>{h.recordedAnchors} ({located.length})</summary><p>{h.anchorNote}</p><ul>{located.map(a=><li key={a.id}>{a.event_id} · {a.entity_key} · {a.status} · {a.location?.x.toFixed(1)}, {a.location?.y.toFixed(1)} {a.reason}</li>)}</ul></details>}
  </section>;
}
