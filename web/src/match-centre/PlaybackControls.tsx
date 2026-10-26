import type { CSSProperties, ReactNode } from 'react';
import { defineTexts } from '../i18n-catalog';
import { useLanguage } from '../i18n';
import { PLAYBACK_SPEEDS, type PlaybackState } from './playback';
import type { SessionDescriptor, MatchCursor } from './session';
import { matchTime, usePlayerText } from './player-messages';
import { halftimeMs, stepTarget, transportTargets } from './transport';
import './playback-controls.css';

/** Marca sobre la barra de tiempo (TP203): un acontecimiento grabado al que se puede saltar. */
export type TransportMark = { id: string; atMs: number; seekMs: number; label: string; kind: string; icon?: ReactNode };

// Textos propios de la barra (player-messages.ts es del armazón).
const TEXT = defineTexts('playback', {
  es: { previous: 'Evento anterior', next: 'Evento siguiente', back: 'Retroceder 10 s', forward: 'Avanzar 10 s', start: "0'", halftime: 'Descanso',
    minute: 'Minuto', left: 'quedan', lasts: (speed: string, total: string) => `${speed}×: el partido dura ${total}`,
    halfLength: 'Cada parte', half: (min: string, total: string) => `Partes de ${min} min: el partido dura ${total} min` },
  en: { previous: 'Previous event', next: 'Next event', back: 'Back 10 s', forward: 'Forward 10 s', start: "0'", halftime: 'Half-time',
    minute: 'Minute', left: 'left', lasts: (speed: string, total: string) => `${speed}×: the match lasts ${total}`,
    halfLength: 'Each half', half: (min: string, total: string) => `${min}-minute halves: the match lasts ${total} min` },
});

// TP251 (25-oct: «los tiempos no casan en general»): la grabación de cada motor dura distinto (TouchLines y GRF
// en vivo van comprimidos: 5:00 para 90'; la demo, 96:51). Las velocidades multiplican la grabación, así que se muestran
// como lo que dura el partido entero a esa velocidad, y la barra en minutos de partido.
// TP254 («¿qué opciones da FIFA?»): como en FIFA, se elige la duración de cada parte. Solo las que caben sin
// cámara lenta (velocidad ≥ 1×); 2,5 min por parte deja el partido en los 5 minutos del arranque (TP252).
export const HALF_MINUTES = [2, 2.5, 3, 5, 10] as const;
/** Velocidad que deja cada parte en `halfMinutes` minutos reales. */
export const speedForHalf = (durationMs: number, halves: number, halfMinutes: number) => durationMs / (halves * halfMinutes * 60_000);
/** Duraciones de parte posibles para esta grabación, con su velocidad. */
export function halfOptions(durationMs: number, halves: number): { minutes: number; speed: number }[] {
  const options = HALF_MINUTES.map(minutes => ({ minutes, speed: speedForHalf(durationMs, halves, minutes) })).filter(o => o.speed >= 1 - 1e-9);
  // La duración natural de la grabación (1×, «tiempo real» en la demo) siempre está, si no coincide ya con una de la lista.
  const exact = durationMs / halves / 60_000, natural = exact >= 10 ? Math.round(exact) : Math.round(exact * 10) / 10;
  return options.some(o => Math.abs(o.speed - 1) < 1e-6) ? options : [...options, { minutes: natural, speed: 1 }];
}
/** Tiempo real que dura `ms` de grabación a `speed`: minutos redondeados desde 90 s; por debajo, segundos. */
export function realDuration(ms: number, speed: number): string {
  const seconds = ms / speed / 1000;
  return seconds >= 90 ? `${Math.round(seconds / 60)} min` : `${Math.max(1, Math.round(seconds))} s`;
}


