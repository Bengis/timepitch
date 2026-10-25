import { prepareConstraints } from './constraints';
import { validateBodyGeometry } from './body-geometry';
import type { BodyGeometry,ContactBallPlan,BallXYSpan,BodyIssue } from './contact-types';
import type { SequenceSource } from './types';
export function compileContactBall(source:SequenceSource,geometry:BodyGeometry):ContactBallPlan {
  const g=validateBodyGeometry(geometry),{fromMs,toMs}=source.request,issues:BodyIssue[]=[],spans:BallXYSpan[]=[],anchors:ContactBallPlan['anchors'][number][]=[];
  const blocked:{from:number;to:number}[]=[],distance=(a:{x:number;y:number},b:{x:number;y:number})=>Math.hypot(a.x-b.x,a.y-b.y);
  const add=(code:string,atMs:number|null,refs:readonly string[]=[])=>issues.push({code,atMs,refs:[...refs],actorId:null,eventId:null});
  let prepared:ReturnType<typeof prepareConstraints>|null=null;
  try{prepared=prepareConstraints(source);}catch{add('invalid_ball_source',null);}
  for(const i of prepared?.issues.filter(i=>i.entityId==='ball')??[]){add(i.reason,i.fromMs,i.refs);blocked.push({from:i.fromMs,to:i.toMs});}
  for(const c of source.cuts)if((c.entityIds==='all'||c.entityIds.includes('ball'))&&c.fromMs!==null&&c.toMs!==null
    &&/conflict|contradict|restart|period|unknown/i.test(c.reason))blocked.push({from:c.fromMs,to:c.toMs});
  for(const a of prepared?.actions??[]){
    const e=a.event,end=a.presentationEndMs;
    if(end===null||!e.start||!e.end||e.durationMs===null||end<=e.elapsedMs){add('invalid_ball_action',e.elapsedMs,e.refs);continue;}
    anchors.push({eventId:e.id,kind:e.kind,fromMs:e.elapsedMs,sourceEndMs:e.elapsedMs+e.durationMs,presentationEndMs:end,start:{...e.start},end:{...e.end}});
    if(distance(e.start,e.end)/(end-e.elapsedMs)*1000>45+1e-8){add('ball_speed_limit',e.elapsedMs,e.refs);blocked.push({from:e.elapsedMs,to:end});continue;}
    // Carry owns an illustrative XY path through its recorded endpoints, never a root attachment.
    spans.push({fromMs:e.elapsedMs,toMs:end,start:{...e.start},end:{...e.end},refs:[...e.refs]});
  }
  const ordered=[...spans].sort((a,b)=>a.fromMs-b.fromMs);
  for(let i=1;i<ordered.length;i++){
    const a=ordered[i-1],b=ordered[i],gap=b.fromMs-a.toMs;
    if(gap<0||gap===0&&distance(a.end,b.start)>1e-6){add('conflicting_ball_actions',b.fromMs,[...a.refs,...b.refs]);blocked.push({from:b.fromMs,to:Math.max(a.toMs,b.fromMs)});}
    else if(gap>0){
      const forbidden=blocked.some(c=>c.from<b.fromMs&&c.to>a.toMs);
      if(gap<=5000&&!forbidden&&distance(a.end,b.start)/gap*1000<=45+1e-8)
        spans.push({fromMs:a.toMs,toMs:b.fromMs,start:{...a.end},end:{...b.start},refs:[...a.refs,...b.refs]});
      else add('unknown_ball_gap',a.toMs,[...a.refs,...b.refs]);
    }
  }
  spans.sort((a,b)=>a.fromMs-b.fromMs);
  return {key:JSON.stringify([source.key,g.key,'contact-ball-xy-1',prepared?.aliases??[]]),sourceKey:source.key,geometryKey:g.key,fromMs,toMs,
    anchors,spans,aliases:prepared?.aliases??[],issues,
    rawHeights:source.performanceEvidence?.actions.filter(a=>a.shot).map(a=>({eventId:a.eventId,value:a.shot!.rawEndHeight,unit:'unverified' as const}))??[],
    sample(t){
      if(!Number.isFinite(t)||t<fromMs||t>toMs||!prepared||blocked.some(c=>t>=c.from&&t<=c.to))return null;
      const s=spans.filter(s=>t>=s.fromMs&&t<=s.toMs).at(-1);if(!s)return null;
      const u=(t-s.fromMs)/(s.toMs-s.fromMs);return {x:s.start.x+(s.end.x-s.start.x)*u,y:s.start.y+(s.end.y-s.start.y)*u};
    }};
}
