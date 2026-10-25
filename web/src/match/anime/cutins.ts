// Escenas de Capitán Hane (TP234): qué acontecimiento grabado dispara una escena, cuándo y cuánto dura. Puro (sin
// React ni DOM) para probarlo sin navegador. Solo se usan acontecimientos que el motor grabó, con su protagonista
// y su resultado: nunca se inventa ni se cambia un resultado. La escena congela el reloj de reproducción (el centro
// pausa y reanuda) para que el partido siga sincronizado.
import type { Announcement } from '../../match-centre/announcements/announcements';
import type { EventView } from '../../match-centre/session';

export type CutInKind = 'goal' | 'save' | 'miss' | 'tackle';
export type CutIn = Readonly<{
  id: string; kind: CutInKind; atMs: number; side: 'home' | 'away' | null;
  /** Protagonista: goleador, tirador o defensa que roba. `null` si el motor no lo grabó (solo el remate final). */
  actorId: string | null;
  /** Portero que para (solo `save`, si se grabó). */
  keeperId: string | null;
}>;
export type AnimeScenes = 'all' | 'goals' | 'none';

/** Duración en tiempo real (ms) por tipo; con movimiento reducido, una tarjeta fija más corta. */
export const CUT_IN_MS: Readonly<Record<CutInKind, number>> = { goal: 2400, save: 2200, miss: 1800, tackle: 1600 };
export const REDUCED_MOTION_MS = 1200;
export const cutInDuration = (kind: CutInKind, reducedMotion: boolean) => reducedMotion ? REDUCED_MOTION_MS : CUT_IN_MS[kind];
/** Por encima de 5× solo goles; por encima de 20× ninguna. */
export const GOALS_ONLY_ABOVE_SPEED = 5;
export const NONE_ABOVE_SPEED = 20;
const PRIORITY: Readonly<Record<CutInKind, number>> = { goal: 4, save: 3, miss: 2, tackle: 1 };

const DUEL_WON = new Set(['Won', 'Success', 'Success In Play', 'Success Out']);
const obj = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const name = (v: unknown) => { const n = obj(v).name; return typeof n === 'string' ? n : null; };

/** Entrada que gana el balón, solo si el evento lo dice: TimePitch `tackle`/`won_ball`, StatsBomb `Duel` de tipo
 *  `Tackle` con resultado ganado, motores grabados con cambio de posesión cuyo nativo es una entrada. */
export function isWinningTackle(e: EventView): boolean {
  if (e.kind === 'tackle') return e.outcome === 'won_ball';
  if (e.kind === 'Duel') { const duel = obj(e.details.duel); return name(duel.type) === 'Tackle' && DUEL_WON.has(name(duel.outcome) ?? e.outcome ?? ''); }
  if (e.kind === 'possession_change') return typeof e.details.native === 'string' && /tackl/i.test(e.details.native);
  return false;
}

/**
 * Fuentes de escena. Tiros con resultado grabado y goles salen de los rótulos (ya deduplicados por motor); las
 * entradas, de los eventos crudos. Autogoles y tiros bloqueados no tienen escena: no hay remate propio que
 * dramatizar y un «supertiro» en contra de su equipo sería una burla al jugador real.
 */
export function cutInSources(events: readonly EventView[], announcements: readonly Announcement[], keeperIds: ReadonlySet<string> = new Set()): CutIn[] {
  const out: CutIn[] = [];
  for (const a of announcements) {
    const base = { id: a.id, atMs: a.atMs, side: a.side, actorId: a.primaryPlayerId, keeperId: null };
    if (a.kind === 'goal') out.push({ ...base, kind: 'goal' });
    else if (a.kind === 'shot_saved') out.push({ ...base, kind: 'save', keeperId: a.secondaryPlayerId ?? null });
    else if (a.kind === 'shot_off_target') out.push({ ...base, kind: 'miss' });
  }
  let tackles = 0;
  for (const e of events) if (e.elapsedMs !== null && Number.isFinite(e.elapsedMs) && e.actorId && isWinningTackle(e)) {
    out.push({ id: `tackle:${e.id}`, kind: 'tackle', atMs: e.elapsedMs, side: e.side, actorId: e.actorId, keeperId: null }); tackles++;
  }
  out.push(...derivedShots(events, announcements, keeperIds));
  if (!tackles) out.push(...derivedBallsWon(events, keeperIds));
  return out.sort((x, y) => x.atMs - y.atMs);
}

