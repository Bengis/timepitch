// Análisis determinista de un partido grabado (TP203). Solo usa lo que el motor grabó: posiciones de las muestras
// (siempre) y acontecimientos de la sesión/sidecar (cuando existen). Nada se infiere de un evento que el motor no
// escribió: lo que un motor no graba sale `null` ("no grabado"), nunca 0. Todo es simulado (motor + atributos estimados).
//
// Reglas documentadas:
// - Posesión: dueño del balón grabado en la muestra (`owner_team/owner_slot`); con el balón suelto cuenta para el último
//   dueño. Si el motor no graba dueño en ninguna muestra: el jugador activo más cercano a ≤ 2 m del balón.
// - Dirección de ataque: por parte, el local defiende el lado donde está la media x de su portero.
// - Marco de ataque: cada equipo ataca hacia x = 105 (se gira 180° la mitad que ataca hacia x < 0); campo 105 × 68.
// - Distancia: suma de desplazamientos por segundo (muestras cada 10) en metros del motor (`metresPerUnit`), solo con el
//   jugador activo en ambos extremos y dentro de la misma parte; > 12 m en 1 s es una recolocación y no cuenta.
// - Alta intensidad: los segundos con desplazamiento ≥ 5,5 m/s (19,8 km/h).
// - Territorio: tiempo con el balón en campo rival de cada equipo. Inclinación (field tilt): con posesión, tiempo en el
//   último tercio de cada equipo sobre el total de ambos.
// - Forma: ancho (y) y profundidad (x) medios del bloque de jugadores de campo activos, con y sin balón.
import type { EventView } from '../session';
import type { RecordedEngineId, RecordedTrack, Side, XY } from '../adapters/recorded-track';
import { alignRecordedEvent, type RecordedEvent } from '../adapters/recorded-events';
import { ns } from '../adapters/base';

export const HSR_MPS = 5.5;
export const RELOCATION_M = 12;
export const NEAREST_M = 2;
export const MOMENTUM_WINDOW_MS = 300000;
export const HEAT_COLS = 12, HEAT_ROWS = 8;
const PITCH = { x: 105, y: 68 };

/** Qué estadísticas de acontecimientos puede grabar cada motor (TP202). `false` = el motor no lo escribe: «no grabado». */
export const RECORDED_STAT_CAPABILITIES: Readonly<Record<RecordedEngineId, Readonly<{
  onTarget: boolean; saves: boolean; xg: boolean; fouls: boolean; corners: boolean; cards: boolean; passNetwork: boolean;
}>>> = {
  // GRF: tiros sin desenlace, decisiones del árbitro (falta, córner, fuera de juego); pases sin receptor.
  grf: { onTarget: false, saves: false, xg: false, fouls: true, corners: true, cards: false, passNetwork: false },
  // TouchLines: shotResolved (gol/parada/fuera) con xG propio, córner por game_mode, pases con receptor; sin faltas.
  touchlines: { onTarget: true, saves: true, xg: true, fouls: false, corners: true, cards: false, passNetwork: true },
  // open-football: tiros sin desenlace, CommitFoul, PassTo con receptor; tarjetas decididas pero no escritas; sin córners.
  'open-football': { onTarget: false, saves: false, xg: false, fouls: true, corners: false, cards: false, passNetwork: true },
};

export type PossessionBasis = 'recorded_owner' | 'nearest_player';
export type Shape = { width: number; depth: number } | null;
export type TeamAnalysis = {
  goals: number; shots: number; shotsOnTarget: number | null; saves: number | null; xg: number | null;
  fouls: number | null; offsides: number; corners: number | null; cards: null; passes: number;
  distanceM: number; hsrM: number; shape: { all: Shape; inPossession: Shape; outOfPossession: Shape };
};
export type PlayerAnalysis = {
  id: string; side: Side; slot: number; name: string; role: string;
  goals: number; shots: number; shotsOnTarget: number | null; xg: number | null; passes: number;
  distanceM: number; hsrM: number; seconds: number;
  /** Posición media en el marco de ataque (m); `null` si no ha estado activo. */
  average: { x: number; y: number } | null;
  /** Segundos por celda, HEAT_COLS × HEAT_ROWS, filas de arriba abajo; marco de ataque. */
  heat: number[];
};
export type ShotPoint = { id: string; atMs: number; side: Side; playerId: string | null; x: number; y: number; outcome: string | null; xg: number | null };
export type MomentumWindow = { period: number; fromMs: number; toMs: number; label: string; possessionHome: number | null;
  shots: Record<Side, number>; xg: Record<Side, number> | null };
