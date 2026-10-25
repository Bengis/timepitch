import type { DirectedIdentity, DirectedIssue, Unavailable } from './types';

export const CONTROL_IDS = ['identities_active','units','physical_clock','initial_state','possession','actor_targets',
  'explicit_pass_recipient','cross_header','save_block_recovery','prescribed_shot_outcome','event_time_between_ticks',
  'state_export','isolation_rng','teardown','render_dependency'] as const;
export const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
export const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
export const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export const point = (v: unknown): v is {x:number;y:number} => record(v) && finite(v.x) && finite(v.y) && v.x>=0 && v.x<=105 && v.y>=0 && v.y<=68;
export function ensure(condition: unknown, code: string): asserts condition { if (!condition) throw new Error(code); }
export const unavailable = (error: unknown): Unavailable => ({status:'unavailable',issues:[{code:error instanceof Error?error.message:'invalid_input',refs:[]} satisfies DirectedIssue]});
export const activeAt = (p: DirectedIdentity, period: number, ms: number) => p.activeIntervals.some(i => i.period===period && i.fromMs<=ms && ms<=i.toMs);

/** Own finite JSON values only. No getters, prototypes, cycles or lossy JSON.stringify coercion. */
export function ownJson<T>(value: T): T {
  const visiting = new Set<object>();
  function copy(v: unknown, depth: number): unknown {
    ensure(depth<=64,'json_depth');
    if(v===null || typeof v==='string' || typeof v==='boolean' || finite(v)) return v;
    ensure(typeof v==='object' && v!==null && !visiting.has(v),'invalid_json');
    ensure(Array.isArray(v) || Object.getPrototypeOf(v)===Object.prototype || Object.getPrototypeOf(v)===null,'invalid_json');
    ensure(Object.getOwnPropertySymbols(v).length===0,'invalid_json');
    visiting.add(v);
    let output: unknown;
    if(Array.isArray(v)) {
      const descriptors=Object.getOwnPropertyDescriptors(v);
      ensure(Object.keys(descriptors).length===v.length+1,'invalid_json');
      output=Array.from({length:v.length},(_,i)=>{
        const d=descriptors[String(i)];ensure(d && 'value' in d && d.enumerable,'invalid_json');
        return copy(d.value,depth+1);
      });
    }
    else output=Object.fromEntries(Object.entries(Object.getOwnPropertyDescriptors(v)).map(([k,d])=>{
      ensure('value' in d && d.enumerable,'invalid_json');return [k,copy(d.value,depth+1)];
    }));
    visiting.delete(v);return Object.freeze(output);
  }
  return copy(value,0) as T;
}
