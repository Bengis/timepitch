import { useEffect, useMemo, useRef, useState } from 'react';
import { MatchCentre } from '../match-centre/MatchCentre';
import { createHistoricalSession } from '../match-centre/adapters/historical';
import { sectionForTab, type HistoricalTab, type WorkspaceRoute } from '../match-centre/navigation';
import { useSequence } from '../match-centre/sequence/useSequence';
import { AYEW_POLICY, AYEW_SEQUENCE, PILOT_REVISION, halftimePolicy } from '../match-centre/sequence/pilot';
import { compileDepiction } from '../match-centre/sequence/depiction';
import { useSequenceText } from '../match-centre/sequence/messages';
import type { PlaybackPolicy, SequencePresentation } from '../match-centre/sequence/types';
import type { MatchSessionAdapter } from '../match-centre/session';
export function HistoricalMatchCentre({ matchId, datasetVersion, visible, tab, onNavigate, route, allowComparison = false }: { matchId: number; datasetVersion: string; visible: boolean; tab?: HistoricalTab; onNavigate: (route: WorkspaceRoute) => void; route?: Extract<WorkspaceRoute, { mode: 'reconstruction' }>; allowComparison?: boolean }) {
  const adapter = useMemo(() => createHistoricalSession(matchId, datasetVersion), [matchId, datasetVersion]);
  const t=useSequenceText(),requested=route?.sequence;
  const allowed=import.meta.env.VITE_TIMEPITCH_SEQUENCE_PREVIEW==='1'&&matchId===3754078&&datasetVersion===PILOT_REVISION;
  const actions=allowed&&requested==='ayew-equaliser-1',boundary=allowed&&requested==='halftime-check-1';
  const loaded=useSequence(adapter,actions?AYEW_SEQUENCE:null);
  const [boundaryState,setBoundary]=useState<{adapter:MatchSessionAdapter;policy:PlaybackPolicy|null;failed:boolean}|null>(null);
  const [boundaryAttempt,setBoundaryAttempt]=useState(0);
  const owned=useRef(new WeakSet<MatchSessionAdapter>()),live=useRef<MatchSessionAdapter|null>(adapter);
  useEffect(()=>{
    live.current=adapter;
    return ()=>{if(live.current===adapter)live.current=null;queueMicrotask(()=>{if(live.current!==adapter&&!owned.current.has(adapter))adapter.dispose();});};
  },[adapter]);
  useEffect(()=>{
    if(!boundary)return;
    const controller=new AbortController();setBoundary(null);
    // Read-only ensure prepares real metadata and boundary facts, never another action clip.
    void adapter.ensure(2878495,controller.signal,{playback:'paused',explicitSeek:true}).then(()=>{
      if(!controller.signal.aborted)setBoundary({adapter,policy:halftimePolicy(adapter.snapshot().descriptor),failed:false});
    }).catch(()=>{if(!controller.signal.aborted)setBoundary({adapter,policy:null,failed:true});});
    return ()=>controller.abort();
  },[adapter,boundary,boundaryAttempt]);
  const pending=actions&&loaded.status==='loading'||boundary&&(boundaryState?.adapter!==adapter||boundaryState===null);
  const failed=!!requested&&(!allowed||requested==='unavailable'||actions&&loaded.status==='unavailable'||boundary&&boundaryState?.failed===true);
  const presentation=useMemo<SequencePresentation|null>(()=>{
    if(actions&&loaded.source)return {kind:'actions',source:loaded.source,depiction:compileDepiction(loaded.source,'historical-action-preview-2'),policy:AYEW_POLICY};
    if(boundary&&boundaryState?.adapter===adapter&&boundaryState.policy)return {kind:'boundary-check',policy:boundaryState.policy};
    return null;
  },[actions,loaded.source,boundary,boundaryState,adapter]);
  const mount=!pending||owned.current.has(adapter);
  if(mount)owned.current.add(adapter);
  return <div data-match-id={matchId}>
    {pending&&<p role="status">{t.loading}</p>}
    {failed&&<p role="status">{t.pilotUnavailable}{allowed&&requested!=='unavailable'&&<button onClick={()=>actions?loaded.retry():setBoundaryAttempt(n=>n+1)}>{t.retry}</button>}</p>}
    {mount&&<MatchCentre adapter={adapter} sequence={presentation} visible={visible&&!pending} initialSection={sectionForTab(tab)} focusEvents={!presentation&&tab==='events'} actions={{ comparison: allowComparison }} onBack={() => onNavigate({ ...route, mode: 'reconstruction', matchId: undefined, tab: undefined,sequence:undefined })} onSectionChange={section => onNavigate({ ...route, mode: 'reconstruction', matchId, tab: section })} />}
  </div>;
}
