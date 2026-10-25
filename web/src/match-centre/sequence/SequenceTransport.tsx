import type { PlaybackState } from '../playback';
import { usePlayerText } from '../player-messages';
import type { ClockView, PlaybackPolicy } from './types';
import { useSequenceText } from './messages';
export function SequenceTransport({state,policy,clock,ready,onPlay,onPause,onReplay,onNext,onSeek,onSpeed,onContinue,next}:{
  state:PlaybackState;policy:PlaybackPolicy;clock:ClockView;ready:boolean;next:number|null;
  onPlay:()=>void;onPause:()=>void;onReplay:()=>void;onNext:()=>void;onSeek:(ms:number)=>void;onSpeed:(rate:number)=>void;onContinue:()=>void;
}){
  const t=useSequenceText(),p=usePlayerText(),atEnd=(state.pendingSeekMs??state.elapsedMs)>=policy.toMs;
  return <div className="sequence-transport" data-unified-transport>
    <div className="sequence-control-row">
      {state.stop?.kind==='halftime'?<button className="sequence-play" disabled={!ready} onClick={onContinue}>{t.continue}</button>:<button className="sequence-play" disabled={!ready||atEnd} onClick={state.wantsPlay?onPause:onPlay}>{state.wantsPlay?p.pause:p.play}</button>}
      <button onClick={onReplay}>{t.replay}</button><button disabled={next===null} onClick={onNext}>{t.next}</button>
      <label>{p.speed}<select value={state.speed} onChange={e=>onSpeed(Number(e.target.value))}>{policy.speeds.map(speed=><option key={speed} value={speed}>{speed}×</option>)}</select></label>
      <output>{!ready?t.loading:atEnd?t.clipEnd:clock.text}</output>
    </div>
    <label className="sequence-position">{t.position}<input type="range" min={policy.fromMs} max={policy.toMs} step="1" value={state.pendingSeekMs??state.elapsedMs} onChange={e=>onSeek(Number(e.target.value))}/></label>
  </div>;
}
