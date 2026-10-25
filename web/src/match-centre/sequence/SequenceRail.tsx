import type { PlayMoment } from './types';
import { matchTime } from '../player-messages';
import { useSequenceText } from './messages';
export function SequenceRail({times,reached,elapsed,onSeek}:{times:readonly number[];reached:readonly PlayMoment[];elapsed:number;onSeek:(ms:number)=>void}){
  const t=useSequenceText();
  return <nav className="sequence-rail" aria-label={t.sequence}>{times.map(at=>{
    const moment=at<=elapsed?reached.filter(m=>m.atMs===at).at(-1):null;
    return <button key={at} disabled={!moment} onClick={()=>onSeek(at)}><time>{matchTime(at)}</time><span>{moment?.title??t.next}</span></button>;
  })}</nav>;
}
