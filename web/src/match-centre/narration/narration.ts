// TP241 (24-oct: «tú debes decir: tal persona hace un pase de 30 metros, tal persona marca un gol»): narración
// del partido simulado en frases llanas, sacadas solo de lo que el motor grabó. Nada se inventa: si el motor no dice el
// desenlace de un tiro (GRF), se deduce de la jugada siguiente como las escenas de TP238, y si es dudoso no hay frase.
// No se narra cada toque (TimePitch graba ~1300 por partido): pases largos, conducciones largas, robos, tiros, paradas,
// goles, balón parado y los hitos del partido.
import type { EventView } from '../session';
import { defineTexts, type Locale } from '../../i18n-catalog';

export type NarrationKind = 'goal' | 'own_goal' | 'save' | 'miss' | 'shot' | 'pass' | 'carry' | 'won' | 'set_piece' | 'offside' | 'mark';
export type NarrationLine = Readonly<{ id: string; atMs: number; source: EventView; kind: NarrationKind; side: 'home' | 'away' | null;
  actorId: string | null; text: string }>;
export type NarrationContext = Readonly<{
  locale: Locale;
  name: (id: string | null) => string | null;
  teams: Readonly<Record<'home' | 'away', string>>;
  /** Porteros: deciden si quien toca tras un tiro de GRF lo ha parado. */
  keepers: ReadonlySet<string>;
}>;

/** Pase largo: desde 25 m. */
export const LONG_PASS_M = 25;
/** Conducción larga: desde 20 m. */
export const LONG_CARRY_M = 20;
/** GRF: el pase lo recibe quien toca después, como mucho 6 s; un robo, si el rival toca la siguiente, como mucho 4 s. */
const RECEIVE_MS = 6000, WON_MS = 4000;
/** GRF: robos deducidos, como mucho uno cada 30 s de partido (hay muchos rebotes y despejes). */
const WON_GAP_MS = 30000;
/** Tiro de GRF: portero rival antes de 5 s, parada; saque de puerta o portero tras ≥ 6 s, fuera (TP238). */
const SAVE_MS = 5000, WIDE_MS = 6000, GOAL_MS = 4000;
/** GRF: la falta que sigue a un fuera de juego (hasta 15 s) es su sanción, no otra jugada. */
const OFFSIDE_FK_MS = 15000;
/** TouchLines (TP243): un pase que el rival recupera en ≤ 3 s no se narra como pase; recuperaciones, una cada 20 s. */
const TL_LOST_MS = 3000, TL_WON_GAP_MS = 20000;

const TEXT = defineTexts('narration', {
  es: {
    kickoff: (t: string) => `Empieza el partido. Saca el ${t}.`, start: (h: string, a: string) => `Empieza el partido: ${h} contra ${a}.`,
    secondHalf: 'Empieza la segunda parte.',
    halftime: (s: string) => `Descanso. ${s}.`, fulltime: (s: string) => `¡Final del partido! ${s}.`,
    longPass: (a: string, b: string, m: number) => `${a} pasa en largo a ${b}, ${m} metros.`,
    longPassAttempt: (a: string) => `${a} intenta un pase largo.`,
    highPassAttempt: (a: string) => `${a} intenta un pase elevado.`,
    shotAttempt: (a: string) => `${a} dispara.`,
    lostPass: (a: string, b: string) => `${a} lanza en largo, pero se la queda ${b}.`,
    carry: (a: string, m: number) => `${a} conduce el balón ${m} metros.`,
    won: (a: string, b: string | null) => b ? `${a} le roba el balón a ${b}.` : `${a} recupera el balón.`,
    goal: (a: string, s: string) => `${a} dispara… ¡GOL! ${s}.`,
    ownGoal: (a: string, s: string) => `¡Gol en propia puerta de ${a}! ${s}.`,
    save: (a: string, k: string | null) => k ? `${a} dispara… ¡y para ${k}!` : `${a} dispara… ¡parada del portero!`,
    miss: (a: string) => `${a} dispara… ¡fuera!`,
    corner: (t: string) => `Córner a favor del ${t}.`, freeKick: (t: string) => `Falta a favor del ${t}.`,
    offside: (a: string | null) => a ? `Fuera de juego de ${a}.` : 'Fuera de juego.',
    player: 'un jugador',
  },
  en: {
    kickoff: (t: string) => `We're under way. ${t} kick off.`, start: (h: string, a: string) => `We're under way: ${h} against ${a}.`,
    secondHalf: 'The second half is under way.',
    halftime: (s: string) => `Half-time. ${s}.`, fulltime: (s: string) => `Full-time! ${s}.`,
    longPass: (a: string, b: string, m: number) => `${a} plays a long pass to ${b}, ${m} metres.`,
    longPassAttempt: (a: string) => `${a} attempts a long pass.`,
    highPassAttempt: (a: string) => `${a} attempts a lofted pass.`,
    shotAttempt: (a: string) => `${a} shoots.`,
    lostPass: (a: string, b: string) => `${a} goes long, but ${b} wins it.`,
    carry: (a: string, m: number) => `${a} carries the ball ${m} metres.`,
    won: (a: string, b: string | null) => b ? `${a} wins the ball from ${b}.` : `${a} wins the ball back.`,
    goal: (a: string, s: string) => `${a} shoots… GOAL! ${s}.`,
    ownGoal: (a: string, s: string) => `Own goal by ${a}! ${s}.`,
    save: (a: string, k: string | null) => k ? `${a} shoots… and ${k} saves!` : `${a} shoots… saved by the keeper!`,
    miss: (a: string) => `${a} shoots… wide!`,
    corner: (t: string) => `Corner to ${t}.`, freeKick: (t: string) => `Free kick to ${t}.`,
    offside: (a: string | null) => a ? `${a} is offside.` : 'Offside.',
    player: 'a player',
  },
});

