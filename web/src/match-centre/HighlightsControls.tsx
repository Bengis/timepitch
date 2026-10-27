import {defineTexts} from '../i18n-catalog';
import {useLanguage} from '../i18n';
import {matchTime} from './player-messages';
import type {PlaybackState} from './playback';

const TEXT=defineTexts('highlights',{
  en:{summary:'Highlights',full:'Full match',restart:'Restart highlights',natural:'1× · natural-speed play; gaps skipped',jump:(from:string,to:string)=>`Replay jump: ${from} → ${to}`},
  es:{summary:'Resumen',full:'Partido completo',restart:'Reiniciar resumen',natural:'1× · jugadas a velocidad natural; saltamos los tramos intermedios',jump:(from:string,to:string)=>`Salto del replay: ${from} → ${to}`},
});
export function HighlightsControls({active,durationMs,onMode}:{active:boolean;durationMs:number;onMode:(active:boolean)=>void}){
  const {locale}=useLanguage(),t=TEXT(locale);
  return <div className="tp-highlights" data-highlights-mode={active?'summary':'full'}>
    <div className="tp-highlights-modes"><button type="button" aria-pressed={active} onClick={()=>{if(!active)onMode(true);}}>{active?t.summary:t.restart}</button>
      <button type="button" aria-pressed={!active} onClick={()=>{if(active)onMode(false);}}>{t.full}</button>
      {active&&<span className="tp-highlights-duration">≈ {matchTime(durationMs)}</span>}</div>
    {active&&<p>{t.natural}</p>}
  </div>;
}
export function HighlightsCut({elapsedMs,jump}:{elapsedMs:number;jump:PlaybackState['jump']}){
  const {locale}=useLanguage(),t=TEXT(locale);
  return jump&&elapsedMs>=jump.toMs&&elapsedMs<jump.toMs+3000
    ?<p className="tp-highlights-cut" role="status" data-highlight-jump>{t.jump(matchTime(jump.fromMs),matchTime(jump.toMs))}</p>:null;
}
