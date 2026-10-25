// Sesión de reproducción para cualquier pista grabada (GRF, TouchLines, open-football). Produce los mismos
// `SceneFrame`/`MotionInterval` que el resto de adaptadores; el renderizador no sabe qué motor la generó.
import type { SceneFrame, VisualCue } from '../../match/retroScene';
import { cursorAt, type EventView, type MatchSource, type MotionInterval, type PanelData, type PlayerView, type SessionSnapshot } from '../session';
import { available, blankSnapshot, clamp, descriptor, detail, emptyPanel, ns } from './base';
import { savedSession } from './saved';
import { fail, type RecordedPlayer, type RecordedTrack, type Side, type XY } from './recorded-track';
import { alignRecordedEvent, type RecordedEvent, type RecordedEventKind, type RecordedEvents } from './recorded-events';

/** Familia propia (G17): minutos por reloj de partido, procedencia simulada; el motor real va en
 *  `descriptor.metadata.engine` y en el id de sesión. Sin crónicas (el backend no conoce estas grabaciones).
 *  Sin sidecar: gol, descanso y final. Con sidecar `recorded-events-1` (TP202): además lo que el motor grabó. */
export const RECORDED_SESSION_SOURCE: MatchSource = 'recorded';
/** Acontecimientos del sidecar que entran en la sesión. Pases y cambios de posesión (cientos) se quedan en el
 *  sidecar para estadísticas; gol, descanso y final ya salen de las muestras; `shot_on_target` repite el tiro. */
const SESSION_KINDS: ReadonlySet<RecordedEventKind> = new Set<RecordedEventKind>(['kickoff', 'shot', 'save', 'foul', 'card_yellow', 'card_red',
  'offside', 'corner', 'free_kick', 'throw_in', 'penalty', 'substitution']);
/** Margen para casar un gol del sidecar con el cambio de marcador de las muestras. */
const GOAL_MATCH_SAMPLES = 10;

const point = (xy: XY) => ({ x: (xy[0] + 1) * 52.5, y: (xy[1] + .42) * 68 / .84 });
const metres = (a: XY, b: XY) => Math.hypot((a[0] - b[0]) * 52.5, (a[1] - b[1]) * 68 / .84);

