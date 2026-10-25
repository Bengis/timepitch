import { useState } from 'react';
import type { PlayMoment, SequenceSource } from './types';
import { useSequenceText } from './messages';
export function PlayCard({moment,source,onPlayer}:{moment:PlayMoment|null;source:SequenceSource;onPlayer:(id:string)=>void}){
  const t=useSequenceText(),[evidence,setEvidence]=useState(false);
  const names=new Map(source.frames[0].players.map(p=>[p.key,p.name]));
  return <aside className="sequence-card" aria-labelledby="sequence-play-title">
    <h2 id="sequence-play-title">{t.thisPlay}</h2>{moment?<><h3>{moment.title}</h3><p>{moment.explanation}</p>
      {moment.shotXg!==null&&<dl className="sequence-quality"><dt>{t.quality}</dt><dd>{moment.shotXg.toFixed(3)}</dd></dl>}
      <div className="sequence-people">{moment.actorIds.map(id=><button key={id} onClick={()=>onPlayer(id)}>{names.get(id)??id}</button>)}</div>
      <button aria-expanded={evidence} onClick={()=>setEvidence(v=>!v)}>{t.evidence}</button>
      {evidence&&<ul className="sequence-evidence">{moment.evidenceIds.map(id=><li key={id}><code>{source.events.find(e=>e.id===id)?.refs.join(', ')}</code></li>)}</ul>}
    </>:<p>{t.start}</p>}<small>{t.context}</small>
  </aside>;
}
