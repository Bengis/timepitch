import {useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {useLanguage} from '../../i18n';
import type {EventView,SessionPeriod} from '../session';
import type {TimelineContext} from '../analysis/RecordedAnalysisViews';
import {ReplayAudio,type ReplayAudioSource,type ReplayAudioEvent,type PresentationResult} from './ReplayAudio';
import {loadSavedSpeechAudio} from './saved-speech';
import {loadSummarySpeechAudio} from './summary-speech';
import {applySummaryCorrections,summaryScope} from './summary-corrections';
import {composeSpeechSummary,type SpeechPhase} from './speech-summary';

export type SpeechPresentation={phase:SpeechPhase|'live';periods:readonly SessionPeriod[];durationMs:number};
export type SavedSpeechControl={present:(phase:SpeechPhase)=>Promise<PresentationResult>;cancel:()=>void};
export type SavedSpeechVoiceProps={source:ReplayAudioSource;ctx:TimelineContext;events:readonly EventView[];keepers:ReadonlySet<string>;cursor:number;active:boolean;seekToken:number;cut:number;speed:number;presentation:SpeechPresentation;onSpeechControl?:(control:SavedSpeechControl|null)=>void};

/** Saved, verified audio only. The local summary uses the same port for replay and held presentation cards. */
export function SavedSpeechVoice({source,ctx,events,keepers,cursor,active,seekToken,cut,speed,presentation,onSpeechControl}:SavedSpeechVoiceProps){
  const {locale}=useLanguage(),es=locale==='es',supported=locale==='en'||locale==='es';
  const [language,setLanguage]=useState<'en'|'es'>(es?'es':'en'),[enabled,setEnabled]=useState(false),[volume,setVolume]=useState(.45),[muted,setMuted]=useState(false);
  const [status,setStatus]=useState<'loading'|'ready'|'unavailable'>('loading'),[log,setLog]=useState<ReplayAudioEvent[]>([]);
  const [documentVisible,setDocumentVisible]=useState(()=>!document.hidden);
  const [partial,setPartial]=useState(false);
  const audio=useRef<HTMLAudioElement>(null),controller=useRef<ReplayAudio|null>(null);
  const gate=useRef({enabled,supported,speed,status,documentVisible,cursor});
  gate.current={enabled,supported,speed,status,documentVisible,cursor};
  const record=useCallback((event:ReplayAudioEvent)=>{
    setLog(current=>[...current,event].slice(-200));
    audio.current?.dispatchEvent(new CustomEvent('replay-audio',{detail:event}));
    if(event.kind==='error'||event.kind==='skip'||event.reason==='late_or_window_end'&&!event.audioEnded)setPartial(true);
  },[]);
  const isSummary=source.manifestUrl==='/speech-summary-preview/manifest.json';
  const summary=useMemo(()=>composeSpeechSummary(events,presentation.periods,presentation.durationMs,{locale:language,keepers,name:id=>ctx.player(id)?.name??null,teams:{home:ctx.teams.home.name,away:ctx.teams.away.name}}),[events,presentation.periods,presentation.durationMs,language,keepers,ctx]);
  const spokenLines=useMemo(()=>applySummaryCorrections(summary.actionLines,isSummary?summaryScope(source.expectedSource,language):[]),[summary,isSummary,source,language]);
  const marker=presentation.phase==='live'?undefined:summary.markers.find(m=>m.phase===presentation.phase&&cursor>=m.line.atMs);
  useEffect(()=>{
    const control:SavedSpeechControl={present:phase=>{
      const g=gate.current;
      if(!g.enabled||!g.supported||g.speed!==1)return Promise.resolve('skipped');
      const reason=!g.documentVisible||document.hidden?'presentation_hidden':g.status!=='ready'?'presentation_unavailable':undefined;
      if(controller.current)return controller.current.playPresentation(phase,reason);
      record({kind:'skip',reason:reason??'presentation_no_controller',atMs:g.cursor});
      return Promise.resolve('skipped');
    },cancel:()=>controller.current?.cancelPresentation()};
    onSpeechControl?.(control);return()=>{control.cancel();onSpeechControl?.(null);};
  },[onSpeechControl,record]);
  useEffect(()=>{setEnabled(false);},[locale]);
  useEffect(()=>{
    const changed=()=>{if(document.hidden)controller.current?.suspend();setDocumentVisible(!document.hidden);};
    document.addEventListener('visibilitychange',changed);
    return()=>document.removeEventListener('visibilitychange',changed);
  },[]);
  useEffect(()=>{
    const abort=new AbortController();setStatus('loading');setPartial(false);
    const load=isSummary?loadSummarySpeechAudio:loadSavedSpeechAudio;
    void load(source,language,abort.signal).then(prepared=>{
      if(abort.signal.aborted||!audio.current){prepared.release();return;}
      controller.current=new ReplayAudio(audio.current,prepared,event=>{
        if(abort.signal.aborted)return;
        record(event);
      });
      setStatus(prepared.clips.length?'ready':'unavailable');
    }).catch(()=>{if(!abort.signal.aborted)setStatus('unavailable');});
    return()=>{abort.abort();controller.current?.dispose();controller.current=null;};
  },[source,language,isSummary,record]);
  // Prepare the exact held cursor before the parent's layout requests a marker.
  useLayoutEffect(()=>{controller.current?.update({cursorMs:cursor,active:active&&documentVisible,enabled:enabled&&supported,speed,seek:seekToken,cut,volume:muted?0:volume},spokenLines);},[cursor,active,documentVisible,enabled,supported,speed,seekToken,cut,volume,muted,spokenLines,status]);
  return <div className="tp-test-audio" data-saved-speech data-audio-status={status} data-speech-phase={presentation.phase} data-speech-events={JSON.stringify(log)}>
    <strong>{isSummary?(es?`50 clips guardados · ${partial?'cobertura parcial':'25 por idioma'} · sin audio nuevo`:`50 saved clips · ${partial?'partial coverage':'25 per language'} · no new audio`):(es?'Clips Azure guardados · prueba 4A · solo primer gol':'Saved Azure clips · 4A preview · first goal only')}</strong>
    <button type="button" aria-pressed={enabled} disabled={!supported||status!=='ready'} onClick={()=>setEnabled(v=>!v)}>{es?(enabled?'Desactivar voz guardada':'Activar voz guardada'):(enabled?'Saved voice off':'Saved voice on')}</button>
    <label>{es?'Idioma de voz guardada':'Saved voice language'}<select value={language} onChange={e=>{setEnabled(false);setLanguage(e.target.value as 'en'|'es');}}><option value="en">English</option><option value="es">Español</option></select></label>
    <label>{es?'Volumen de voz guardada':'Saved voice volume'}<input type="range" min="0" max="1" step="0.05" value={volume} onChange={e=>setVolume(Number(e.target.value))}/></label>
    <button type="button" aria-pressed={muted} onClick={()=>setMuted(v=>!v)}>{muted?(es?'Activar sonido':'Unmute saved voice'):(es?'Silenciar':'Mute saved voice')}</button>
    <small role="status">{!supported?(es?'Sin voz guardada para este idioma':'No saved voice for this language'):speed!==1?(es?'Voz silenciada fuera de 1×':'Saved voice muted outside 1×'):status==='loading'?(es?'Cargando voz guardada…':'Loading saved audio…'):status==='ready'?(es?'Audio guardado preparado':'Saved audio ready'):(es?'Audio guardado no disponible':'Saved audio unavailable')}</small>
    {marker&&<p data-speech-marker={marker.phase}>{marker.line.text} <small>{isSummary?(es?'Rótulo hablado · reloj del partido detenido':'Spoken presentation · match clock held'):(es?'Solo texto · todavía no hay audio para este hito':'Text only · no saved audio for this marker yet')}</small></p>}
    <output data-speech-metrics>{log.at(-1)?.kind}{log.at(-1)?.startLagMs!==undefined?` · ${log.at(-1)!.startLagMs!.toFixed(1)} ms / ${log.at(-1)!.deadlineMs} ms`:''}</output>
    <audio ref={audio} hidden preload="auto" data-saved-speech-audio onEnded={()=>{
      const handled=controller.current?.ended();
      if(!handled&&audio.current)setLog(current=>[...current,{kind:'stop' as const,reason:'audio_ended',atMs:cursor,audioTimeMs:audio.current!.currentTime*1000,audioEnded:audio.current!.ended}].slice(-200));
      audio.current?.dispatchEvent(new CustomEvent('replay-audio-ended',{detail:{cursor}}));
    }}/>
  </div>;
}
