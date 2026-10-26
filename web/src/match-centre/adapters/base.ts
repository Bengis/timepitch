import {resolveHistoricalCrest} from '../../catalog/crests';
import { fictional, showClub } from '../../catalog/fictional';
import type { MatchSection, SessionDescriptor, SessionIdentity, SessionSnapshot, Availability, PanelData, ViewProvenance, TableCell, MotionInterval } from '../session';

export const sections: readonly MatchSection[] = ['match','summary','players','maps','effort','data'];
export const available = (): Availability => ({ status: 'available', reason: null });
export const missing = (reason: string): Availability => ({ status: 'unavailable', reason });
export const ns = (source: string, id: string) => `${source}:${id}`;
export const abortError = () => new DOMException('Aborted', 'AbortError');
export function guard(signal: AbortSignal, disposed = false) { if (signal.aborted || disposed) throw abortError(); }
export function clamp(time: number, duration: number | null) { return Math.max(0, Math.min(Number.isFinite(time) ? time : 0, duration ?? Infinity)); }
export const cell = (value: unknown): TableCell => value === undefined || value === null ? null
  : typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? value : JSON.stringify(value);
export const row = (value: object) => Object.fromEntries(Object.entries(value).map(([k,v]) => [k,cell(v)]));
export function splitFacts(interval:MotionInterval,time:number,timestamps:readonly number[]):MotionInterval {
  const before=timestamps.filter(t=>t<=time&&t>interval.fromMs),after=timestamps.filter(t=>t>time&&t<interval.toMs);
  if(!before.length&&!after.length)return interval;
  return {...interval,fromMs:Math.max(interval.fromMs,...before),toMs:Math.min(interval.toMs,...after),
    interpolation:interval.interpolation??{fromMs:interval.fromMs,toMs:interval.toMs}};
}
export const detail = (id: string, value: unknown, provenance: ViewProvenance = 'source_recorded') =>
  ({ id, value: cell(value), provenance, refs: [] as string[], availability: value == null ? missing('not_supplied') : available(), details: { source: value } });
export function emptyPanel(reason = 'not_loaded'): PanelData {
  return { availability: missing(reason), scope: 'cursor', cutoff: null, metrics: [], players: [], playerDetails: [], plots: [], standouts: [], definitions: [], sourceDetails: [] };
}
export function blankSnapshot(descriptor: SessionDescriptor): SessionSnapshot {
  const unknown = { value: null, provenance: 'unavailable' as const, refs: [] };
  return { descriptor, requestedCursor: { elapsedMs:0,period:0,periodMs:0 }, presentedCursor: { elapsedMs:0,period:0,periodMs:0 },
    facts: { score: unknown, possession: unknown, carrierId: unknown }, interval:null,previousInterval:null,cue:undefined,clockMs:null,events:[],panels:{},loadState:'buffering',reason:null,horizonMs:0 };
}
export function store(initial: SessionSnapshot) {
  let value = initial, disposed = false;
  const listeners = new Set<() => void>();
  return {
    get disposed() { return disposed; }, snapshot: () => value,
    subscribe(listener: () => void) { if (!disposed) listeners.add(listener); return () => { listeners.delete(listener); }; },
    publish(next: SessionSnapshot) { if (!disposed) { value = next; listeners.forEach(listener => listener()); } },
    dispose() { disposed = true; listeners.clear(); },
  };
}
export function descriptor(identity: SessionIdentity, home: {id:string;name:string}, away: {id:string;name:string}, durationMs: number | null, exportHref: string | null): SessionDescriptor {
  // TP259: en la liga ficticia, nombre inventado y sin escudo real.
  const side = (t: {id:string;name:string}) => ({ ...t, name: showClub(t.name), crestUrl: fictional() ? null : resolveHistoricalCrest(t.id)?.src ?? null });
  return { identity, home:side(home),away:side(away),periods:[],durationMs,
    export:{href:exportHref,availability:exportHref ? available() : missing('no_export')},capabilities:{sections,playerDetails:true,events:true,layers:[]} };
}