export function createRecordedSession(id: string, track: RecordedTrack, recorded: RecordedEvents | null = null) {
  if (recorded && (recorded.engine !== track.engine || recorded.traceHash !== track.traceHash))
    fail('identity_mismatch', `events sidecar of ${recorded.engine} ${recorded.traceHash.slice(0, 8)} is not this recording`);
  const key = (p: RecordedPlayer) => ns(track.engine, p.id);
  const sidecar = (recorded?.events ?? []).map(e => alignRecordedEvent(e, track));
  const bySlot = new Map(track.players.map(p => [`${p.side}:${p.slot}`, p]));
  const actorOf = (e: RecordedEvent) => e.side && e.slot !== null ? bySlot.get(`${e.side}:${e.slot}`) ?? null : null;
  const d = descriptor({ source: RECORDED_SESSION_SOURCE, id, revision: track.traceHash },
    { id: track.home.key, name: track.home.name }, { id: track.away.key, name: track.away.name }, track.durationMs, null);
  for (const side of ['home', 'away'] as const) {
    const year = Number(track[side].key.split(':')[1]);
    d[side] = { ...d[side], ...(track[side].formation ? { formation: track[side].formation! } : {}),
      ...(d[side].crestUrl && Number.isInteger(year) ? { season: `${year}/${String(year + 1).slice(-2)}` } : {}) };
  }
  d.periods = track.periodStarts.map((p, k) => {
    const startMs = p.index * track.intervalMs, end = k + 1 < track.periodStarts.length ? track.periodStarts[k + 1].index * track.intervalMs : track.durationMs;
    return { period: p.period, startMs, durationMs: end - startMs };
  });
  d.metadata = { schema: track.schemaVersion, engine: track.engine, engineVersion: track.engineVersion, hash: track.traceHash, seed: track.seed,
    dataset: track.datasetVersion, native: track.nativeBinarySha256, synthetic: true, notice: track.notice, units: track.units,
    upstream: track.upstream, clockBasis: 'recorded_physical', completed: true, limits: 'synthetic free-play recording; not historical tracking' };

  function frame(index: number): SceneFrame {
    const s = track.sample(index), owner = s.owner ? bySlot.get(`${s.owner.side}:${s.owner.slot}`) : null;
    const ball = s.ballZ === null ? point(s.ball) : { ...point(s.ball), z: s.ballZ };
    const active = (p: RecordedPlayer) => (p.side === 'home' ? s.homeActive : s.awayActive)?.[p.slot] !== false;
    return { clock_ms: index * track.intervalMs, period: s.period, score: { home: s.score[0], away: s.score[1] },
      possession: s.owner?.side ?? null, carrier: owner ? key(owner) : null, ball,
      players: track.players.filter(active).map(p => ({ ...point((p.side === 'home' ? s.home : s.away)[p.slot]), key: key(p), name: p.name, role: p.role, side: p.side })) };
  }
  function interval(time: number): MotionInterval {
    const i = Math.min(track.sampleCount - 1, Math.floor(time / track.intervalMs)), last = i === track.sampleCount - 1;
    const a = track.sample(i), b = last ? null : track.sample(i + 1);
    const same = !!b && a.period === b.period && a.mode === b.mode && a.score[0] === b.score[0] && a.score[1] === b.score[1];
    const live = same && a.home.every((p, j) => metres(p, b!.home[j]) <= 3) && a.away.every((p, j) => metres(p, b!.away[j]) <= 3) && metres(a.ball, b!.ball) <= 10;
    const before = frame(i), after = b ? frame(i + 1) : null;
    return { fromMs: i * track.intervalMs, toMs: b ? (i + 1) * track.intervalMs : track.durationMs, before, after,
      continuousPlayers: new Set(live ? before.players.filter(p => after?.players.some(q => q.key === p.key)).map(p => p.key) : []), continuousBall: live };
  }

  const events: EventView[] = [];
  // Autor del gol: el del perfil del motor; si el export no lo trae (GRF), el que grabó su telemetría en el sidecar.
  const sidecarGoals = sidecar.filter(e => e.kind === 'goal' || e.kind === 'own_goal'), usedGoals = new Set<RecordedEvent>();
  track.goals.forEach((g, k) => {
    const s = track.sample(g.sampleIndex);
    const native = sidecarGoals.filter(e => !usedGoals.has(e) && Math.abs(e.sampleIndex - g.sampleIndex) <= GOAL_MATCH_SAMPLES
      && ((e.extra.credited_side as Side | undefined) ?? (e.kind === 'goal' ? e.side : null)) === g.side)
      .sort((a, b) => Math.abs(a.sampleIndex - g.sampleIndex) - Math.abs(b.sampleIndex - g.sampleIndex))[0];
    if (native) usedGoals.add(native);
    const scorer = g.scorer ?? (native ? actorOf(native) : null);
    const own = native?.kind === 'own_goal' || (scorer !== null && scorer.side !== g.side);
    events.push({ id: `${track.engine}:goal:${k}`, sourceIndex: g.sampleIndex, kind: 'goal', period: s.period, periodMs: s.matchMs,
      elapsedMs: g.sampleIndex * track.intervalMs, side: g.side, actorId: scorer ? key(scorer) : null, participantIds: scorer ? [key(scorer)] : [],
      outcome: own ? 'own_goal' : 'goal', provenance: 'native_observed', refs: [String(g.sampleIndex)],
      details: { engine: track.engine, sample_index: g.sampleIndex, score: [...g.score], scorer_native_id: g.scorer?.nativeId ?? null,
        scorer_source: g.scorer ? 'recording' : native && scorer ? 'events_sidecar' : null } });
  });
  // Saque inicial de una parte = primer saque de esa parte sin gol antes en ella (el resto son reanudaciones tras gol).
  const kicked = new Set<number>();
  sidecar.forEach((e, k) => {
    if (!SESSION_KINDS.has(e.kind)) return;
    const actor = actorOf(e);
    const periodStart = e.kind === 'kickoff' ? !kicked.has(e.period) && !track.goals.some(g => g.sampleIndex <= e.sampleIndex && track.sample(g.sampleIndex).period === e.period) : undefined;
    if (e.kind === 'kickoff') kicked.add(e.period);
    events.push({ id: `${track.engine}:${e.kind}:${k}`, sourceIndex: e.sampleIndex, kind: e.kind, period: e.period, periodMs: e.matchMs, elapsedMs: e.tMs,
      side: e.side, actorId: actor ? key(actor) : null, participantIds: actor ? [key(actor)] : [],
      outcome: typeof e.extra.outcome === 'string' ? e.extra.outcome : null, provenance: 'native_observed', refs: [String(k)],
      details: { ...e.extra, engine: track.engine, native: e.native, sample_index: e.sampleIndex, x: e.x, y: e.y,
        ...(periodStart === undefined ? {} : { period_start: periodStart }) } });
  });
  // TP238: toques fuera de la lista (pases, cambios de posesión), solo para deducir escenas de Capitán Hane.
  const touches: EventView[] = [];
  sidecar.forEach((e, k) => {
    if (SESSION_KINDS.has(e.kind) || e.kind === 'goal' || e.kind === 'own_goal' || e.kind === 'shot_on_target') return;
    const actor = actorOf(e);
    // TP243: el receptor del pase (TouchLines graba su hueco) va segundo, para la narración.
    const to = e.kind === 'pass' && e.side && typeof e.extra.to_slot === 'number' ? bySlot.get(`${e.side}:${e.extra.to_slot}`) ?? null : null;
    touches.push({ id: `${track.engine}:${e.kind}:${k}`, sourceIndex: e.sampleIndex, kind: e.kind, period: e.period, periodMs: e.matchMs, elapsedMs: e.tMs,
      side: e.side, actorId: actor ? key(actor) : null, participantIds: actor ? [key(actor), ...(to ? [key(to)] : [])] : [],
      outcome: typeof e.extra.outcome === 'string' ? e.extra.outcome : null, provenance: 'native_observed', refs: [String(k)],
      details: { ...e.extra, engine: track.engine, native: e.native, sample_index: e.sampleIndex } });
  });
  touches.sort((x, y) => x.elapsedMs! - y.elapsedMs! || x.sourceIndex - y.sourceIndex);
  for (const p of d.periods.slice(1)) events.push({ id: `${track.engine}:halftime:${p.period}`, sourceIndex: (p.startMs ?? 0) / track.intervalMs, kind: 'halftime',
    period: p.period, periodMs: track.sample((p.startMs ?? 0) / track.intervalMs).matchMs, elapsedMs: p.startMs, side: null, actorId: null, participantIds: [],
    outcome: null, provenance: 'native_observed', refs: [], details: { engine: track.engine } });
  events.push({ id: `${track.engine}:fulltime`, sourceIndex: Number.MAX_SAFE_INTEGER, kind: 'fulltime', period: track.sample(track.sampleCount - 1).period,
    periodMs: track.sample(track.sampleCount - 1).matchMs, elapsedMs: track.durationMs, side: null, actorId: null, participantIds: [], outcome: null,
    provenance: 'native_observed', refs: [], details: { engine: track.engine } });
  events.sort((x, y) => x.elapsedMs! - y.elapsedMs! || x.sourceIndex - y.sourceIndex);

  const players: PlayerView[] = track.players.map(p => ({
    id: key(p), name: p.name, side: p.side as Side, sourceRefs: [p.id, p.sourceKey],
    role: { value: p.role, provenance: 'estimated', refs: [] }, jersey: { value: null, provenance: 'unavailable', refs: [] },
    intervals: { value: null, provenance: 'unavailable', refs: [] }, estimatedAttributes: [], metrics: [], availability: available(),
    details: { slot: p.slot, teamKey: track[p.side].key, sourceKey: p.sourceKey, nativeId: p.nativeId, engine: track.engine },
  }));
  const metadata = (): PanelData => ({ ...emptyPanel('recorded_replay_has_no_statistics'), players, playerDetails: players,
    sourceDetails: [detail('versions', { engine: track.engine, engine_version: track.engineVersion, schema: track.schemaVersion, hash: track.traceHash, native: track.nativeBinarySha256, seed: track.seed }),
      detail('units', track.units), detail('synthetic_notice', track.notice), detail('upstream', track.upstream)] });

  function resolve(ms: number): SessionSnapshot {
    const time = clamp(ms, track.durationMs), motion = interval(time), cursor = cursorAt(d, time), s = track.sample(time / track.intervalMs);
    const visible = events.filter(e => e.elapsedMs! <= time);
    const panel = metadata();
    return { ...blankSnapshot(d), requestedCursor: cursor, presentedCursor: cursor, interval: motion, previousInterval: interval(Math.max(0, time - track.intervalMs)),
      events: visible, milestones: visible, touches: touches.filter(e => e.elapsedMs! <= time), cue: recordedCue(visible, time),
      clockMs: s.matchMs, loadState: 'ready', horizonMs: track.durationMs,
      observations: { availability: available(), provenance: 'native_observed', values: { engine: track.engine, sample: Math.floor(time / track.intervalMs), mode: s.mode } },
      facts: { score: { value: motion.before.score, provenance: 'native_observed', refs: [] },
        possession: { value: motion.before.possession, provenance: motion.before.possession ? 'native_observed' : 'unavailable', refs: [] },
        carrierId: { value: motion.before.carrier, provenance: motion.before.carrier ? 'native_observed' : 'unavailable', refs: [] } },
      panels: { players: panel, data: panel } };
  }
  return savedSession<null>({ descriptor: d, resolve, dataset: track.datasetVersion, metadata,
    statisticsAt: () => null, readStatistics: async () => null, normalize: () => metadata() });
}

