// Capa de escenas de Capitán Hane (TP234). Ligera y cargada solo con el modo elegido: decide con `stepCutIns`
// (puro) cuándo empieza y acaba una escena, PAUSA el reloj del centro al empezar y lo reanuda al terminar o al
// saltarla, así que el partido sigue sincronizado. El dibujo (SVG) va en `CutInOverlay`, que se importa a demanda.
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { Announcement } from '../../match-centre/announcements/announcements';
import type { EventView } from '../../match-centre/session';
import { matchAudio, type MatchAudio } from '../audio/engine';
import { cutInSources, initialCutInState, skipCutIn, stepCutIns, type AnimeScenes, type CutIn, type CutInStep } from './cutins';
import type { CutInSpec } from './scene';

const CutInOverlay = lazy(() => import('./CutInOverlay'));
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export type Showing = Readonly<{ cut: CutIn; spec: CutInSpec; durationMs: number; reducedMotion: boolean; token: number }>;

/** Cuándo suena el golpe dentro de la escena (la carga dura hasta ahí). Coincide con anime.css (55 %). */
export const IMPACT_AT = 0.55;

const NO_KEEPERS: ReadonlySet<string> = new Set();

export function AnimeCutIns({ events, announcements, keeperIds = NO_KEEPERS, cursorMs, speed, playing, seekToken, seeking, scenes, reducedMotion, soundOn,
  pause, play, specFor, labels, audio = matchAudio }: {
  events: readonly EventView[]; announcements: readonly Announcement[];
  /** Porteros (para deducir paradas y saques de puerta en motores sin desenlace del tiro, TP238). */
  keeperIds?: ReadonlySet<string>;
  cursorMs: number; speed: number; playing: boolean;
  seekToken: number; seeking: boolean; scenes: AnimeScenes; reducedMotion: boolean; soundOn: boolean;
  pause: () => void; play: () => void;
  /** Escena dibujable para un acontecimiento (primer plano, nombre del movimiento, habilidad); `null` = no se muestra. */
  specFor: (cut: CutIn) => CutInSpec | null;
  labels: Readonly<{ dialog: string; skip: string; describe: (spec: CutInSpec) => string }>;
  audio?: MatchAudio;
}) {
  const sources = useMemo(() => cutInSources(events, announcements, keeperIds), [events, announcements, keeperIds]);
  const state = useRef(initialCutInState());
  const [showing, setShowing] = useState<Showing | null>(null);
  const latest = useRef({ cursorMs, speed, playing, seekToken, seeking, scenes, reducedMotion });
  latest.current = { cursorMs, speed, playing, seekToken, seeking, scenes, reducedMotion };
  const handlers = useRef({ pause, play, specFor, soundOn, audio });
  handlers.current = { pause, play, specFor, soundOn, audio };
  const timers = useRef<number[]>([]);
  const token = useRef(0);
  const clearTimers = () => { for (const t of timers.current) clearTimeout(t); timers.current = []; };

  const apply = (step: CutInStep) => {
    state.current = step.state;
    const h = handlers.current;
    if (step.end) {
      clearTimers(); setShowing(null);
      if (step.end.resume) h.play();
    }
    if (step.start) {
      const spec = h.specFor(step.start), shown = step.state.showing!;
      if (!spec) { state.current = { ...step.state, showing: null }; return; }
      h.pause();
      const durationMs = shown.durationMs, current = ++token.current;
      setShowing({ cut: step.start, spec, durationMs, reducedMotion: shown.reducedMotion, token: current });
      if (h.soundOn && h.audio.playAnime) {
        h.audio.playAnime({ kind: 'whoosh' });
        if (!shown.reducedMotion) h.audio.playAnime({ kind: 'charge', seconds: durationMs * IMPACT_AT / 1000 - 0.05 });
        timers.current.push(window.setTimeout(() => { if (token.current === current && handlers.current.soundOn) h.audio.playAnime?.({ kind: 'impact' }); },
          shown.reducedMotion ? 120 : durationMs * IMPACT_AT));
      }
      timers.current.push(window.setTimeout(() => {
        if (token.current === current) apply(stepCutIns(state.current, sources, { ...latest.current, wallMs: now() }));
      }, durationMs + 16));
    }
  };
  useEffect(() => {
    apply(stepCutIns(state.current, sources, { cursorMs, wallMs: now(), speed, playing, seekToken, seeking, scenes, reducedMotion }));
  }, [sources, cursorMs, speed, playing, seekToken, seeking, scenes, reducedMotion]); // eslint-disable-line react-hooks/exhaustive-deps
  // Al salir del modo con una escena en pantalla, el partido vuelve a reproducirse como estaba.
  useEffect(() => () => { clearTimers(); if (state.current.showing) handlers.current.play(); }, []);

  if (!showing) return null;
  return <Suspense fallback={null}>
    <CutInOverlay key={showing.token} spec={showing.spec} durationMs={showing.durationMs} reducedMotion={showing.reducedMotion}
      label={labels.dialog} skipHint={labels.skip} description={labels.describe(showing.spec)} onSkip={() => apply(skipCutIn(state.current))} />
  </Suspense>;
}
