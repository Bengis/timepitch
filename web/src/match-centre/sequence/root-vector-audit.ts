import type { Point } from './types';
import { hermiteSpan,inspectSpan } from './curves';

export type RootVectorAuditInput=Readonly<{actorId:string;nodes:readonly Readonly<{atMs:number;root:Point;velocity:Point}>[]}>;
export type RootVectorAudit=Readonly<{status:'audited'|'invalid_input';actorId:string;reason:string|null;
  spans:readonly Readonly<{fromMs:number;toMs:number;maxSpeed:number;maxAcceleration:number;reasons:readonly string[]}>[]}>;

const finitePoint=(point:Point|null|undefined):point is Point=>!!point&&Number.isFinite(point.x)&&Number.isFinite(point.y);

/** Inspect the unique polynomials of supplied values. Never estimates variables or accepts a body/track. */
export function auditStoredRootVector(input:RootVectorAuditInput):RootVectorAudit {
  const actorId=typeof input?.actorId==='string'?input.actorId:'';
  const invalid=(reason:string):RootVectorAudit=>Object.freeze({status:'invalid_input',actorId,reason,spans:Object.freeze([])});
  if(!actorId.trim()||!Array.isArray(input?.nodes)||input.nodes.length<2||input.nodes.length>64)return invalid('invalid_actor_or_node_count');
  let previous=-1;
  for(const node of input.nodes){
    if(!node||!Number.isSafeInteger(node.atMs)||node.atMs<0||node.atMs<=previous||!finitePoint(node.root)||!finitePoint(node.velocity))
      return invalid('invalid_node_or_time');
    previous=node.atMs;
  }
  const spans:RootVectorAudit['spans'][number][]=[];
  for(let i=1;i<input.nodes.length;i++){
    const a=input.nodes[i-1],b=input.nodes[i];
    const polynomial=hermiteSpan({atMs:a.atMs,point:a.root},{atMs:b.atMs,point:b.root},a.velocity,b.velocity);
    if([...polynomial.x,...polynomial.y].some(value=>!Number.isFinite(value)))return invalid('unrepresentable_polynomial');
    const proof=inspectSpan(polynomial);
    if(!Number.isFinite(proof.maxSpeed)||!Number.isFinite(proof.maxAcceleration)||proof.reasons.includes('invalid_curve'))
      return invalid('unrepresentable_curve_metrics');
    spans.push(Object.freeze({fromMs:a.atMs,toMs:b.atMs,maxSpeed:proof.maxSpeed,maxAcceleration:proof.maxAcceleration,
      reasons:Object.freeze([...proof.reasons])}));
  }
  return Object.freeze({status:'audited',actorId,reason:null,spans:Object.freeze(spans)});
}