/** Cuánto tiempo (ms) ilustra el campo cada acontecimiento grabado (TP222). El tiro dura hasta que llega el siguiente
 *  acontecimiento o pasa su ventana: así el portero puede estirarse cuando el balón grabado le llega, no en el gol. */
export const RECORDED_CUE_MS: Readonly<Partial<Record<string, number>>> = Object.freeze({
  goal: 900, card_yellow: 2500, card_red: 2500, offside: 1400, foul: 1200, throw_in: 650, save: 800, shot: 1500,
  kickoff: 1600, halftime: 1600, fulltime: 1600,
});
const CUE_TYPE: Readonly<Record<string, VisualCue['type']>> = { goal: 'goal', card_yellow: 'card', card_red: 'card', offside: 'offside',
  foul: 'foul', throw_in: 'restart', save: 'save', shot: 'shot', kickoff: 'kickoff', halftime: 'halftime', fulltime: 'fulltime' };

/**
 * Evento que el gráfico ilustra en `time`: el gol, mientras dure su ventana; si no, el último acontecimiento grabado
 * ilustrable, si su ventana sigue abierta (uno anterior no reaparece). Nunca crea eventos: solo elige entre los grabados.
 */
export function recordedCue(visible: readonly EventView[], time: number): VisualCue | undefined {
  const age = (e: EventView) => time - e.elapsedMs!;
  const goal = visible.filter(e => e.kind === 'goal' && e.actorId && e.elapsedMs !== null && age(e) < RECORDED_CUE_MS.goal!).at(-1);
  const last = goal ?? visible.filter(e => e.elapsedMs !== null && CUE_TYPE[e.kind] && age(e) >= 0).at(-1);
  if (!last || !(age(last) < (RECORDED_CUE_MS[last.kind] ?? 0))) return undefined;
  const type = CUE_TYPE[last.kind];
  // Gol, tarjeta, falta, tiro, parada y saque necesitan protagonista; los pitidos de parte no.
  if (!last.actorId && !['kickoff', 'halftime', 'fulltime', 'offside'].includes(type)) return undefined;
  const x = last.details.x, y = last.details.y;
  const at = typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y) ? point([x, y]) : null;
  return { type, participants: last.actorId ? [last.actorId] : [], side: last.side, t1_ms: last.elapsedMs!, at,
    ...(type === 'card' ? { card: last.kind === 'card_red' ? 'red' as const : 'yellow' as const } : {}) };
}
