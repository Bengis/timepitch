import type { components } from '../generated/api';
export type ChronicleRequest=components['schemas']['ChronicleRequest'];
export type AzureJobView=components['schemas']['AzureJobView'];
export type AzureStatus=components['schemas']['AzureStatus'];
export class ChronicleHttpError extends Error { constructor(readonly status:number){super(`Chronicle HTTP ${status}`);} }
async function read<T>(url:string,signal?:AbortSignal,body?:ChronicleRequest):Promise<T|null>{
  const response=await fetch(url,{signal,credentials:'same-origin',cache:'no-store',redirect:'error',
    ...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
  if(!response.ok)throw new ChronicleHttpError(response.status);
  return response.status===204?null:response.json() as Promise<T>;
}
export function lookupChronicle(request:ChronicleRequest,signal?:AbortSignal):Promise<AzureJobView|null>{
  return read('/api/chronicles/v2?'+new URLSearchParams({...request}),signal);
}
export async function createChronicle(request:ChronicleRequest,signal?:AbortSignal):Promise<AzureJobView>{
  const value=await read<AzureJobView>('/api/chronicles/v2',signal,request);if(!value)throw new Error('Missing job');return value;
}
export async function getChronicle(id:string,signal?:AbortSignal):Promise<AzureJobView>{
  const value=await read<AzureJobView>(`/api/chronicles/v2/${encodeURIComponent(id)}`,signal);if(!value)throw new Error('Missing job');return value;
}
export async function getChronicleStatus(signal?:AbortSignal):Promise<AzureStatus>{
  const value=await read<AzureStatus>('/api/chronicles/v2/status',signal);if(!value||value.profile!=='azure-chronicle-1')throw new Error('Invalid capability');return value;
}
