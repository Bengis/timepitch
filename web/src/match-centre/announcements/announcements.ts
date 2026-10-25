// Pure, engine-agnostic match action announcements for the Match Centre.
// Input: EventView lists as produced by the historical, TimePitch and GRF adapters.
// Output: an ordered, deduplicated queue plus a pure scheduler for playback and seeking.
import type { EventView, MatchSource } from '../session';

export type AnnouncementKind =
  | 'goal' | 'own_goal' | 'penalty' | 'shot_saved' | 'shot_blocked' | 'shot_off_target'
  | 'yellow' | 'second_yellow' | 'red' | 'substitution' | 'foul' | 'offside' | 'corner'
  | 'half_time' | 'full_time' | 'kick_off';
export type Score = { home: number; away: number };
export type Side = 'home' | 'away';
/**
 * `side` is the team the announcement is about: the credited team for goals and own goals,
 * the offending team for fouls, cards and offsides, the awarded team for penalties and corners,
 * the shooting team for shots and the changing team for substitutions; null for period markers.
 */
export type Announcement = {
  id: string; kind: AnnouncementKind; priority: number; minuteLabel: string; atMs: number;
  side: Side | null; primaryPlayerId: string | null; secondaryPlayerId?: string;
  scoreAfter?: Score; provenance: 'historical' | 'simulated'; durationMs: number;
};
export type BuildOptions = {
  /** Score before the first event in the list. TimePitch/GRF adapters send every event from kick-off,
   *  so 0-0 is the default there; historical windows are partial, so the default is unknown. */
  baseScore?: Score | null;
  /** Last regulation period of a historical match (2, or 4 with extra time). */
  lastPeriod?: number;
};

const ALL: readonly AnnouncementKind[] = ['goal', 'own_goal', 'penalty', 'shot_saved', 'shot_blocked', 'shot_off_target',
  'yellow', 'second_yellow', 'red', 'substitution', 'foul', 'offside', 'corner', 'half_time', 'full_time', 'kick_off'];
/** Kinds each source can actually produce. Anything else is dropped, so nothing is invented. */
export const SOURCE_KINDS: Readonly<Record<MatchSource, ReadonlySet<AnnouncementKind>>> = {
  historical: new Set(ALL),
  // simulation/models.py EventType: kickoff, pass, carry, pressure, tackle, recovery, shot, save, goal,
  // restart, halftime, fulltime. Shot outcomes: goal | saved | off_target. No fouls, cards or subs.
  timepitch: new Set<AnnouncementKind>(['goal', 'shot_saved', 'shot_off_target', 'half_time', 'full_time', 'kick_off']),
  // grf/telemetry_models.py: goal (with own_goal flag) and referee decisions. Shots carry no outcome,
  // and there are no confirmed cards or substitutions.
  grf: new Set<AnnouncementKind>(['goal', 'own_goal', 'penalty', 'foul', 'offside', 'corner', 'half_time', 'full_time', 'kick_off']),
  // adapters/recorded-session.ts: union of RECORDED_ENGINE_KINDS; each event is filtered by its own engine.
  recorded: new Set<AnnouncementKind>(['goal', 'own_goal', 'half_time', 'full_time', 'kick_off', 'shot_saved', 'shot_off_target', 'foul', 'offside', 'corner', 'penalty']),
};
/** Recorded engine replays (TP202): goals from the score, half/full time from the periods, and what each engine's
 *  `recorded-events-1` sidecar maps from its own records. No engine records cards or substitutions there. */