// ---------- Motores que no graban el desenlace (GRF, open-football) — TP238 ----------
// 24-oct: «GRF debe generar escenas Hane», con los tiros deducidos de la jugada siguiente y «también robos».
// Solo se deduce de lo grabado justo después; si es dudoso (córner, despeje de un defensa, rebote), no hay escena.
// La escena sale en el instante del evento que resuelve (no antes: hasta entonces el desenlace no se conoce).

/** Portero rival que toca el balón hasta 5 s después del tiro: parada. */
export const DERIVED_SAVE_MS = 5000;
/** Saque de puerta, o portero rival que juega tras ≥ 6 s (balón parado): el tiro salió fuera. */
export const DERIVED_WIDE_MS = 6000;
/** Un gol grabado hasta 4 s después del tiro ya tiene su escena. */
const SHOT_GOAL_MS = 4000;
/** Robo: el rival se queda el balón a la siguiente acción, como mucho 4 s después. */
export const DERIVED_WON_MS = 4000;
/** Robos deducidos (incluyen intercepciones): como mucho uno cada 3 min de partido, para no cortar el juego a cada pase
 *  (con 90 s salían ~45 por partido en las grabaciones GRF; con 3 min, ~25, más ~30 tiros fuera, 2–3 paradas y los goles). */
export const DERIVED_WON_GAP_MS = 180000;
const TOUCH = /pass|ball_control|trap|carry|dribble|deflect|^other$/i;
const timed = (e: EventView): e is EventView & { elapsedMs: number } => e.elapsedMs !== null && Number.isFinite(e.elapsedMs);

function derivedShots(events: readonly EventView[], announcements: readonly Announcement[], keepers: ReadonlySet<string>): CutIn[] {
  // Si el motor ya graba el desenlace de los tiros (TimePitch, TouchLines, StatsBomb), no se deduce nada.
  if (announcements.some(a => a.kind === 'shot_saved' || a.kind === 'shot_off_target')) return [];
  const list = events.filter(timed), out: CutIn[] = [];
  list.forEach((shot, i) => {
    if (shot.kind.toLowerCase() !== 'shot' || !shot.actorId || shot.outcome || !shot.side) return;
    const next = list.slice(i + 1).find(e => e.side !== null || e.kind === 'goal');
    if (!next) return;
    const gap = next.elapsedMs - shot.elapsedMs;
    if (list.some(e => e.kind === 'goal' && e.elapsedMs >= shot.elapsedMs && e.elapsedMs - shot.elapsedMs <= SHOT_GOAL_MS)) return;
    const rival = next.side !== null && next.side !== shot.side, keeper = rival && !!next.actorId && keepers.has(next.actorId);
    const base = { id: `derived:${shot.id}`, atMs: next.elapsedMs, side: shot.side, actorId: shot.actorId };
    if (keeper && gap <= DERIVED_SAVE_MS) out.push({ ...base, kind: 'save', keeperId: next.actorId });
    else if (rival && (next.kind === 'goal_kick' || keeper && gap >= DERIVED_WIDE_MS)) out.push({ ...base, kind: 'miss', keeperId: null });
  });
  return out;
}

function derivedBallsWon(events: readonly EventView[], keepers: ReadonlySet<string>): CutIn[] {
  const list = events.filter(timed), out: CutIn[] = [];
  let last = -Infinity;
  for (let i = 1; i < list.length; i++) {
    const before = list[i - 1], won = list[i];
    if (!before.side || !won.side || before.side === won.side || !won.actorId || keepers.has(won.actorId)) continue;
    if (!TOUCH.test(before.kind) || !TOUCH.test(won.kind) || won.elapsedMs - before.elapsedMs > DERIVED_WON_MS) continue;
    if (won.elapsedMs - last < DERIVED_WON_GAP_MS) continue;
    last = won.elapsedMs;
    out.push({ id: `derived-won:${won.id}`, kind: 'tackle', atMs: won.elapsedMs, side: won.side, actorId: won.actorId, keeperId: null });
  }
  return out;
}