const timed = (e: EventView): e is EventView & { elapsedMs: number } => e.elapsedMs !== null && Number.isFinite(e.elapsedMs);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const pair = (v: unknown): [number, number] | null => Array.isArray(v) && num(v[0]) && num(v[1]) ? [v[0], v[1]] : null;
const isGrf = (e: EventView) => e.details.type === 'touch' || e.details.type === 'decision' || e.details.type === 'goal';
/** Metros entre los extremos de una acción de TimePitch (milímetros canónicos). */
function tpMetres(e: EventView): number | null {
  const a = pair(e.details.origin_mm), b = pair(e.details.end_mm);
  return a && b ? Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 1000) : null;
}
/** Metros entre dos toques de GRF: el campo va de −1 a 1 en largo (105 m) y de −0,42 a 0,42 en ancho (68 m). */
function grfMetres(a: EventView, b: EventView): number | null {
  const p = Array.isArray(a.details.ball_xyz) ? a.details.ball_xyz : null, q = Array.isArray(b.details.ball_xyz) ? b.details.ball_xyz : null;
  if (!p || !q || !num(p[0]) || !num(p[1]) || !num(q[0]) || !num(q[1])) return null;
  return Math.round(Math.hypot((q[0] - p[0]) * 52.5, (q[1] - p[1]) * 34 / 0.42));
}
const GRF_TOUCH = /pass|ball_control|trap|deflect|^other$|^shot$/;