export const RECORDED_ENGINE_KINDS: Readonly<Record<'grf' | 'touchlines' | 'open-football', ReadonlySet<AnnouncementKind>>> = {
  // GRF telemetry: goal (own_goal flag) and referee decisions (kickoff, foul, offside, corner, penalty). Shots carry no outcome.
  grf: new Set<AnnouncementKind>(['goal', 'own_goal', 'half_time', 'full_time', 'kick_off', 'foul', 'offside', 'corner', 'penalty']),
  // TouchLines bus: shotResolved (goal / saved by the defending GK / off target), offsideCalled; set pieces from
  // samples.game_mode (kickoff, corner, throw-in, offside free kick). TouchLines has no fouls.
  touchlines: new Set<AnnouncementKind>(['goal', 'own_goal', 'half_time', 'full_time', 'kick_off', 'shot_saved', 'shot_off_target', 'offside', 'corner']),
  // open-football log: PassTo KICK_OFF, Shoot (no outcome), CommitFoul (cards are decided inside, not logged), Offside.
  'open-football': new Set<AnnouncementKind>(['goal', 'own_goal', 'half_time', 'full_time', 'kick_off', 'foul', 'offside']),
};
const RECORDED_BASELINE: ReadonlySet<AnnouncementKind> = new Set<AnnouncementKind>(['goal', 'own_goal', 'half_time', 'full_time']);
const STYLE: Readonly<Record<AnnouncementKind, { priority: number; durationMs: number }>> = {
  goal: { priority: 100, durationMs: 6000 }, own_goal: { priority: 100, durationMs: 6000 },
  red: { priority: 90, durationMs: 5000 }, second_yellow: { priority: 85, durationMs: 5000 },
  penalty: { priority: 80, durationMs: 4500 }, full_time: { priority: 75, durationMs: 5000 },
  half_time: { priority: 70, durationMs: 4000 }, yellow: { priority: 60, durationMs: 4000 },
  shot_saved: { priority: 50, durationMs: 3000 }, kick_off: { priority: 45, durationMs: 2500 },
  substitution: { priority: 40, durationMs: 3500 }, shot_blocked: { priority: 35, durationMs: 3000 },
  shot_off_target: { priority: 35, durationMs: 3000 }, corner: { priority: 25, durationMs: 2500 },
  offside: { priority: 20, durationMs: 2500 }, foul: { priority: 10, durationMs: 2000 },
};
/** Priority from which an announcement survives staleness and is replayed after a seek. */
export const HIGH_PRIORITY = 70;
const STALE_MS = 8000, SAVE_LINK_MS = 2000, PENALTY_LINK_MS = 15000, OFFSIDE_LINK_MS = 3000;

const obj = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const name = (v: unknown): string | null => { const n = obj(v).name; return typeof n === 'string' ? n : null; };
const other = (side: Side | null): Side | null => side === 'home' ? 'away' : side === 'away' ? 'home' : null;
const lastOf = <T>(items: readonly T[], test: (item: T) => boolean): T | undefined => { for (let i = items.length - 1; i >= 0; i--) if (test(items[i])) return items[i]; return undefined; };
const team = (v: unknown): Side | null => v === 0 ? 'home' : v === 1 ? 'away' : null;

export function minuteLabel(source: MatchSource, period: number, periodMs: number, periodEnd = false): string {
  const ms = Math.max(0, periodEnd ? periodMs - 1 : periodMs);
  // GRF and recorded engines report an absolute match clock; the other adapters report period-local time.
  const base = source === 'grf' || source === 'recorded' ? 0 : period <= 1 ? 0 : period === 2 ? 45 : period === 3 ? 90 : 105;
  const cap = period <= 1 ? 45 : period === 2 ? 90 : period === 3 ? 105 : 120;
  const minute = base + Math.floor(ms / 60000) + 1;
  return minute > cap ? `${cap}+${minute - cap}'` : `${minute}'`;
}

type Draft = { event: EventView; kind: AnnouncementKind; side: Side | null; primary: string | null; secondary?: string | null };

function timepitch(events: readonly EventView[]): Draft[] {
  const drafts: Draft[] = [], kicked = new Set<number>();
  const saves = new Map(events.filter(e => e.kind === 'save').map(e => [String(obj(e.details.evidence).shot_id), e]));
  for (const e of events) {
    const base = { event: e, side: e.side, primary: e.actorId };
    if (e.kind === 'goal') drafts.push({ ...base, kind: 'goal' });
    else if (e.kind === 'shot' && e.outcome === 'saved') drafts.push({ ...base, kind: 'shot_saved', secondary: saves.get(e.refs[0])?.actorId });
    else if (e.kind === 'shot' && e.outcome === 'off_target') drafts.push({ ...base, kind: 'shot_off_target' });
    else if (e.kind === 'halftime') drafts.push({ ...base, kind: 'half_time', side: null, primary: null });
    else if (e.kind === 'fulltime') drafts.push({ ...base, kind: 'full_time', side: null, primary: null });
    else if (e.kind === 'kickoff' && !kicked.has(e.period)) { kicked.add(e.period); drafts.push({ ...base, kind: 'kick_off', side: null, primary: null }); }
  }
  return drafts;
}