/** Tipos permitidos según el ajuste y la velocidad de reproducción. */
export function allowedKinds(scenes: AnimeScenes, speed: number): ReadonlySet<CutInKind> {
  if (scenes === 'none' || speed > NONE_ABOVE_SPEED) return new Set();
  if (scenes === 'goals' || speed > GOALS_ONLY_ABOVE_SPEED) return new Set(['goal']);
  return new Set(['goal', 'save', 'miss', 'tackle']);
}

export type Showing = Readonly<{ cut: CutIn; startedWallMs: number; durationMs: number; reducedMotion: boolean;
  /** Ya se vio la reproducción en pausa tras empezar (la pausa la pide el centro al empezar). */
  pausedSeen: boolean }>;
export type CutInState = Readonly<{ cursorMs: number | null; seekToken: number; settling: boolean; showing: Showing | null }>;
export const initialCutInState = (): CutInState => ({ cursorMs: null, seekToken: 0, settling: false, showing: null });
export type CutInInput = Readonly<{
  cursorMs: number; wallMs: number; speed: number; playing: boolean; seekToken: number; seeking: boolean;
  scenes: AnimeScenes; reducedMotion: boolean;
}>;
/**
 * Resultado de un paso: `start` → el centro pausa el reloj y muestra la escena; `end` → la quita y, si `resume`,
 * vuelve a reproducir. Así el reloj no avanza durante la escena y el partido sigue donde estaba.
 */
export type CutInStep = Readonly<{ state: CutInState; start?: CutIn; end?: Readonly<{ resume: boolean; reason: 'done' | 'skip' | 'seek' | 'played' | 'disabled' }> }>;

export function stepCutIns(state: CutInState, sources: readonly CutIn[], input: CutInInput): CutInStep {
  const { cursorMs, wallMs, speed, playing, seekToken, seeking, scenes, reducedMotion } = input;
  const showing = state.showing;
  if (showing) {
    // Búsqueda del usuario durante la escena: se quita sin reanudar (manda la búsqueda).
    if (seeking || seekToken !== state.seekToken) return { state: { cursorMs: null, seekToken, settling: !seeking, showing: null }, end: { resume: false, reason: 'seek' } };
    // El usuario volvió a reproducir (tras haberse visto la pausa): se quita sin reanudar otra vez.
    if (playing && showing.pausedSeen) return { state: { ...state, cursorMs, showing: null }, end: { resume: false, reason: 'played' } };
    if (allowedKinds(scenes, speed).size === 0 || !allowedKinds(scenes, speed).has(showing.cut.kind))
      return { state: { ...state, cursorMs, showing: null }, end: { resume: true, reason: 'disabled' } };
    if (wallMs - showing.startedWallMs >= showing.durationMs) return { state: { ...state, cursorMs, showing: null }, end: { resume: true, reason: 'done' } };
    return { state: { ...state, showing: !playing && !showing.pausedSeen ? { ...showing, pausedSeen: true } : showing } };
  }
  if (seeking) return { state: { ...state, cursorMs: null, seekToken, settling: false } };
  const previous = state.cursorMs, reset: CutInState = { ...state, cursorMs, seekToken, settling: false };
  if (seekToken !== state.seekToken) return { state: { ...reset, settling: true } };
  if (previous === cursorMs) return { state: { ...state, seekToken } };
  // Como el sonido (TP231): sin referencia, recién buscado, hacia atrás, en pausa o con un salto grande, se recoloca.
  if (previous === null || state.settling || cursorMs < previous || !playing) return { state: reset };
  if (cursorMs - previous > Math.max(1500, speed * 1500)) return { state: reset };
  const allowed = allowedKinds(scenes, speed);
  let best: CutIn | null = null;
  for (const s of sources) if (s.atMs > previous && s.atMs <= cursorMs && allowed.has(s.kind) && (s.actorId || s.kind === 'goal'))
    if (!best || PRIORITY[s.kind] > PRIORITY[best.kind] || PRIORITY[s.kind] === PRIORITY[best.kind] && s.atMs >= best.atMs) best = s;
  if (!best) return { state: reset };
  return { state: { ...reset, showing: { cut: best, startedWallMs: wallMs, durationMs: cutInDuration(best.kind, reducedMotion), reducedMotion, pausedSeen: false } }, start: best };
}

/** Saltar la escena (clic o tecla): se quita y se reanuda. */
export function skipCutIn(state: CutInState): CutInStep {
  return state.showing ? { state: { ...state, showing: null }, end: { resume: true, reason: 'skip' } } : { state };
}
