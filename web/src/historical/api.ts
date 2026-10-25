import type {components} from '../generated/api';
import {ApiError} from '../api';
export type HistoricalMatch=components['schemas']['HistoricalMatch'];
export type HistoricalEvent=components['schemas']['HistoricalEvent'];
export type HistoricalStatistics=components['schemas']['HistoricalStatistics'];
export type HistoricalSeason=components['schemas']['HistoricalSeason'];
export type HistoricalCapabilities=components['schemas']['HistoricalCapabilities'];
export type HistoricalPage=components['schemas']['HistoricalPage'];
export type ReconstructionManifest=components['schemas']['ReconstructionManifest'];
export type ReconstructionFrame=components['schemas']['ReconstructionFrame'];
export type ReconstructionSegment=components['schemas']['ReconstructionSegment'];
export type EventAnchor=components['schemas']['EventAnchor'];
export type MatchupPrefill=components['schemas']['MatchupPrefill'];
export type ComparisonResult=components['schemas']['HistoricalComparison'];
export const readMatchup=(id:number,signal:AbortSignal)=>read<MatchupPrefill>(`/matches/${id}/matchup`,signal);
export const readComparison=(id:number,engine:'timepitch'|'grf',simulationId:string,signal:AbortSignal)=>read<ComparisonResult>(`/matches/${id}/comparison?engine=${engine}&simulation_id=${encodeURIComponent(simulationId)}`,signal);
export type ProvenanceKind=components['schemas']['HistoricalMatch']['provenance']|'derived_from_events'|'synthetic_motion'|'unavailable';
const root='/api/historical';
const maxBytes=12*1024*1024;
async function read<T>(path:string,signal?:AbortSignal,limit=maxBytes):Promise<T>{
  const response=await fetch(`${root}${path}`,{signal});
  if(!response.ok)throw new ApiError(response.status);
  const reader=response.body?.getReader();
  if(!reader)throw new Error('Empty historical response');
  const chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit)throw new Error('Historical payload limit');chunks.push(value);}}
  catch(error){await reader.cancel();throw error;}
  finally{reader.releaseLock();}
  if(signal?.aborted)throw new DOMException('Aborted','AbortError');
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}
export const readCapabilities=(signal?:AbortSignal)=>read<HistoricalCapabilities>('/capabilities',signal);
export const readSeasons=(signal:AbortSignal)=>read<HistoricalSeason[]>('/seasons',signal);
export const readMatches=(season:number,team:number|undefined,offset:number,signal:AbortSignal)=>read<HistoricalPage>(`/matches?season_id=${season}${team?`&team_id=${team}`:''}&offset=${offset}&limit=24`,signal);
export const readMatch=(id:number,signal:AbortSignal)=>read<HistoricalMatch>(`/matches/${id}`,signal);
export const readManifest=(id:number,signal:AbortSignal)=>read<ReconstructionManifest>(`/matches/${id}/reconstruction`,signal,1024*1024);
export const readSegment=(id:number,period:number,index:number,signal:AbortSignal)=>read<ReconstructionSegment>(`/matches/${id}/reconstruction/segments/${period}/${index}`,signal,4*1024*1024);
export async function readStatistics(id:number,period:number,ms:number,version:string,signal:AbortSignal){
  const result=await read<HistoricalStatistics>(`/matches/${id}/statistics?period=${period}&at_ms=${Math.floor(ms)}`,signal);
  if(result.dataset_version!==version||result.match_id!==id||result.cutoff.period!==period||result.cutoff.period_ms!==Math.floor(ms))throw new Error('Historical identity changed');
  return result;
}
export async function readEvents(id:number,period:number,from:number,to:number,version:string,signal:AbortSignal,maxItems=Infinity){
  if(!Number.isFinite(from)||!Number.isFinite(to)||from<0||to<=from||to-from>60000)throw new Error('Historical event window limit');
  const events:HistoricalEvent[]=[];let total=1,bytes=0;
  while(events.length<total){
    const page=await read<components['schemas']['HistoricalEventPage']>(`/matches/${id}/events?period=${period}&from_ms=${from}&to_ms=${to}&offset=${events.length}&limit=${Math.min(200,maxItems)}`,signal);
    if(page.dataset_version!==version||page.match_id!==id)throw new Error('Historical identity changed');
    bytes+=new TextEncoder().encode(JSON.stringify(page)).byteLength;
    if(bytes>maxBytes)throw new Error('Historical cumulative event payload limit');
    if(!Number.isInteger(page.total)||page.total<0||events.length+page.items.length>page.total)throw new Error('Inconsistent historical page');
    if(page.total>maxItems)throw new Error('Historical event count limit');
    if(events.length>0&&page.total!==total)throw new Error('Inconsistent historical page total');
    total=page.total;if(!page.items.length&&events.length<total)throw new Error('Incomplete historical page');
    events.push(...page.items);
  }
  return events;
}
/** An instance belongs to one immutable dataset/reconstruction/match identity. */
export class SegmentCache{
  private entries=new Map<string,ReconstructionSegment>();
  constructor(readonly dataset:string,readonly reconstruction:string,readonly match:number){}
  get size(){return this.entries.size;}
  async load(period:number,index:number,signal:AbortSignal){
    const key=`${this.dataset}/${this.reconstruction}/${this.match}/${period}/${index}`;
    const cached=this.entries.get(key);
    if(cached){this.entries.delete(key);this.entries.set(key,cached);return cached;}
    const data=await readSegment(this.match,period,index,signal);
    if(signal.aborted)throw new DOMException('Aborted','AbortError');
    if(data.match_id!==this.match||data.reconstruction_id!==this.reconstruction||data.period!==period||data.index!==index)throw new Error('Reconstruction identity changed');
    this.entries.set(key,data);while(this.entries.size>3)this.entries.delete(this.entries.keys().next().value!);
    return data;
  }
}