function grf(events: readonly EventView[]): Draft[] {
  const drafts: Draft[] = [], incidents = new Set<string>(), kicked = new Set<number>();
  let ended = false;
  for (const e of events) {
    const d = e.details, credited = team(d.team) ?? e.side, offender = team(d.actor_team) ?? other(credited);
    const base = { event: e, primary: e.actorId };
    if (e.kind === 'goal') { drafts.push({ ...base, kind: e.outcome === 'own_goal' || d.own_goal === true ? 'own_goal' : 'goal', side: credited }); continue; }
    if (e.kind === 'halftime') { drafts.push({ ...base, kind: 'half_time', side: null, primary: null }); continue; }
    // A log may carry both fulltime and episode_end: announce the end of the match once.
    if (e.kind === 'fulltime' || e.kind === 'episode_end') { if (ended) continue; ended = true; drafts.push({ ...base, kind: 'full_time', side: null, primary: null }); continue; }
    if (d.type !== 'decision') continue;
    // A foul is reported once per stage (accepted, advantage_played, sanctioned) under one incident.
    const incident = `${e.kind}:${String(d.incident_id ?? e.id)}`;
    if (incidents.has(incident)) continue;
    incidents.add(incident);
    if (e.kind === 'foul') drafts.push({ ...base, kind: 'foul', side: offender });
    else if (e.kind === 'offside') drafts.push({ ...base, kind: 'offside', side: offender });
    else if (e.kind === 'corner') drafts.push({ ...base, kind: 'corner', side: credited });
    else if (e.kind === 'penalty') {
      const foul = lastOf(drafts, x => x.kind === 'foul' && other(x.side) === credited && e.elapsedMs! - x.event.elapsedMs! <= PENALTY_LINK_MS);
      if (foul) drafts.splice(drafts.indexOf(foul), 1);
      drafts.push({ ...base, kind: 'penalty', side: credited, secondary: foul?.primary });
    } else if (e.kind === 'kickoff' && !kicked.has(e.period)) { kicked.add(e.period); drafts.push({ ...base, kind: 'kick_off', side: null, primary: null }); }
  }
  return drafts;
}

function recorded(events: readonly EventView[]): Draft[] {
  const drafts: Draft[] = [];
  const shots = events.filter(e => e.kind === 'shot');
  for (const e of events) {
    const base = { event: e, side: e.side, primary: e.actorId };
    if (e.kind === 'goal') drafts.push({ ...base, kind: e.outcome === 'own_goal' ? 'own_goal' : 'goal' });
    else if (e.kind === 'halftime') drafts.push({ ...base, kind: 'half_time', side: null, primary: null });
    else if (e.kind === 'fulltime') drafts.push({ ...base, kind: 'full_time', side: null, primary: null });
    else if (e.kind === 'kickoff' && e.details.period_start === true) drafts.push({ ...base, kind: 'kick_off', side: null, primary: null });
    else if (e.kind === 'save') {
      // Announced when the engine resolved the shot; the shot it saved is the one whose resolution time is this one.
      const shot = lastOf(shots, s => s.outcome === 'saved' && s.details.resolved_t_ms === e.elapsedMs && s.side === other(e.side));
      if (shot) drafts.push({ event: e, kind: 'shot_saved', side: shot.side, primary: shot.actorId, secondary: e.actorId });
    } else if (e.kind === 'shot' && e.outcome === 'off_target') drafts.push({ ...base, kind: 'shot_off_target' });
    else if (e.kind === 'foul') drafts.push({ ...base, kind: 'foul' });
    else if (e.kind === 'offside') drafts.push({ ...base, kind: 'offside' });
    else if (e.kind === 'corner') drafts.push({ ...base, kind: 'corner' });
    else if (e.kind === 'penalty') drafts.push({ ...base, kind: 'penalty' });
    else if (e.kind === 'card_yellow') drafts.push({ ...base, kind: 'yellow' });
    else if (e.kind === 'card_red') drafts.push({ ...base, kind: 'red' });
    else if (e.kind === 'substitution') drafts.push({ ...base, kind: 'substitution' });
  }
  return drafts;
}
const recordedAllowed = (e: EventView): ReadonlySet<AnnouncementKind> =>
  RECORDED_ENGINE_KINDS[e.details.engine as keyof typeof RECORDED_ENGINE_KINDS] ?? RECORDED_BASELINE;