export function narrate(events: readonly EventView[], ctx: NarrationContext): NarrationLine[] {
  const t = TEXT(ctx.locale), list = events.filter(timed).sort((a, b) => a.elapsedMs - b.elapsedMs || a.sourceIndex - b.sourceIndex);
  const who = (id: string | null) => ctx.name(id) ?? t.player;
  const out: NarrationLine[] = [];
  const goals = { home: 0, away: 0 };
  const score = () => `${ctx.teams.home} ${goals.home}–${goals.away} ${ctx.teams.away}`;
  const push = (e: EventView & { elapsedMs: number }, kind: NarrationKind, text: string, atMs = e.elapsedMs, side = e.side, actorId = e.actorId) =>
    out.push({ id: `${kind}:${e.id}`, atMs, source: e, kind, side, actorId, text });
  // Paradas de TimePitch: el evento `save` apunta a su tiro.
  const saver = new Map<string, string | null>();
  for (const e of list) if (e.kind === 'save' && typeof (e.details.evidence as Record<string, unknown> | undefined)?.shot_id === 'string')
    saver.set(String((e.details.evidence as Record<string, unknown>).shot_id), e.actorId);
  let lastWon = -Infinity;
  list.forEach((e, i) => {
    const grf = isGrf(e), recordedGrf = !grf && e.details.engine === 'grf', tl = e.details.engine === 'touchlines', next = (pick: (x: EventView) => boolean) => list.slice(i + 1).find(pick);
    if (e.kind === 'kickoff' && e.side && e.period === 1 && !out.some(l => l.source.kind === 'kickoff')) push(e, 'mark', t.kickoff(ctx.teams[e.side]));
    // Grabaciones: solo el saque que abre la parte (los demás reanudan tras un gol).
    else if (e.kind === 'kickoff' && e.period === 2 && e.details.period_start !== false) push(e, 'mark', t.secondHalf, e.elapsedMs, null, null);
    else if (e.kind === 'halftime') push(e, 'mark', t.halftime(score()), e.elapsedMs, null, null);
    // Una grabación puede traer el final dos veces (sesión y sidecar): se narra una.
    else if ((e.kind === 'fulltime' || e.kind === 'episode_end') && !out.some(l => l.source.kind === 'fulltime' || l.source.kind === 'episode_end'))
      push(e, 'mark', t.fulltime(score()), e.elapsedMs, null, null);
    else if (e.kind === 'goal') {
      const own = e.outcome === 'own_goal';
      // El gol cuenta para el equipo que marca: en propia puerta, el contrario al del jugador.
      // Las grabaciones de motor ya traen el lado acreditado.
      const scorer = e.side ? (own && !grf && typeof e.details.engine !== 'string' ? (e.side === 'home' ? 'away' : 'home') : e.side) : null;
      if (scorer) goals[scorer]++;
      push(e, own ? 'own_goal' : 'goal', own ? t.ownGoal(who(e.actorId), score()) : t.goal(who(e.actorId), score()));
    } else if (recordedGrf && e.kind === 'pass' && e.actorId && (e.details.subtype === 'long_pass' || e.details.subtype === 'high_pass')) {
      // Saved sidecars record the attempt, not its recipient, distance or completion.
      push(e, 'pass', (e.details.subtype === 'long_pass' ? t.longPassAttempt : t.highPassAttempt)(who(e.actorId)));
    } else if (recordedGrf && e.kind === 'shot' && e.actorId) {
      push(e, 'shot', t.shotAttempt(who(e.actorId)));
    } else if (tl && e.kind === 'shot' && e.actorId) {
      // TouchLines graba el desenlace del tiro; la parada la hace el portero del evento `save` que lo resuelve.
      const at = num(e.details.resolved_t_ms) ? e.details.resolved_t_ms : e.elapsedMs;
      const save = list.find(x => x.kind === 'save' && x.elapsedMs! >= e.elapsedMs && x.elapsedMs! <= at + 100);
      if (e.outcome === 'saved') push(e, 'save', t.save(who(e.actorId), ctx.name(save?.actorId ?? null)), at);
      else if (e.outcome === 'off_target') push(e, 'miss', t.miss(who(e.actorId)), at);
    } else if (tl && e.kind === 'pass' && e.side && e.actorId) {
      // Pase largo de TouchLines (yardas → metros) a su receptor, salvo que el rival recupere justo después.
      const m = num(e.details.distance_yd) ? Math.round(e.details.distance_yd * 0.9144) : null, to = e.participantIds[1] ?? null;
      const lost = list.slice(i + 1).some(x => x.kind === 'possession_change' && x.side !== e.side && x.elapsedMs! - e.elapsedMs <= TL_LOST_MS);
      // TouchLines a veces apunta el pase al propio pasador (balón al espacio): sin receptor no hay frase.
      if (m !== null && m >= LONG_PASS_M && to && to !== e.actorId && !lost) push(e, 'pass', t.longPass(who(e.actorId), who(to), m));
    } else if (tl && e.kind === 'possession_change' && e.actorId && e.elapsedMs - lastWon >= TL_WON_GAP_MS) {
      lastWon = e.elapsedMs; push(e, 'won', t.won(who(e.actorId), null));
    } else if (tl && (e.kind === 'corner' || e.kind === 'free_kick') && e.side
      && !(e.kind === 'free_kick' && list.slice(Math.max(0, i - 3), i).some(x => x.kind === 'offside' && e.elapsedMs - x.elapsedMs! <= OFFSIDE_FK_MS)))
      push(e, 'set_piece', e.kind === 'corner' ? t.corner(ctx.teams[e.side]) : t.freeKick(ctx.teams[e.side]));
    else if (tl && e.kind === 'offside') push(e, 'offside', t.offside(ctx.name(e.actorId)), e.elapsedMs, null);
    else if (e.kind === 'shot' && !grf && !tl) {
      // TimePitch: el tiro trae su resultado; el gol lo narra su propio evento `goal`.
      if (e.outcome === 'saved') push(e, 'save', t.save(who(e.actorId), ctx.name(saver.get(String(e.details.id)) ?? null)));
      else if (e.outcome === 'off_target') push(e, 'miss', t.miss(who(e.actorId)));
    } else if (e.kind === 'shot' && grf && e.side && e.actorId) {
      const after = next(x => x.side !== null || x.kind === 'goal');
      if (!after || !timed(after) || list.some(x => x.kind === 'goal' && x.elapsedMs! >= e.elapsedMs && x.elapsedMs! - e.elapsedMs <= GOAL_MS)) return;
      const gap = after.elapsedMs - e.elapsedMs, rival = after.side !== null && after.side !== e.side;
      const keeper = rival && !!after.actorId && ctx.keepers.has(after.actorId);
      if (keeper && gap <= SAVE_MS) push(e, 'save', t.save(who(e.actorId), ctx.name(after.actorId)), after.elapsedMs);
      else if (rival && (after.kind === 'goal_kick' || keeper && gap >= WIDE_MS)) push(e, 'miss', t.miss(who(e.actorId)), after.elapsedMs);
    } else if (e.kind === 'pass' && !grf && !tl) {
      const m = tpMetres(e), to = e.participantIds[1] ?? null;
      if (e.outcome === 'complete' && m !== null && m >= LONG_PASS_M && to) push(e, 'pass', t.longPass(who(e.actorId), who(to), m));
    } else if ((e.kind === 'long_pass' || e.kind === 'high_pass') && grf && e.side && e.actorId) {
      const after = next(x => x.side !== null && GRF_TOUCH.test(x.kind));
      if (!after || !timed(after) || !after.actorId || after.elapsedMs - e.elapsedMs > RECEIVE_MS || after.actorId === e.actorId) return;
      const m = grfMetres(e, after);
      if (after.side === e.side) { if (m !== null && m >= LONG_PASS_M) push(e, 'pass', t.longPass(who(e.actorId), who(after.actorId), m), after.elapsedMs); }
      else if (!ctx.keepers.has(after.actorId) && after.elapsedMs - lastWon >= WON_GAP_MS) {
        lastWon = after.elapsedMs; push(e, 'won', t.lostPass(who(e.actorId), who(after.actorId)), after.elapsedMs, after.side, after.actorId);
      }
    } else if (e.kind === 'carry' && !grf) {
      const m = tpMetres(e);
      if (e.outcome === 'complete' && m !== null && m >= LONG_CARRY_M) push(e, 'carry', t.carry(who(e.actorId), m));
    } else if (e.kind === 'tackle' && e.outcome === 'won_ball') push(e, 'won', t.won(who(e.actorId), ctx.name(e.participantIds[1] ?? null)));
    else if (grf && GRF_TOUCH.test(e.kind) && e.side && e.actorId && !ctx.keepers.has(e.actorId) && e.kind !== 'shot') {
      // GRF no graba entradas: robo = el rival toca justo después de un toque (no de un pase largo: ya se narró arriba).
      const before = list[i - 1];
      if (!before || !timed(before) || !before.side || before.side === e.side || !GRF_TOUCH.test(before.kind) || /long_pass|high_pass|shot/.test(before.kind)) return;
      if (e.elapsedMs - before.elapsedMs > WON_MS || e.elapsedMs - lastWon < WON_GAP_MS) return;
      lastWon = e.elapsedMs; push(e, 'won', t.won(who(e.actorId), ctx.name(before.actorId)));
    } else if ((grf || recordedGrf) && e.kind === 'corner' && e.side) push(e, 'set_piece', t.corner(ctx.teams[e.side]));
    // El fuera de juego se sanciona con falta: GRF graba las dos decisiones; se narra solo el fuera de juego.
    else if ((grf || recordedGrf) && e.kind === 'free_kick' && e.side && !list.slice(Math.max(0, i - 3), i).some(x => x.kind === 'offside' && e.elapsedMs - x.elapsedMs! <= OFFSIDE_FK_MS))
      push(e, 'set_piece', t.freeKick(ctx.teams[e.side]));
    else if ((grf || recordedGrf) && e.kind === 'offside') push(e, 'offside', t.offside(ctx.name(e.actorId)), e.elapsedMs, null);
  });
  // GRF solo graba el saque de la segunda parte: el arranque se narra igual, sin decir quién saca.
  if (list.length && !out.some(l => l.source.kind === 'kickoff' && l.source.period === 1)) {
    const first = list[0], source: EventView = { ...first, id: 'narration:start', kind: 'kickoff', period: 1, periodMs: 0, elapsedMs: 0, side: null, actorId: null, participantIds: [] };
    out.push({ id: 'mark:narration:start', atMs: 0, source, kind: 'mark', side: null, actorId: null, text: t.start(ctx.teams.home, ctx.teams.away) });
  }
  return out.sort((a, b) => a.atMs - b.atMs);
}
