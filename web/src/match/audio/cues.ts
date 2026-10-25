// Qué suena y cuándo (TP231). Puro: ni Web Audio ni React, para probarlo sin navegador.
// Fuentes: los rótulos ya deduplicados del centro (goles, pitadas, ocasiones) y los eventos crudos de golpeo
// (pase y tiro de cada motor). Se dispara lo cruzado entre el cursor anterior y el actual mientras se reproduce;
// una búsqueda, un salto o ir hacia atrás no dispara nada (como los rótulos, sin ráfagas atrasadas).
import type { Announcement } from '../../match-centre/announcements/announcements';
import type { EventView } from '../../match-centre/session';

export type SoundCue = 'whistle-kickoff' | 'whistle-half' | 'whistle-full' | 'goal' | 'ooh' | 'shot' | 'kick';
export type CueSource = Readonly<{ id: string; atMs: number; cue: SoundCue }>;

const ANNOUNCED: Partial<Record<Announcement['kind'], SoundCue>> = {
  kick_off: 'whistle-kickoff', half_time: 'whistle-half', full_time: 'whistle-full', goal: 'goal', own_goal: 'goal',
  shot_saved: 'ooh', shot_off_target: 'ooh', shot_blocked: 'ooh',
};
/** Golpeos por tipo de evento crudo: TimePitch y grabados en minúsculas, histórico (StatsBomb) con mayúscula. */
const KICKS: Readonly<Record<string, SoundCue>> = { pass: 'kick', shot: 'shot', shot_on_target: 'shot' };

export function cueSources(events: readonly EventView[], announcements: readonly Announcement[]): CueSource[] {
  const out: CueSource[] = [];
  for (const a of announcements) { const cue = ANNOUNCED[a.kind]; if (cue) out.push({ id: a.id, atMs: a.atMs, cue }); }
  for (const e of events) {
    const cue = KICKS[e.kind.toLowerCase()];
    if (cue && e.elapsedMs !== null && Number.isFinite(e.elapsedMs)) out.push({ id: e.id, atMs: e.elapsedMs, cue });
  }
  return out;
}

/** Por encima de esta velocidad solo suenan goles y pitadas (más el ambiente): ni golpeos ni «uuuh». */
export const KICK_SPEED_LIMIT = 10;
/** Separación mínima en tiempo real entre golpeos: a 10× unos 0,7 s, para que no suene a metralleta. */
export const kickGapMs = (speed: number) => (speed <= 1 ? 90 : 70 * speed);

/** `settling`: tras una búsqueda nueva, el primer movimiento del cursor puede ser aún el salto y tampoco suena. */
export type SoundStepState = Readonly<{ cursorMs: number | null; seekToken: number; settling: boolean; lastKickWallMs: number }>;
export const initialSoundState = (): SoundStepState => ({ cursorMs: null, seekToken: 0, settling: false, lastKickWallMs: -Infinity });
export type SoundStepInput = Readonly<{
  cursorMs: number; wallMs: number; speed: number; playing: boolean;
  /** Cambia con cada búsqueda pedida por el usuario. */
  seekToken: number;
  /** Hay una búsqueda pendiente: el cursor aún no ha llegado al destino. */
  seeking: boolean;
}>;

const ORDER: readonly SoundCue[] = ['whistle-kickoff', 'whistle-half', 'whistle-full', 'goal', 'ooh', 'shot', 'kick'];

export function stepSounds(state: SoundStepState, sources: readonly CueSource[], input: SoundStepInput): { state: SoundStepState; cues: SoundCue[] } {
  const { cursorMs, wallMs, speed, playing, seekToken, seeking } = input;
  if (seeking) return { state: { ...state, cursorMs: null, seekToken, settling: false }, cues: [] };
  const previous = state.cursorMs;
  const reset = { ...state, cursorMs, seekToken, settling: false };
  if (seekToken !== state.seekToken) return { state: { ...reset, settling: true }, cues: [] };
  if (previous === cursorMs) return { state: { ...state, seekToken }, cues: [] };
  // Sin referencia, recién buscado, hacia atrás o en pausa: se recoloca el cursor sin sonar.
  if (previous === null || state.settling || cursorMs < previous || !playing) return { state: reset, cues: [] };
  // Un avance mayor que el que da la velocidad (salto de ±10 s, pestaña en segundo plano) cuenta como búsqueda.
  if (cursorMs - previous > Math.max(1500, speed * 1500)) return { state: reset, cues: [] };
  const crossed = new Set<SoundCue>();
  // Desde 0 se incluye el propio 0: la pitada inicial está en el primer instante del partido.
  for (const s of sources) if ((s.atMs > previous || previous === 0 && s.atMs === 0) && s.atMs <= cursorMs) crossed.add(s.cue);
  const fast = speed > KICK_SPEED_LIMIT;
  if (fast || crossed.has('goal')) crossed.delete('ooh');
  let lastKickWallMs = state.lastKickWallMs;
  // Un solo golpeo por paso (el tiro manda sobre el pase) y con separación mínima según la velocidad.
  const kick: SoundCue | null = crossed.has('shot') ? 'shot' : crossed.has('kick') ? 'kick' : null;
  crossed.delete('shot'); crossed.delete('kick');
  if (kick && !fast && wallMs - lastKickWallMs >= kickGapMs(speed)) { crossed.add(kick); lastKickWallMs = wallMs; }
  return { state: { cursorMs, seekToken, settling: false, lastKickWallMs }, cues: ORDER.filter(cue => crossed.has(cue)) };
}
