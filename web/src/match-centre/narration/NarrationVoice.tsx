import { useEffect, useMemo, useRef, useState } from 'react';
import { defineTexts, isLocale } from '../../i18n-catalog';
import { useLanguage } from '../../i18n';
import type { EventView } from '../session';
import type { TimelineContext } from '../analysis/RecordedAnalysisViews';
import { narrate, type NarrationLine } from './narration';
import {ReplayAudioControls} from './ReplayAudioControls';
import type {ReplayAudioSource} from './ReplayAudio';
import {SavedSpeechVoice,type SpeechPresentation,type SavedSpeechControl} from './SavedSpeechVoice';

const TEXT = defineTexts('narration-voice', {
  en: { on: 'Voice on', off: 'Voice off', voice: 'Commentator voice', unavailable: 'No supported local voice. Install one in your device settings.', failed: 'Voice could not play. Turn it on to try again.', note: 'Device voice · no Azure request. Commentary follows the voice language; expressiveness depends on the installed voice.',provider:'Audio source',device:'Device voice',test:'Local test tones',testOn:'Test audio on',testOff:'Test audio off' },
  es: { on: 'Voz activada', off: 'Voz desactivada', voice: 'Voz del narrador', unavailable: 'No hay una voz local compatible. Instala una en los ajustes del dispositivo.', failed: 'No se pudo reproducir la voz. Actívala para volver a probar.', note: 'Voz del dispositivo · sin peticiones a Azure. La narración sigue el idioma de la voz; la expresividad depende de la voz instalada.',provider:'Fuente de audio',device:'Voz del dispositivo',test:'Tonos de prueba locales',testOn:'Audio de prueba activado',testOff:'Audio de prueba desactivado' },
});

/** Speaks only newly crossed, recent events. Pause, seek, cuts and identity changes discard the utterance. */
export function useReplayVoice(lines: readonly NarrationLine[], cursor: number, active: boolean, enabled: boolean,
  seekToken: number, cut: number, locale: string, voice: SpeechSynthesisVoice | null, onError: () => void) {
  const previous = useRef<{cursor:number;active:boolean;enabled:boolean;seekToken:number;cut:number;locale:string;voice:SpeechSynthesisVoice|null}|null>(null);
  const owned=useRef<SpeechSynthesisUtterance|null>(null);
  useEffect(()=>{
    const synth=globalThis.speechSynthesis;
    const before=previous.current;
    previous.current={cursor,active,enabled,seekToken,cut,locale,voice};
    const cancel=()=>{if(owned.current){owned.current=null;synth?.cancel();}};
    if(!synth||!active||!enabled||!voice||!before||!before.active||!before.enabled||before.seekToken!==seekToken||before.cut!==cut||before.locale!==locale||before.voice!==voice||cursor<before.cursor||cursor-before.cursor>2000){cancel();return;}
    const fresh=lines.filter(l=>l.atMs>before.cursor&&l.atMs<=cursor&&cursor-l.atMs<=2000);
    const isGoal=(l:NarrationLine)=>l.kind==='goal'||l.kind==='own_goal';
    const line=fresh.filter(isGoal).at(-1)??fresh.at(-1);
    if(!line)return;
    // Never queue ordinary commentary behind the action; a goal may interrupt an older sentence.
    if(synth.speaking&&!isGoal(line))return;
    cancel();
    const utterance=new SpeechSynthesisUtterance(line.text);
    utterance.voice=voice;utterance.lang=voice.lang;
    utterance.rate=isGoal(line)?1.12:1;
    utterance.pitch=isGoal(line)?1.18:line.kind==='shot'?1.08:1;
    utterance.volume=1;
    utterance.onend=()=>{if(owned.current===utterance)owned.current=null;};
    utterance.onerror=event=>{if(owned.current!==utterance)return;owned.current=null;if(event.error!=='canceled'&&event.error!=='interrupted')onError();};
    owned.current=utterance;synth.speak(utterance);
  },[lines,cursor,active,enabled,seekToken,cut,locale,voice,onError]);
  useEffect(()=>()=>{if(owned.current){owned.current=null;globalThis.speechSynthesis?.cancel();}},[]);
}

