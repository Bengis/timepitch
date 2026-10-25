import { hasRootDomainWorkBinding } from './root-contact-domains';
import type { RootDomainPlan } from './root-contact-domains';
import { RootWorkLedger } from './root-feasibility';
import type { RootTimedRegion } from './root-feasibility';
import { copyRootValue,sealRootValue } from './root-observation-bindings';
import { fieldPoint } from './curves';
import type { PoseNode,BodyIssue } from './contact-types';

export type RefinedRootGridPlan=Readonly<{
  version:'root-time-grid-1';maxGapMs:500;key:string;baseDomainKey:string;status:'ready'|'unavailable';
  actors:readonly Readonly<{actorId:string;nodes:readonly PoseNode[];originalTimesMs:readonly number[];syntheticTimesMs:readonly number[]}>[];
  issues:readonly BodyIssue[];
}>;
/** Internal computational priors only: no FK, contact inference or trajectory solve. */
export function buildRefinedRootGrid(plan:RootDomainPlan,ledgers:ReadonlyMap<string,RootWorkLedger>):RefinedRootGridPlan {
  const actors:RefinedRootGridPlan['actors'][number][]=[],issues:BodyIssue[]=[];
  const baseDomainKey=typeof plan?.key==='string'?plan.key:'';
  const finish=():RefinedRootGridPlan=>{
    const content={version:'root-time-grid-1' as const,maxGapMs:500 as const,baseDomainKey,
      status:issues.length?'unavailable' as const:'ready' as const,actors:issues.length?[]:actors,issues};
    return sealRootValue({...content,key:JSON.stringify(content)});
  };
  const fail=(code:string,actorId:string|null=null,atMs:number|null=null)=>{
    issues.push({code,actorId,atMs,eventId:null,refs:[]});return finish();
  };
  if(!plan||plan.status!=='ready'||!baseDomainKey||!Array.isArray(plan.actors)||plan.actors.length!==22
    ||!ledgers||typeof ledgers.get!=='function'||typeof ledgers.has!=='function'||typeof ledgers.values!=='function'||ledgers.size!==22
    ||!hasRootDomainWorkBinding(plan,ledgers)
    ||new Set(plan.actors.map(a=>a.actorId)).size!==22
    ||new Set(ledgers.values()).size!==22||[...ledgers.values()].some(w=>!(w instanceof RootWorkLedger)))return fail('invalid_registered_grid_input');
  // Validate every original schedule/cap before any computational node is charged.
  for(const actor of plan.actors){
    if(typeof actor.actorId!=='string'||!actor.actorId||!ledgers.has(actor.actorId)
      ||!Number.isSafeInteger(actor.fromMs)||!Number.isSafeInteger(actor.toMs)||actor.fromMs<0||actor.toMs<=actor.fromMs
      ||!Array.isArray(actor.nodes)||actor.nodes.length<2||actor.nodes.length>64
      ||actor.nodes[0]?.atMs!==actor.fromMs||actor.nodes.at(-1)?.atMs!==actor.toMs)return fail('invalid_grid_actor_boundary',actor.actorId);
    let previous=-1,count=1;
    for(const node of actor.nodes){
      if(!node||!Number.isSafeInteger(node.atMs)||node.atMs<actor.fromMs||node.atMs>actor.toMs||node.atMs<=previous
        ||!fieldPoint(node.pose?.root))return fail('invalid_grid_original_node',actor.actorId,node?.atMs??null);
      if(previous>=0)count+=Math.ceil((node.atMs-previous)/500);
      previous=node.atMs;
    }
    if(count>64)return fail('grid_node_limit',actor.actorId);
    if(!Array.isArray(actor.bindings)||actor.bindings.some((b:RootTimedRegion)=>!actor.nodes.some((n:PoseNode)=>n.atMs===b.atMs)))return fail('missing_original_binding_node',actor.actorId);
  }
  for(const actor of plan.actors){
    const nodes:PoseNode[]=[copyRootValue(actor.nodes[0])],syntheticTimesMs:number[]=[],ledger=ledgers.get(actor.actorId)!;
    for(let i=1;i<actor.nodes.length;i++){
      const a=actor.nodes[i-1],b=actor.nodes[i],gap=b.atMs-a.atMs,count=Math.ceil(gap/500);
      for(let k=1;k<count;k++){
        const atMs=a.atMs+Math.floor(k*gap/count);
        if(!ledger.charge('preparation',1))return fail('grid_shared_work_limit',actor.actorId,atMs);
        const u=(atMs-a.atMs)/gap,root={x:a.pose.root.x+(b.pose.root.x-a.pose.root.x)*u,y:a.pose.root.y+(b.pose.root.y-a.pose.root.y)*u};
        nodes.push({atMs,pose:{...copyRootValue(a.pose),root}});syntheticTimesMs.push(atMs);
      }
      nodes.push(copyRootValue(b));
    }
    actors.push({actorId:actor.actorId,nodes,originalTimesMs:actor.nodes.map((n:PoseNode)=>n.atMs),syntheticTimesMs});
  }
  return finish();
}