const CARDS: Readonly<Record<string, AnnouncementKind>> = { 'Yellow Card': 'yellow', 'Second Yellow': 'second_yellow', 'Red Card': 'red' };
const SAVED = new Set(['Saved', 'Saved To Post', 'Saved to Post', 'Saved Off Target', 'Saved Off T']);
const OFF_TARGET = new Set(['Off T', 'Wayward', 'Post']);

function historical(events: readonly EventView[], lastPeriod: number): Draft[] {
  const drafts: Draft[] = [], markers = new Set<string>();
  for (const e of events) {
    const d = e.details, base = { event: e, side: e.side, primary: e.actorId };
    if (e.kind === 'Shot') {
      const outcome = name(obj(d.shot).outcome) ?? e.outcome;
      if (outcome === 'Goal') drafts.push({ ...base, kind: 'goal' });
      else if (outcome === 'Blocked') drafts.push({ ...base, kind: 'shot_blocked' });
      else if (outcome && OFF_TARGET.has(outcome)) drafts.push({ ...base, kind: 'shot_off_target' });
      else if (outcome && SAVED.has(outcome)) {
        const keeper = events.find(k => k.kind === 'Goal Keeper' && k.side === other(e.side) && Math.abs(k.elapsedMs! - e.elapsedMs!) <= SAVE_LINK_MS);
        drafts.push({ ...base, kind: 'shot_saved', secondary: keeper?.actorId });
      }
    } else if (e.kind === 'Own Goal Against') drafts.push({ ...base, kind: 'own_goal', side: other(e.side) });
    else if (e.kind === 'Foul Committed' || e.kind === 'Bad Behaviour') {
      const detail = obj(e.kind === 'Foul Committed' ? d.foul_committed : d.bad_behaviour), card = CARDS[name(detail.card) ?? ''];
      if (e.kind === 'Foul Committed' && detail.penalty === true) drafts.push({ ...base, kind: 'penalty', side: other(e.side) });
      if (card) drafts.push({ ...base, kind: card });
      else if (e.kind === 'Foul Committed' && detail.penalty !== true) drafts.push({ ...base, kind: 'foul' });
    } else if (e.kind === 'Offside' || (e.kind === 'Pass' && (name(obj(d.pass).outcome) ?? e.outcome) === 'Pass Offside')) {
      // StatsBomb can record the same offside as a Pass outcome and as an Offside event.
      const twin = lastOf(drafts, x => x.kind === 'offside' && x.side === e.side && e.elapsedMs! - x.event.elapsedMs! <= OFFSIDE_LINK_MS);
      if (!twin) drafts.push({ ...base, kind: 'offside' });
    } else if (e.kind === 'Pass' && name(obj(d.pass).type) === 'Corner') drafts.push({ ...base, kind: 'corner' });
    else if (e.kind === 'Substitution') {
      const on = e.participantIds.find(p => p !== e.actorId) ?? null;
      drafts.push({ ...base, kind: 'substitution', primary: on ?? e.actorId, secondary: on ? e.actorId : null });
    } else if (e.kind === 'Half Start' || e.kind === 'Half End') {
      // Each team records its own period marker.
      const kind: AnnouncementKind = e.kind === 'Half Start' ? 'kick_off' : e.period === lastPeriod ? 'full_time' : 'half_time';
      const key = `${kind}:${e.period}`;
      if (markers.has(key) || e.period > lastPeriod) continue;
      markers.add(key);
      drafts.push({ ...base, kind, side: null, primary: null });
    }
  }
  return drafts;
}

