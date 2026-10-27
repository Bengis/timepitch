import type {EventView} from './session';
import type {PlaybackPolicy} from './sequence/types';

export type HighlightWindow=Readonly<{fromMs:number;toMs:number}>;
export const HIGHLIGHTS_TARGET_MS=300000;
export const highlightsRemainingMs=(windows:readonly HighlightWindow[],at:number)=>windows.reduce((n,w)=>n+Math.max(0,w.toMs-Math.max(at,w.fromMs)),0);

/** Editorial selection from existing events, never football simulation or an AI judgement. */
export function planHighlights(durationMs:number,halfTimeMs:number|null,events:readonly EventView[]){
  if(!Number.isFinite(durationMs)||durationMs<=0)throw new RangeError('Invalid recording duration');
  const target=Math.min(durationMs,HIGHLIGHTS_TARGET_MS);
  const bounded=(fromMs:number,toMs:number):HighlightWindow=>({fromMs:Math.max(0,fromMs),toMs:Math.min(durationMs,toMs)});
  const merge=(input:readonly HighlightWindow[])=>{
    const out:HighlightWindow[]=[];
    for(const w of [...input].filter(w=>w.toMs>w.fromMs).sort((a,b)=>a.fromMs-b.fromMs||a.toMs-b.toMs)){
      const prior=out.at(-1);
      if(prior&&w.fromMs<=prior.toMs)out[out.length-1]={fromMs:prior.fromMs,toMs:Math.max(prior.toMs,w.toMs)};
      else out.push({...w});
    }
    return out;
  };
  const half=halfTimeMs!==null&&halfTimeMs>0&&halfTimeMs<durationMs?halfTimeMs:null;
  const timed=events.filter(e=>e.elapsedMs!==null&&Number.isFinite(e.elapsedMs)&&e.elapsedMs>=0&&e.elapsedMs<=durationMs);
  let windows=merge([bounded(0,5000),bounded(durationMs-6000,durationMs),
    ...(half===null?[]:[bounded(half-4000,half+2000)]),
    ...timed.filter(e=>e.kind==='goal'||e.kind==='own_goal').map(e=>bounded(e.elapsedMs!-14000,e.elapsedMs!+8000))]);
  const shots=timed.filter(e=>e.kind==='shot').map(e=>e.elapsedMs!).sort((a,b)=>a-b);
  const distance=(at:number)=>Math.min(...windows.map(w=>at<w.fromMs?w.fromMs-at:at>w.toMs?at-w.toMs:0));
  while(shots.length){
    shots.sort((a,b)=>distance(b)-distance(a)||a-b);
    const at=shots.shift()!,next=merge([...windows,bounded(at-10000,at+5000)]);
    if(highlightsRemainingMs(next,0)<=target)windows=next;
  }
  // Use any small budget remainder as context adjoining existing clips, never extra synthetic footage.
  let left=target-highlightsRemainingMs(windows,0);
  for(let i=0;i<windows.length&&left>0;i++){
    const end=windows[i+1]?.fromMs??durationMs,grow=Math.min(left,end-windows[i].toMs);
    windows[i]={...windows[i],toMs:windows[i].toMs+grow};left-=grow;
  }
  windows=merge(windows);
  const policy:PlaybackPolicy={id:'match-highlights-1',fromMs:0,toMs:durationMs,speeds:[1],
    pauseAt:half===null?[]:[{atMs:half,endingPeriod:1}],windows};
  return {policy,durationMs:highlightsRemainingMs(windows,0)};
}