export type PassNetwork = Record<Side, { nodes: { id: string; x: number; y: number; passes: number }[]; edges: { from: string; to: string; count: number }[] }>;
export type MatchAnalysis = {
  engine: RecordedEngineId; untilMs: number; seconds: number;
  possession: { home: number | null; away: number | null; basis: PossessionBasis };
  territory: { home: number | null; away: number | null }; fieldTilt: { home: number | null; away: number | null };
  teams: Record<Side, TeamAnalysis>; players: PlayerAnalysis[]; shots: ShotPoint[]; momentum: MomentumWindow[];
  passNetwork: PassNetwork | null;
  capabilities: typeof RECORDED_STAT_CAPABILITIES[RecordedEngineId];
};
export type RecordedAnalysisInput = { track: RecordedTrack; events: readonly EventView[]; passes: readonly RecordedEvent[] };

const SIDES: readonly Side[] = ['home', 'away'];

/** Precálculo único por grabación (una pasada a 10 Hz y otra a 1 Hz); `analyseUntil` solo agrega hasta el cursor. */
export function prepareRecordedAnalysis(input: RecordedAnalysisInput) {
  const { track } = input, mpu = track.units.metresPerUnit, n = track.sampleCount, P = track.players.length;
  const key = (side: Side, slot: number) => ns(track.engine, `${side}:${slot}`);
  const playerKeys = track.players.map(p => ns(track.engine, p.id));
  const bySlot = new Map(track.players.map((p, k) => [`${p.side}:${p.slot}`, k]));

  // Dirección de ataque del local por parte: +1 si ataca hacia x>0.
  const gk = track.players.find(p => p.side === 'home' && p.role === 'GK') ?? track.players.find(p => p.side === 'home');
  const homeDir = new Map<number, 1 | -1>();
  track.periodStarts.forEach((ps, k) => {
    const end = k + 1 < track.periodStarts.length ? track.periodStarts[k + 1].index : n;
    let sum = 0, count = 0;
    for (let i = ps.index; i < Math.min(end, n); i += 10) { const s = track.sample(i); if (gk) { sum += s.home[gk.slot][0]; count++; } }
    const prev = homeDir.get(track.periodStarts[k - 1]?.period ?? -1);
    homeDir.set(ps.period, count ? (sum / count <= 0 ? 1 : -1) : prev ? (prev === 1 ? -1 : 1) : 1);
  });
  const dirOf = (side: Side, period: number) => { const h = homeDir.get(period) ?? 1; return side === 'home' ? h : (h === 1 ? -1 : 1); };
  /** Unidades normalizadas → metros en el marco de ataque del equipo (ataca hacia x = 105). */
  const attackFrame = (xy: XY | readonly number[], side: Side, period: number) => {
    const d = dirOf(side, period);
    return { x: Math.max(0, Math.min(PITCH.x, (d * xy[0] + 1) * PITCH.x / 2)), y: Math.max(0, Math.min(PITCH.y, (d * xy[1] + .42) * PITCH.y / .84)) };
  };
  const metres = (a: XY, b: XY) => Math.hypot((a[0] - b[0]) * mpu.x, (a[1] - b[1]) * mpu.y);

  // Pasada a 10 Hz: posesión y zona del balón como sumas acumuladas por muestra (cum[i] = muestras 0..i-1).
  const secs = Math.floor((n - 1) / 10) + 1;
  const posH = new Uint32Array(n + 1), posA = new Uint32Array(n + 1), halfH = new Uint32Array(n + 1), halfA = new Uint32Array(n + 1);
  const tiltH = new Uint32Array(n + 1), tiltA = new Uint32Array(n + 1);
  let basis: PossessionBasis = 'recorded_owner', anyOwner = false;
  for (let i = 0; i < n && !anyOwner; i += 1) if (track.sample(i).owner) anyOwner = true;
  if (!anyOwner) basis = 'nearest_player';
  let last: Side | null = null;
  for (let i = 0; i < n; i++) {
    const s = track.sample(i);
    let owner: Side | null = s.owner?.side ?? null;
    if (!anyOwner) {
      let best = NEAREST_M, who: Side | null = null;
      for (const side of SIDES) (side === 'home' ? s.home : s.away).forEach((xy, slot) => {
        if ((side === 'home' ? s.homeActive : s.awayActive)?.[slot] === false) return;
        const d = metres(xy, s.ball); if (d <= best) { best = d; who = side; }
      });
      owner = who;
    }
    if (owner) last = owner;
    const bx = s.ball[0] * dirOf('home', s.period);
    posH[i + 1] = posH[i] + (last === 'home' ? 1 : 0); posA[i + 1] = posA[i] + (last === 'away' ? 1 : 0);
    halfH[i + 1] = halfH[i] + (bx > 0 ? 1 : 0); halfA[i + 1] = halfA[i] + (bx < 0 ? 1 : 0);
    tiltH[i + 1] = tiltH[i] + (last === 'home' && bx > 1 / 3 ? 1 : 0); tiltA[i + 1] = tiltA[i] + (last === 'away' && bx < -1 / 3 ? 1 : 0);
  }
  /** Muestras de `cum` en [from, to) (índices de muestra). */
  const span = (cum: Uint32Array, from: number, to: number) => cum[Math.max(0, Math.min(n, to))] - cum[Math.max(0, Math.min(n, from))];

  // Pasada a 1 Hz: distancia, alta intensidad, posiciones (marco de ataque) y forma.
  const dist = new Float64Array(secs * P), hsr = new Float64Array(secs * P);
  const px = new Float32Array(secs * P).fill(NaN), py = new Float32Array(secs * P).fill(NaN);
  const shapeW = new Float32Array(secs * 2).fill(NaN), shapeD = new Float32Array(secs * 2).fill(NaN);
  let prev: ReturnType<RecordedTrack['sample']> | null = null;
  for (let sec = 0; sec < secs; sec++) {
    const s = track.sample(sec * 10), period = s.period;
    const box = { home: [Infinity, -Infinity, Infinity, -Infinity], away: [Infinity, -Infinity, Infinity, -Infinity] };
    track.players.forEach((p, k) => {
      const active = (p.side === 'home' ? s.homeActive : s.awayActive)?.[p.slot] !== false;
      if (!active) return;
      const xy = (p.side === 'home' ? s.home : s.away)[p.slot], f = attackFrame(xy, p.side, period);
      px[sec * P + k] = f.x; py[sec * P + k] = f.y;
      if (p.role !== 'GK') { const b = box[p.side]; b[0] = Math.min(b[0], f.x); b[1] = Math.max(b[1], f.x); b[2] = Math.min(b[2], f.y); b[3] = Math.max(b[3], f.y); }
      if (prev && prev.period === period && (p.side === 'home' ? prev.homeActive : prev.awayActive)?.[p.slot] !== false) {
        const d = metres((p.side === 'home' ? prev.home : prev.away)[p.slot], xy);
        if (d <= RELOCATION_M) { dist[sec * P + k] = d; if (d >= HSR_MPS) hsr[sec * P + k] = d; }
      }
    });
    SIDES.forEach((side, j) => { const b = box[side]; if (b[0] <= b[1]) { shapeD[sec * 2 + j] = b[1] - b[0]; shapeW[sec * 2 + j] = b[3] - b[2]; } });
    prev = s;
  }
  const sideIndex = (k: number) => track.players[k].side;

  const events = [...input.events].filter(e => e.elapsedMs !== null).sort((a, b) => a.elapsedMs! - b.elapsedMs!);
  // Pases crudos del sidecar: se alinean aquí con el inicio de la pista (TP212).
  const passes = input.passes.filter(e => e.kind === 'pass' && e.side !== null).map(e => alignRecordedEvent(e, track)).sort((a, b) => a.tMs - b.tMs);
  return { track, key, playerKeys, bySlot, attackFrame, secs, span, posH, posA, halfH, halfA, tiltH, tiltA,
    dist, hsr, px, py, shapeW, shapeD, sideIndex, events, passes, basis, P };
}
export type RecordedAnalysisModel = ReturnType<typeof prepareRecordedAnalysis>;