const svg = (body: ReactNode, filled = false) => <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill={filled ? 'currentColor' : 'none'} stroke={filled ? 'none' : 'currentColor'} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">{body}</svg>;
const ten = <text x="12" y="15.5" fontSize="7" fill="currentColor" stroke="none" textAnchor="middle" fontWeight="700">10</text>;
const ICON = {
  play: svg(<path d="M7 4.5v15a1 1 0 001.5.86l12-7.5a1 1 0 000-1.72l-12-7.5A1 1 0 007 4.5z" />, true),
  pause: svg(<><rect x="6" y="4" width="4.5" height="16" rx="1.2" /><rect x="13.5" y="4" width="4.5" height="16" rx="1.2" /></>, true),
  back: svg(<><path d="M3 12a9 9 0 109-9 9.7 9.7 0 00-6.7 2.8L3 8" /><path d="M3 3v5h5" />{ten}</>),
  forward: svg(<><path d="M21 12a9 9 0 11-9-9 9.7 9.7 0 016.7 2.8L21 8" /><path d="M21 3v5h-5" />{ten}</>),
  previous: svg(<path d="M6 5h2v14H6zM20 5.5v13a.8.8 0 01-1.2.7L9.5 12.7a.8.8 0 010-1.4l9.3-6.5a.8.8 0 011.2.7z" />, true),
  next: svg(<path d="M16 5h2v14h-2zM4 5.5v13a.8.8 0 001.2.7l9.3-6.5a.8.8 0 000-1.4L5.2 4.8A.8.8 0 004 5.5z" />, true),
  replay: svg(<><path d="M3 12a9 9 0 109-9 9.7 9.7 0 00-6.7 2.8L3 8" /><path d="M3 3v5h5" /></>),
  soundOn: svg(<><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" /><path d="M15.5 9a4 4 0 010 6M18 6.5a7.5 7.5 0 010 11" /></>),
  soundOff: svg(<><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" /><path d="M16 9.5l5 5M21 9.5l-5 5" /></>),
};

export function PlaybackControls({ state, descriptor, cursor, onPlay, onPause, onSeek, onSpeed, onReplay, marks, sound, clock }: {
  state: PlaybackState; descriptor: SessionDescriptor; cursor: MatchCursor; onPlay: () => void; onPause: () => void; onSeek: (ms: number) => void; onSpeed: (speed: number) => void; onReplay: () => void;
  marks?: readonly TransportMark[];
  /** Interruptor del sonido del partido (TP231); sin él no se muestra. */
  sound?: { enabled: boolean; onToggle: () => void };
  /** TP251: reloj del partido. Con él, la barra va en minutos de partido y las velocidades dicen cuánto dura el partido. */
  clock?: { now: string; end: string };
}) {
  const t = usePlayerText(), { locale, t: app } = useLanguage(), x = TEXT(locale);
  const duration = descriptor.durationMs, current = state.pendingSeekMs ?? state.elapsedMs, halves = Math.max(1, descriptor.periods.length);
  const pct = (ms: number) => duration ? Math.max(0, Math.min(100, ms / duration * 100)) : 0;
  const at = (ms: number) => ({ '--pbk-at': `${pct(ms)}%` }) as CSSProperties;
  const targets = transportTargets(marks ?? [], current);
  const back = stepTarget(current, -10_000, duration), forward = stepTarget(current, 10_000, duration);
  const htMark = marks?.find(m => m.kind === 'halftime'), ht = htMark?.atMs ?? halftimeMs(descriptor.periods, duration);
  const jump = (label: string, icon: ReactNode, target: number | null) =>
    <button type="button" className="pbk-btn" aria-label={label} title={label} disabled={target === null} onClick={() => target !== null && onSeek(target)}>{icon}</button>;
  return <section className="pbk unified-transport" data-unified-transport aria-label={t.position}>
    <div className="pbk-main">
      <div className="pbk-btns">
        {marks && jump(x.previous, ICON.previous, targets.previous)}
        {jump(x.back, ICON.back, back)}
        {/* TP249 («ese botón de play» gris al acabar): al final, el botón grande vuelve a empezar en vez de quedarse apagado. */}
        {state.status === 'ended' && !state.wantsPlay
          ? <button type="button" className="pbk-btn pbk-play unified-play" data-replay aria-label={t.replay} title={t.replay} onClick={onReplay}>{ICON.replay}</button>
          : <button type="button" className="pbk-btn pbk-play unified-play" aria-label={state.wantsPlay ? t.pause : t.play} title={state.wantsPlay ? t.pause : t.play}
            onClick={state.wantsPlay ? onPause : onPlay} disabled={state.status === 'unavailable'}>{state.wantsPlay ? ICON.pause : ICON.play}</button>}
        {jump(x.forward, ICON.forward, forward)}
        {marks && jump(x.next, ICON.next, targets.next)}
      </div>
      <div className="pbk-scrub" style={{ '--pbk-fill': `${pct(current)}%` } as CSSProperties}>
        <div className="pbk-rail" aria-hidden="true"><span className="pbk-track" /><span className="pbk-fill" />{ht !== null && !htMark && <span className="pbk-ht" style={at(ht)} />}</div>
        {marks && duration ? <div className="pbk-marks">{marks.map(m => <button key={m.id} type="button" className="pbk-mk unified-mark" data-kind={m.kind} title={m.label} aria-label={m.label}
          style={at(m.atMs)} onClick={() => onSeek(m.seekMs)}>{m.kind === 'halftime' ? null : m.icon}</button>)}</div> : null}
        <input className="pbk-range" type="range" aria-label={t.position} min="0" max={duration ?? 0} step="1" value={current} disabled={duration === null} onChange={e => onSeek(Number(e.target.value))} />
        <div className="pbk-lbls" aria-hidden="true"><span>{x.start}</span>{ht !== null && <span className="pbk-lbl-ht" style={at(ht)}>{x.halftime}</span>}<span>{clock ? clock.end : matchTime(duration)}</span></div>
      </div>
      {clock && duration
        ? <div className="pbk-speed pbk-halves" role="group" aria-label={x.halfLength}><span className="pbk-speed-label" aria-hidden="true">{x.halfLength}</span>
          {halfOptions(duration, halves).map(o => { const min = o.minutes.toLocaleString(locale), name = x.half(min, (o.minutes * halves).toLocaleString(locale));
            return <button key={o.minutes} type="button" aria-pressed={Math.abs(state.speed - o.speed) < 1e-6} aria-label={name} title={name} onClick={() => onSpeed(o.speed)}>{min} min</button>; })}</div>
        : <div className="pbk-speed" role="group" aria-label={t.speed}>
          {PLAYBACK_SPEEDS.map(speed => <button key={speed} type="button" aria-pressed={state.speed === speed} onClick={() => onSpeed(speed)}>{speed.toLocaleString(locale)}×</button>)}</div>}
    </div>
    <div className="pbk-meta">
      {clock && duration
        ? <output className="unified-playback-time"><small>{x.minute}</small> {clock.now} · {x.left} {realDuration(Math.max(0, duration - current), state.speed)}</output>
        : <output className="unified-playback-time" title={t.elapsed}><small>{t.playbackTime}</small> {matchTime(current)} / {matchTime(duration)}</output>}
      <label className="pbk-phase">{t.phase}<select value={cursor.period} onChange={e => { const phase = descriptor.periods.find(p => p.period === Number(e.target.value)); if (phase?.startMs != null) onSeek(phase.startMs); }}>
        {!descriptor.periods.some(p => p.period === cursor.period) && <option value={cursor.period}>—</option>}{descriptor.periods.map(p => <option key={p.period} value={p.period} disabled={p.startMs === null}>{p.period}{p.startMs === null ? ` · ${t.missing}` : ''}</option>)}
      </select></label>
      {sound && <button type="button" className="pbk-replay pbk-sound" data-sound-toggle aria-pressed={sound.enabled}
        title={sound.enabled ? app.soundMute : app.soundUnmute} onClick={sound.onToggle}>{sound.enabled ? ICON.soundOn : ICON.soundOff}{app.sound}</button>}
      {/* Al final ya lo hace el botón grande: sin duplicado. */}
      {!(state.status === 'ended' && !state.wantsPlay) && <button type="button" className="pbk-replay" onClick={onReplay}>{ICON.replay}{t.replay}</button>}
    </div>
    {state.status === 'buffering' && <p role="status">{t.buffering}</p>}
  </section>;
}