/** Bounded LRU with joined reads, consumer cancellation and explicit retry of failures. */
export class ReadPool<T> {
  private values = new Map<string,{value:T;bytes:number}>();
  private errors = new Map<string,unknown>();
  private pending = new Map<string,{promise:Promise<T>;control:AbortController;consumers:number}>();
  private closed = false;
  constructor(private capacity: number, private maxEntryBytes = Infinity) {}
  get size() { return this.values.size; }
  get bytes() { return [...this.values.values()].reduce((sum,v) => sum+v.bytes,0); }
  peek(key:string) { return this.values.get(key)?.value; }
  clearFailures() { this.errors.clear(); }
  async get(key: string, signal: AbortSignal, read: (signal: AbortSignal) => Promise<T>): Promise<T> {
    guard(signal,this.closed);
    const cached = this.values.get(key);
    if (cached) { this.values.delete(key); this.values.set(key,cached); return cached.value; }
    if (this.errors.has(key)) throw this.errors.get(key);
    let entry = this.pending.get(key);
    if (!entry) {
      // Reserve room before decoding another payload, not only after inserting it.
      while(this.values.size+this.pending.size>=this.capacity&&this.values.size)this.values.delete(this.values.keys().next().value!);
      const control = new AbortController();
      const promise = Promise.resolve().then(() => { guard(control.signal,this.closed); return read(control.signal); }).then(value => {
        guard(control.signal,this.closed);
        const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
        if (bytes > this.maxEntryBytes) throw new Error('Source payload limit');
        this.values.set(key,{value,bytes});
        while (this.values.size > this.capacity) this.values.delete(this.values.keys().next().value!);
        return value;
      }).catch(error => { if (!control.signal.aborted && !this.closed && !(error instanceof DOMException && error.name==='AbortError')) this.errors.set(key,error); throw error; })
        .finally(() => { if (this.pending.get(key)?.control===control) this.pending.delete(key); });
      entry = {promise,control,consumers:0}; this.pending.set(key,entry);
    }
    const joined = entry; joined.consumers++;
    return new Promise<T>((resolve,reject) => {
      let finished = false;
      const release = () => {
        if (finished) return false; finished=true; signal.removeEventListener('abort',abort); joined.consumers--;
        if (!joined.consumers && this.pending.get(key)===joined) { joined.control.abort(); this.pending.delete(key); }
        return true;
      };
      const abort = () => { if (release()) reject(abortError()); };
      signal.addEventListener('abort',abort,{once:true});
      joined.promise.then(value => { if (release()) resolve(value); },error => { if (release()) reject(error); });
      if (signal.aborted) abort();
    });
  }
  dispose() { this.closed=true; this.pending.forEach(e=>e.control.abort()); this.pending.clear(); this.values.clear(); this.errors.clear(); }
}

type QueueTask<T> = { key:string;read:(signal:AbortSignal)=>Promise<T>;signal:AbortSignal;control:AbortController;
  resolve:(value:T|undefined)=>void;reject:(error:unknown)=>void;detach:()=>void };
/** One transport at a time; same-key pending demand coalesces to the latest cursor. */
export class StatisticsQueue<T> {
  private waiting = new Map<string,QueueTask<T>>();
  private active: QueueTask<T> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastStart = -Infinity;
  private closed = false;
  constructor(private now:()=>number = () => performance.now()) {}
  request(key:string,read:(signal:AbortSignal)=>Promise<T>,signal:AbortSignal):Promise<T|undefined> {
    guard(signal,this.closed);
    return new Promise((resolve,reject) => {
      const previous = this.waiting.get(key);
      if (previous) { previous.detach(); previous.resolve(undefined); }
      const control = new AbortController();
      const task:QueueTask<T> = {key,read,signal,control,resolve,reject,detach:()=>signal.removeEventListener('abort',abort)};
      const abort=()=>{ control.abort(); if (this.waiting.get(key)===task) {this.waiting.delete(key);task.detach();reject(abortError());} };
      signal.addEventListener('abort',abort,{once:true}); this.waiting.set(key,task); this.pump();
    });
  }
  private pump() {
    if (this.closed || this.active || this.timer!==null || !this.waiting.size) return;
    const delay=Math.max(0,this.lastStart+250-this.now());
    if (delay>0) { this.timer=setTimeout(()=>{this.timer=null;this.pump();},delay);return; }
    const task=this.waiting.values().next().value!; this.waiting.delete(task.key);
    if (task.signal.aborted) {task.detach();task.reject(abortError());this.pump();return;}
    this.active=task;this.lastStart=this.now();
    Promise.resolve().then(()=>task.read(task.control.signal)).then(value=>{guard(task.control.signal,this.closed);task.resolve(value);},error=>task.reject(error))
      .catch(error=>task.reject(error)).finally(()=>{task.detach();this.active=null;this.pump();});
  }
  dispose() { this.closed=true;if(this.timer!==null)clearTimeout(this.timer);this.timer=null;
    this.waiting.forEach(task=>{task.detach();task.control.abort();task.reject(abortError());});this.waiting.clear();this.active?.control.abort(); }
}