const ratio = (a: number, b: number) => a + b > 0 ? a / (a + b) : null;
const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : null;
const ON_TARGET = new Set(['goal', 'saved']);

/** Agregado del partido hasta `untilMs` (incluido): nada posterior al cursor entra en el análisis. */
export function analyseUntil(m: RecordedAnalysisModel, untilMs: number): MatchAnalysis {
  const { track, P } = m, caps = RECORDED_STAT_CAPABILITIES[track.engine];
  const until = Math.max(0, Math.min(untilMs, track.durationMs));
  const lastSec = Math.min(m.secs - 1, Math.floor(until / 1000));
  const end = Math.floor(until / track.intervalMs) + 1;
  const possessionHome = ratio(m.span(m.posH, 0, end), m.span(m.posA, 0, end));
  const territoryHome = ratio(m.span(m.halfH, 0, end), m.span(m.halfA, 0, end)), tiltHome = ratio(m.span(m.tiltH, 0, end), m.span(m.tiltA, 0, end));

  const events = m.events.filter(e => e.elapsedMs! <= until);
  const passes = m.passes.filter(e => e.tMs <= until);
  const playerOf = (id: string | null) => id === null ? -1 : m.playerKeys.indexOf(id);

  const players: PlayerAnalysis[] = track.players.map((p, k) => {
    let distance = 0, high = 0, seconds = 0, sx = 0, sy = 0;
    const heat = Array<number>(HEAT_COLS * HEAT_ROWS).fill(0);
    for (let s = 0; s <= lastSec; s++) {
      distance += m.dist[s * P + k]; high += m.hsr[s * P + k];
      const x = m.px[s * P + k], y = m.py[s * P + k];
      if (Number.isNaN(x)) continue;
      seconds++; sx += x; sy += y;
      heat[Math.min(HEAT_ROWS - 1, Math.floor(y / PITCH.y * HEAT_ROWS)) * HEAT_COLS + Math.min(HEAT_COLS - 1, Math.floor(x / PITCH.x * HEAT_COLS))]++;
    }
    return { id: m.playerKeys[k], side: p.side, slot: p.slot, name: p.name, role: p.role, goals: 0, shots: 0, shotsOnTarget: caps.onTarget ? 0 : null,
      xg: caps.xg ? 0 : null, passes: 0, distanceM: distance, hsrM: high, seconds, average: seconds ? { x: sx / seconds, y: sy / seconds } : null, heat };
  });

  const team = (side: Side): TeamAnalysis => {
    const mine = players.filter(p => p.side === side), j = side === 'home' ? 0 : 1;
    const avg = (pred: (s: number) => boolean): Shape => {
      let w = 0, d = 0, c = 0;
      for (let s = 0; s <= lastSec; s++) { const sw = m.shapeW[s * 2 + j]; if (Number.isNaN(sw) || !pred(s)) continue; w += sw; d += m.shapeD[s * 2 + j]; c++; }
      return c ? { width: w / c, depth: d / c } : null;
    };
    const own = (s: number) => [m.span(m.posH, s * 10, s * 10 + 10), m.span(m.posA, s * 10, s * 10 + 10)];
    const has = (s: number) => { const [h, a] = own(s); return side === 'home' ? h > a : a > h; };
    return { goals: 0, shots: 0, shotsOnTarget: caps.onTarget ? 0 : null, saves: caps.saves ? 0 : null, xg: caps.xg ? 0 : null,
      fouls: caps.fouls ? 0 : null, offsides: 0, corners: caps.corners ? 0 : null, cards: null, passes: 0,
      distanceM: mine.reduce((s, p) => s + p.distanceM, 0), hsrM: mine.reduce((s, p) => s + p.hsrM, 0),
      shape: { all: avg(() => true), inPossession: avg(has), outOfPossession: avg(s => { const [h, a] = own(s); return h + a > 0 && !has(s); }) } };
  };
  const teams: Record<Side, TeamAnalysis> = { home: team('home'), away: team('away') };

  const shots: ShotPoint[] = [];
  for (const e of events) {
    if (!e.side) continue;
    const t = teams[e.side], p = players[playerOf(e.actorId)];
    switch (e.kind) {
      case 'goal': t.goals++; if (p && e.outcome !== 'own_goal' && p.side === e.side) p.goals++; break;
      case 'shot': {
        t.shots++; if (p) p.shots++;
        const xg = caps.xg ? num(e.details.xg) : null, on = e.outcome !== null && ON_TARGET.has(e.outcome);
        if (caps.xg && xg !== null) { t.xg = (t.xg ?? 0) + xg; if (p) p.xg = (p.xg ?? 0) + xg; }
        if (caps.onTarget && on) { t.shotsOnTarget = (t.shotsOnTarget ?? 0) + 1; if (p) p.shotsOnTarget = (p.shotsOnTarget ?? 0) + 1; }
        const x = num(e.details.x), y = num(e.details.y);
        if (x !== null && y !== null) shots.push({ id: e.id, atMs: e.elapsedMs!, side: e.side, playerId: e.actorId, ...m.attackFrame([x, y], e.side, e.period),
          outcome: caps.onTarget ? e.outcome : null, xg });
        break;
      }
      case 'save': if (t.saves !== null) t.saves++; break;
      case 'foul': if (t.fouls !== null) t.fouls++; break;
      case 'offside': t.offsides++; break;
      case 'corner': if (t.corners !== null) t.corners++; break;
    }
  }
  for (const e of passes) { teams[e.side!].passes++; const k = e.slot === null ? undefined : m.bySlot.get(`${e.side}:${e.slot}`); if (k !== undefined) players[k].passes++; }

  // Red de pases: solo con receptor grabado (`to_slot`); nodos en la posición media del marco de ataque.
  let passNetwork: PassNetwork | null = null;
  if (caps.passNetwork) {
    passNetwork = { home: { nodes: [], edges: [] }, away: { nodes: [], edges: [] } };
    for (const side of SIDES) {
      const edges = new Map<string, { from: string; to: string; count: number }>();
      for (const e of passes) {
        const to = num(e.extra.to_slot);
        if (e.side !== side || e.slot === null || to === null || to === e.slot) continue;
        const from = m.key(side, e.slot), dest = m.key(side, to), k = `${from}>${dest}`;
        const edge = edges.get(k) ?? { from, to: dest, count: 0 }; edge.count++; edges.set(k, edge);
      }
      passNetwork[side].edges = [...edges.values()].sort((a, b) => b.count - a.count);
      passNetwork[side].nodes = players.filter(p => p.side === side && p.average).map(p => ({ id: p.id, x: p.average!.x, y: p.average!.y, passes: p.passes }));
    }
  }

  // Momento: ventanas de 5 minutos por parte (reloj de la grabación desde el inicio de cada parte).
  const momentum: MomentumWindow[] = [];
  track.periodStarts.forEach((ps, k) => {
    const startMs = ps.index * track.intervalMs;
    const lastPeriod = k + 1 >= track.periodStarts.length;
    const endMs = lastPeriod ? track.durationMs : track.periodStarts[k + 1].index * track.intervalMs;
    const clock0 = Math.floor(track.sample(ps.index).matchMs / 60000);
    for (let from = startMs; from < endMs && from <= until; from += MOMENTUM_WINDOW_MS) {
      const to = Math.min(endMs, from + MOMENTUM_WINDOW_MS), closes = lastPeriod && to === endMs;
      const inWin = (ms: number) => ms >= from && (ms < to || closes && ms === to) && ms <= until;
      const a0 = from / track.intervalMs, a1 = Math.min(end, to / track.intervalMs + (closes ? 1 : 0));
      const h = m.span(m.posH, a0, a1), a = m.span(m.posA, a0, a1);
      const w = events.filter(e => e.kind === 'shot' && inWin(e.elapsedMs!));
      const minute = clock0 + (from - startMs) / 60000;
      momentum.push({ period: ps.period, fromMs: from, toMs: to, label: `${minute}'–${minute + MOMENTUM_WINDOW_MS / 60000}'`, possessionHome: ratio(h, a),
        shots: { home: w.filter(e => e.side === 'home').length, away: w.filter(e => e.side === 'away').length },
        xg: caps.xg ? { home: w.filter(e => e.side === 'home').reduce((s, e) => s + (num(e.details.xg) ?? 0), 0), away: w.filter(e => e.side === 'away').reduce((s, e) => s + (num(e.details.xg) ?? 0), 0) } : null });
    }
  });

  return { engine: track.engine, untilMs: until, seconds: lastSec + 1,
    possession: { home: possessionHome, away: possessionHome === null ? null : 1 - possessionHome, basis: m.basis },
    territory: { home: territoryHome, away: territoryHome === null ? null : 1 - territoryHome },
    fieldTilt: { home: tiltHome, away: tiltHome === null ? null : 1 - tiltHome },
    teams, players, shots, momentum, passNetwork, capabilities: caps };
}
