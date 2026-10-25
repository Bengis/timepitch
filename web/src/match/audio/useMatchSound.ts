// Enlace del sonido con el reloj de reproducción del centro (TP231). Cada cambio de cursor pasa por `stepSounds`
// (puro); el estado avanza aunque el sonido esté apagado, así que activarlo no suelta sonidos atrasados.
import { useEffect, useMemo, useRef } from 'react';
import type { Announcement } from '../../match-centre/announcements/announcements';
import type { EventView } from '../../match-centre/session';
import { cueSources, initialSoundState, stepSounds } from './cues';
import { matchAudio, type MatchAudio } from './engine';

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function useMatchSound({ events, announcements, cursorMs, speed, playing, seekToken, seeking, enabled, active, audio = matchAudio }: {
  events: readonly EventView[]; announcements: readonly Announcement[]; cursorMs: number; speed: number; playing: boolean;
  seekToken: number; seeking: boolean; enabled: boolean; active: boolean; audio?: MatchAudio;
}) {
  const sources = useMemo(() => cueSources(events, announcements), [events, announcements]);
  const state = useRef(initialSoundState());
  const on = enabled && active;
  useEffect(() => {
    const step = stepSounds(state.current, sources, { cursorMs, wallMs: now(), speed, playing, seekToken, seeking });
    state.current = step.state;
    if (on) for (const cue of step.cues) audio.play(cue);
  }, [sources, cursorMs, speed, playing, seekToken, seeking, on, audio]);
  useEffect(() => { audio.setAmbience(on && playing); }, [on, playing, audio]);
  useEffect(() => () => audio.setAmbience(false), [audio]);
}
