import type {EventView,SessionPeriod} from '../session';
import {narrate,type NarrationContext,type NarrationLine} from './narration';

export const SPEECH_SUMMARY_VERSION='speech-summary-1';
export type SpeechPhase='opening'|'halftime'|'second-half'|'fulltime';
export type SpeechMarker=Readonly<{phase:SpeechPhase;line:NarrationLine;sourceIds:readonly string[];originalTimes:readonly number[];rule:string}>;

/** Speech-only composition. Raw events, clock, action narration and goal/cache identities stay untouched. */
export function composeSpeechSummary(events:readonly EventView[],periods:readonly SessionPeriod[],durationMs:number,ctx:NarrationContext){
  const boundary=periods[1]?.startMs;
  if(periods.length!==2||periods[0].period!==1||periods[0].startMs!==0||periods[1].period!==2||boundary===null||boundary===undefined||boundary<=0||boundary>=durationMs)throw new Error('Unsupported speech period anchors');
  if(events.some(e=>(e.kind==='goal'||e.kind==='own_goal')&&e.elapsedMs===boundary))throw new Error('Ambiguous boundary goal');
  const goals=events.filter(e=>e.kind==='goal'||e.kind==='own_goal');
  const marker=(kind:string,at:number,index:number):EventView=>({id:`speech:${kind}`,kind,elapsedMs:at,period:2,periodMs:kind==='fulltime'?durationMs:0,sourceIndex:index,
    side:null,actorId:null,participantIds:[],outcome:null,provenance:'derived_from_events',refs:[],details:{speech_summary_version:SPEECH_SUMMARY_VERSION,period_start:kind==='kickoff'}});
  const canonical=[...goals,marker('halftime',boundary,-2),marker('kickoff',boundary,-1),marker('fulltime',durationMs,Number.MAX_SAFE_INTEGER)];
  const marks=narrate(canonical,ctx).filter(l=>l.kind==='mark');
  const phases:SpeechPhase[]=['opening','halftime','second-half','fulltime'];
  const markers:SpeechMarker[]=phases.map(phase=>{
    const kind=phase==='second-half'?'kickoff':phase;
    const line=marks.find(l=>phase==='opening'?l.source.id==='narration:start':l.source.id===`speech:${kind}`);
    if(!line)throw new Error('Missing canonical speech marker');
    const originals=events.filter(e=>phase==='opening'?e.kind==='kickoff'&&e.period===1&&e.details.period_start!==false:
      phase==='second-half'?e.kind==='kickoff'&&e.period===2&&e.details.period_start!==false:
      phase==='fulltime'?e.kind==='fulltime'||e.kind==='episode_end':e.kind==='halftime');
    return{phase,line:{...line,source:{...line.source,provenance:'derived_from_events',refs:originals.map(e=>e.id)}},sourceIds:originals.map(e=>e.id),originalTimes:originals.flatMap(e=>e.elapsedMs===null?[]:[e.elapsedMs]),rule:phase==='second-half'?'observed_period_boundary_not_prepared_decision':'observed_period_boundary'};
  });
  return{version:SPEECH_SUMMARY_VERSION,markers,actionLines:narrate(events,ctx).filter(l=>l.kind!=='mark')};
}
