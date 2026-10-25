import { focusTrack, type SequenceDepiction } from './depiction';
import type { Point } from './types';

export function sequenceFocus(depiction:SequenceDepiction,t:number,selectedKey:string|null,reducedMotion:boolean):Point|null {
  const track=focusTrack(depiction,selectedKey);
  if(reducedMotion||!track||!Number.isFinite(t)||t<track.fromMs||t>track.toMs)return null;
  const current=track.spans.filter(s=>t>=s.fromMs&&t<=s.toMs).at(-1),point=current?.at(t);
  const prior=track.spans.filter(s=>s!==current&&s.toMs<=(current?.fromMs??t)&&s.at(s.toMs)!==null).at(-1);
  const last=prior?.at(prior.toMs)??null;
  if(!point)return prior&&last&&t-prior.toMs<=1000?last:null;
  if(selectedKey!==null||!current||!prior||!last||current.fromMs-prior.toMs>1000)return point;
  const blend=Math.max(0,Math.min(1,(t-current.fromMs)/200)),smooth=blend*blend*(3-2*blend);
  return {x:last.x+(point.x-last.x)*smooth,y:last.y+(point.y-last.y)*smooth};
}