export function buildAnnouncements(source: MatchSource, events: readonly EventView[], options: BuildOptions = {}): Announcement[] {
  const timed = events.filter(e => e.elapsedMs !== null && Number.isFinite(e.elapsedMs))
    .sort((a, b) => a.elapsedMs! - b.elapsedMs! || a.sourceIndex - b.sourceIndex);
  const drafts = source === 'timepitch' ? timepitch(timed) : source === 'grf' ? grf(timed) : source === 'recorded' ? recorded(timed) : historical(timed, options.lastPeriod ?? 2);
  const allowed = SOURCE_KINDS[source];
  const permitted = (x: Draft) => allowed.has(x.kind) && (source !== 'recorded' || recordedAllowed(x.event).has(x.kind));
  let score: Score | null = options.baseScore === undefined ? (source === 'historical' ? null : { home: 0, away: 0 }) : options.baseScore && { ...options.baseScore };
  return drafts.filter(permitted).map(({ event: e, kind, side, primary, secondary }) => {
    const scoring = kind === 'goal' || kind === 'own_goal';
    if (scoring && score && side) score = { ...score, [side]: score[side] + 1 };
    const marker = kind === 'half_time' || kind === 'full_time';
    return {
      // Event ids are stable source identities, so the same action keeps the same React key.
      id: `${kind}:${e.id}`, kind, ...STYLE[kind], atMs: e.elapsedMs!,
      minuteLabel: minuteLabel(source, e.period, e.periodMs, marker), side, primaryPlayerId: primary,
      ...(secondary ? { secondaryPlayerId: secondary } : {}),
      ...(scoring && score ? { scoreAfter: { ...score } } : {}),
      provenance: source === 'historical' ? 'historical' : 'simulated',
    };
  });
}

export type AnnouncerState = {
  readonly cursorMs: number | null;
  readonly current: { readonly announcement: Announcement; readonly startedAtMs: number } | null;
  readonly pending: readonly Announcement[];
  readonly seen: ReadonlySet<string>;
};
/** cursorMs is match time; wallMs is display time, so a held card lasts the same at any playback speed. */
export type AnnouncerStep = { cursorMs: number; wallMs: number; seek?: boolean };

export function initialAnnouncer(): AnnouncerState {
  return { cursorMs: null, current: null, pending: [], seen: new Set() };
}

const rank = (a: Announcement, b: Announcement) => b.priority - a.priority || a.atMs - b.atMs;

export function stepAnnouncer(state: AnnouncerState, announcements: readonly Announcement[], step: AnnouncerStep): AnnouncerState {
  const { cursorMs, wallMs } = step, previous = state.cursorMs ?? cursorMs;
  if (step.seek || state.cursorMs === null || cursorMs < previous) {
    // Catch-up: of everything skipped forward, only the latest high-priority item is shown.
    const skipped = cursorMs > previous ? announcements.filter(a => a.atMs > previous && a.atMs <= cursorMs && a.priority >= HIGH_PRIORITY) : [];
    const latest = skipped.reduce<Announcement | null>((best, a) => !best || a.atMs >= best.atMs ? a : best, null);
    return { cursorMs, pending: [], seen: new Set(announcements.filter(a => a.atMs <= cursorMs).map(a => a.id)),
      current: latest ? { announcement: latest, startedAtMs: wallMs } : null };
  }
  const arrived = announcements.filter(a => a.atMs <= cursorMs && !state.seen.has(a.id));
  const seen = arrived.length ? new Set([...state.seen, ...arrived.map(a => a.id)]) : state.seen;
  const pending = [...state.pending, ...arrived].filter(a => a.priority >= HIGH_PRIORITY || cursorMs - a.atMs <= STALE_MS).sort(rank);
  const held = state.current && wallMs - state.current.startedAtMs < state.current.announcement.durationMs ? state.current : null;
  if (held || !pending.length) return { cursorMs, seen, pending, current: held };
  return { cursorMs, seen, pending: pending.slice(1), current: { announcement: pending[0], startedAtMs: wallMs } };
}
