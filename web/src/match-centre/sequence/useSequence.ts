import { useCallback, useEffect, useRef, useState } from 'react';
import { identityKey, type MatchSessionAdapter } from '../session';
import { compileDepiction } from './depiction';
import type { SequenceRequest, SequenceSource } from './types';

type Result={status:'idle'|'loading'|'ready'|'unavailable';source:SequenceSource|null;error:string|null};
export function useSequence(adapter:MatchSessionAdapter,request:SequenceRequest|null) {
  const key=JSON.stringify([identityKey(adapter.identity),request]),generation=useRef(0);
  const [attempt,setAttempt]=useState(0),[value,setValue]=useState<Result&{key:string;adapter:MatchSessionAdapter}|null>(null);
  useEffect(()=>{
    const token=++generation.current,controller=new AbortController();
    const publish=(result:Result)=>{if(!controller.signal.aborted&&token===generation.current)setValue({...result,key,adapter});};
    if(request){
      publish({status:'loading',source:null,error:null});
      void Promise.resolve().then(()=>{
        if(controller.signal.aborted)return null;
        if(!adapter.loadSequence)throw new Error('Sequence source unavailable');
        return adapter.loadSequence(request,controller.signal);
      }).then(source=>{
        if(!source||controller.signal.aborted||token!==generation.current)return;
        if(identityKey(source.identity)!==identityKey(adapter.identity)||JSON.stringify(source.request)!==JSON.stringify(request)
          ||!Object.isFrozen(source)||!/^[a-f0-9]{64}$/.test(source.rawDigest))throw new Error('Sequence source changed');
        // The sealed adapter authenticates the source; accept only the certified opt-in profile.
        const depiction=compileDepiction(source,'historical-action-preview-2');
        if(depiction.issues.length||!depiction.diagnostics?.actors.length||depiction.diagnostics.actors.some(a=>a.report.status!=='certified'))throw new Error('Sequence depiction unavailable');
        publish({status:'ready',source,error:null});
      }).catch(()=>publish({status:'unavailable',source:null,error:'sequence_unavailable'}));
    }
    return ()=>{controller.abort();};
  },[adapter,key,attempt]);
  const current:Result=!request?{status:'idle',source:null,error:null}:value?.key===key&&value.adapter===adapter?value:{status:'loading',source:null,error:null};
  return {...current,retry:useCallback(()=>setAttempt(n=>n+1),[])};
}