type VoiceProps={ctx:TimelineContext;events:readonly EventView[];keepers:ReadonlySet<string>;cursor:number;active:boolean;seekToken:number;cut:number;speed?:number;testAudio?:ReplayAudioSource;savedAudio?:ReplayAudioSource;speechPresentation?:SpeechPresentation;onSpeechControl?:(control:SavedSpeechControl|null)=>void};
export function NarrationVoice(props:VoiceProps){
  // Public release has no voice; saved and device narration remain available in local previews.
  if(!import.meta.env.DEV)return null;
  if(props.savedAudio)return props.speechPresentation?<SavedSpeechVoice {...props} source={props.savedAudio} speed={props.speed??1} presentation={props.speechPresentation}/>:<small role="status">Saved audio unavailable</small>;
  return <DeviceNarrationVoice {...props}/>;
}
function DeviceNarrationVoice({ctx,events,keepers,cursor,active,seekToken,cut,speed=1,testAudio}:VoiceProps) {
  const {locale}=useLanguage(),t=TEXT(locale);
  const [voices,setVoices]=useState<SpeechSynthesisVoice[]>([]),[enabled,setEnabled]=useState(false),[choice,setChoice]=useState(''),[failed,setFailed]=useState(false);
  const [provider,setProvider]=useState<'device'|'test'>(()=>testAudio?'test':'device'),[testLanguage,setTestLanguage]=useState<'en'|'es'>(locale==='es'?'es':'en');
  useEffect(()=>{
    const synth=globalThis.speechSynthesis;if(!synth)return;
    const refresh=()=>setVoices(synth.getVoices().filter(v=>v.localService&&isLocale(v.lang.toLowerCase().split(/[-_]/)[0])));
    refresh();synth.addEventListener('voiceschanged',refresh);return()=>synth.removeEventListener('voiceschanged',refresh);
  },[]);
  const available=voices;
  const voice=available.find(v=>v.voiceURI===choice)??available.find(v=>v.lang.toLowerCase().split(/[-_]/)[0]===locale)??available.find(v=>v.default)??available[0]??null;
  const testing=provider==='test'&&!!testAudio;
  const language=voice?.lang.toLowerCase().split(/[-_]/)[0],spokenLocale=testing?testLanguage:isLocale(language)?language:locale;
  const lines=useMemo(()=>enabled&&active?narrate(events,{locale:spokenLocale,keepers,name:id=>ctx.player(id)?.name??null,teams:{home:ctx.teams.home.name,away:ctx.teams.away.name}}):[],[events,spokenLocale,keepers,ctx,enabled,active]);
  const fail=useRef(()=>{setFailed(true);setEnabled(false);}).current;
  useReplayVoice(lines,cursor,active,enabled&&!testing,seekToken,cut,spokenLocale,voice,fail);
  return <div className="tp-voice-controls" data-narration-voice>
    {testAudio&&<label>{t.provider}<select aria-label={t.provider} value={provider} onChange={e=>{setEnabled(false);setProvider(e.target.value as 'device'|'test');}}><option value="test">{t.test}</option><option value="device">{t.device}</option></select></label>}
    <button type="button" aria-pressed={enabled} disabled={!testing&&!voice} onClick={()=>{setFailed(false);setEnabled(v=>!v);}}>{testing?(enabled?t.testOn:t.testOff):(enabled?t.on:t.off)}</button>
    {testing?<ReplayAudioControls source={testAudio!} language={testLanguage} onLanguage={setTestLanguage} frame={{cursorMs:cursor,active,enabled,speed,seek:seekToken,cut}} lines={lines}/>:
    <>{voice&&<label>{t.voice}<select aria-label={t.voice} value={voice.voiceURI} onChange={e=>setChoice(e.target.value)}>{available.map(v=><option key={v.voiceURI} value={v.voiceURI}>{v.name} · {v.lang}</option>)}</select></label>}
    <small role={failed?'status':undefined}>{!voice?t.unavailable:failed?t.failed:t.note}</small></>}
  </div>;
}
