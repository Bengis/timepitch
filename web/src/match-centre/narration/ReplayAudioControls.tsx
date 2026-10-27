import {useEffect,useRef,useState} from 'react';
import {defineTexts} from '../../i18n-catalog';
import {useLanguage} from '../../i18n';
import type {NarrationLine} from './narration';
import {ReplayAudio,loadTestReplayAudio,type ReplayAudioSource,type ReplayAudioFrame} from './ReplayAudio';

const TEXT=defineTexts('replay-audio-test',{
  en:{label:'Local test tones · NOT Azure Speech or a voice',loading:'Loading test audio…',ready:'Test audio ready',unavailable:'No compatible test audio',speed:'Test audio muted outside 1×',language:'Test audio language',volume:'Test audio volume',mute:'Mute test audio',unmute:'Unmute test audio'},
  es:{label:'Tonos de prueba locales · NO es Azure Speech ni una voz',loading:'Cargando audio de prueba…',ready:'Audio de prueba preparado',unavailable:'No hay audio de prueba compatible',speed:'Audio de prueba silenciado fuera de 1×',language:'Idioma del audio de prueba',volume:'Volumen del audio de prueba',mute:'Silenciar audio de prueba',unmute:'Activar sonido de prueba'},
});

export function ReplayAudioControls({source,language,onLanguage,frame,lines}:{source:ReplayAudioSource;language:'en'|'es';onLanguage:(value:'en'|'es')=>void;frame:Omit<ReplayAudioFrame,'volume'>;lines:readonly NarrationLine[]}){
  const {locale}=useLanguage(),t=TEXT(locale),element=useRef<HTMLAudioElement>(null),controller=useRef<ReplayAudio|null>(null);
  const [status,setStatus]=useState<'loading'|'ready'|'unavailable'>('loading'),[volume,setVolume]=useState(.45),[muted,setMuted]=useState(false);
  useEffect(()=>{
    const abort=new AbortController();setStatus('loading');
    void loadTestReplayAudio(source,language,abort.signal).then(prepared=>{
      if(abort.signal.aborted||!element.current){prepared.release();return;}
      controller.current=new ReplayAudio(element.current,prepared,event=>{
        if(abort.signal.aborted)return;
        if(event.kind==='error')setStatus('unavailable');
        element.current?.dispatchEvent(new CustomEvent('replay-audio',{detail:event}));
      });
      setStatus(prepared.clips.length?'ready':'unavailable');
    }).catch(error=>{if(!abort.signal.aborted){console.warn('Local test audio unavailable:',error);setStatus('unavailable');}});
    return()=>{abort.abort();controller.current?.dispose();controller.current=null;};
  },[source,language]);
  useEffect(()=>{controller.current?.update({...frame,volume:muted?0:volume},lines);},[frame,lines,volume,muted,status]);
  return <div className="tp-test-audio" data-replay-audio-test data-audio-status={status}>
    <strong>{t.label}</strong>
    <label>{t.language}<select aria-label={t.language} value={language} onChange={e=>onLanguage(e.target.value as 'en'|'es')}><option value="en">English</option><option value="es">Español</option></select></label>
    <label>{t.volume}<input aria-label={t.volume} type="range" min="0" max="1" step="0.05" value={volume} onChange={e=>setVolume(Number(e.target.value))}/></label>
    <button type="button" aria-pressed={muted} onClick={()=>setMuted(v=>!v)}>{muted?t.unmute:t.mute}</button>
    <small role="status">{frame.speed!==1?t.speed:t[status]}</small>
    <audio ref={element} hidden preload="auto" data-replay-audio/>
  </div>;
}
