import { describe, expect, it } from 'vitest';
import type { Announcement } from '../../match-centre/announcements/announcements';
import type { EventView } from '../../match-centre/session';
import { allowedKinds, CUT_IN_MS, cutInDuration, cutInSources, initialCutInState, isWinningTackle, REDUCED_MOTION_MS, skipCutIn, stepCutIns,
  type CutIn, type CutInInput, type CutInState } from './cutins';

// TP234 · Capitán Hane: only recorded events trigger a scene, and the scene freezes the playback clock.
const ann = (kind: Announcement['kind'], atMs: number, primary: string | null = 'home:9', secondary?: string): Announcement => ({
  id: `${kind}@${atMs}`, kind, priority: 50, minuteLabel: '', atMs, side: 'home', primaryPlayerId: primary, secondaryPlayerId: secondary,
  provenance: 'simulated', durationMs: 3000 });
const ev = (kind: string, elapsedMs: number | null, over: Partial<EventView> = {}): EventView => ({ id: `${kind}#${elapsedMs}`, sourceIndex: 0, kind, period: 1,
  periodMs: elapsedMs ?? 0, elapsedMs, side: 'away', actorId: 'away:4', participantIds: ['away:4', 'home:9'], outcome: null, provenance: 'simulated', refs: [], details: {}, ...over });
const input = (over: Partial<CutInInput> = {}): CutInInput => ({ cursorMs: 0, wallMs: 0, speed: 1, playing: true, seekToken: 0, seeking: false, scenes: 'all', reducedMotion: false, ...over });
const goal: CutIn = { id: 'goal@1000', kind: 'goal', atMs: 1000, side: 'home', actorId: 'home:9', keeperId: null };
const save: CutIn = { id: 'save@1000', kind: 'save', atMs: 1000, side: 'home', actorId: 'home:9', keeperId: 'away:1' };
const tackle: CutIn = { id: 'tackle@1000', kind: 'tackle', atMs: 1000, side: 'away', actorId: 'away:4', keeperId: null };
/** Cursor ya situado en 900 reproduciendo, listo para cruzar el acontecimiento de 1000. */
const primed = (over: Partial<CutInInput> = {}): CutInState => stepCutIns(stepCutIns(initialCutInState(), [], input({ cursorMs: 800, ...over })).state, [], input({ cursorMs: 900, ...over })).state;

describe('event → cut-in mapping', () => {
  it('uses goals, saved and off-target shots from the announcements and winning tackles from the raw events, nothing else', () => {
    const sources = cutInSources([
      ev('tackle', 500, { outcome: 'won_ball' }), ev('tackle', 600, { outcome: 'held' }), ev('pressure', 700), ev('tackle', null, { outcome: 'won_ball' }),
      ev('Duel', 800, { details: { duel: { type: { name: 'Tackle' }, outcome: { name: 'Success In Play' } } } }),
      ev('Duel', 900, { details: { duel: { type: { name: 'Tackle' }, outcome: { name: 'Lost In Play' } } } }),
      ev('possession_change', 950, { details: { native: 'tackle' } }), ev('possession_change', 960, { details: { native: 'interception' } }),
      ev('tackle', 970, { outcome: 'won_ball', actorId: null }),
    ], [ann('goal', 1000), ann('own_goal', 1100), ann('shot_saved', 1200, 'home:9', 'away:1'), ann('shot_off_target', 1300),
      ann('shot_blocked', 1400), ann('kick_off', 0), ann('foul', 1500)]);
    expect(sources.map(s => `${s.kind}@${s.atMs}:${s.actorId}${s.keeperId ? `>${s.keeperId}` : ''}`)).toEqual([
      'tackle@500:away:4', 'tackle@800:away:4', 'tackle@950:away:4', 'goal@1000:home:9', 'save@1200:home:9>away:1', 'miss@1300:home:9']);
  });
  // TP238: GRF (and open-football) record shots without an outcome and no tackles. The outcome is deduced only from the
  // next recorded event; the scene appears when that event happens. Doubtful cases (corner, defender clearance) get none.
  it('deduces saves and wide shots from the next recorded event when the engine records no shot outcome', () => {
    const keepers = new Set(['away:1', 'home:1']);
    const shot = (at: number, actor = 'home:9') => ev('shot', at, { side: 'home', actorId: actor, outcome: null });
    const sources = cutInSources([
      shot(1000), ev('short_pass', 3000, { side: 'away', actorId: 'away:1' }),            // keeper plays within 5 s: save
      shot(10000, 'home:10'), ev('short_pass', 17000, { side: 'away', actorId: 'away:1' }), // keeper after 7 s: goal kick, wide
      shot(20000, 'home:11'), ev('goal_kick', 22000, { side: 'away', actorId: null }),      // goal kick decision: wide
      shot(30000), ev('corner', 33000, { side: 'home', actorId: 'home:7' }),                // corner: doubtful, no scene
      shot(40000), ev('short_pass', 41000, { side: 'away', actorId: 'away:5' }),            // defender clears: no scene
      shot(50000), ev('goal', 51000, { side: 'home', actorId: 'home:9' }),                  // goal: its own scene
      shot(60000),                                                                          // not resolved yet: nothing
    ], [ann('goal', 51000)], keepers);
    expect(sources.map(s => `${s.kind}@${s.atMs}:${s.actorId}${s.keeperId ? `>${s.keeperId}` : ''}`)).toEqual([
      'save@3000:home:9>away:1', 'miss@17000:home:10', 'miss@22000:home:11', 'goal@51000:home:9']);
  });
  it('does not deduce shot outcomes when the engine records them, and deduces balls won at most every 3 min', () => {
    const keepers = new Set(['away:1']);
    const recorded = cutInSources([ev('shot', 1000, { side: 'home', actorId: 'home:9' }), ev('short_pass', 2000, { side: 'away', actorId: 'away:1' })],
      [ann('shot_off_target', 1000)], keepers);
    expect(recorded.map(s => s.kind)).toEqual(['miss']);
    const won = cutInSources([
      ev('short_pass', 1000, { side: 'home', actorId: 'home:8' }), ev('ball_control', 2000, { side: 'away', actorId: 'away:4' }),  // won
      ev('short_pass', 3000, { side: 'away', actorId: 'away:4' }), ev('trap', 4000, { side: 'home', actorId: 'home:6' }),          // too soon
      ev('short_pass', 100000, { side: 'home', actorId: 'home:6' }), ev('short_pass', 109000, { side: 'away', actorId: 'away:3' }), // too slow
      ev('short_pass', 120000, { side: 'away', actorId: 'away:3' }), ev('short_pass', 121000, { side: 'home', actorId: 'home:5' }), // < 3 min
      ev('short_pass', 190000, { side: 'home', actorId: 'home:5' }), ev('short_pass', 191000, { side: 'away', actorId: 'away:3' }), // won
      ev('short_pass', 400000, { side: 'away', actorId: 'away:3' }), ev('ball_control', 401000, { side: 'home', actorId: 'home:1' }), // keeper: no
    ], [], new Set(['away:1', 'home:1']));
    expect(won.map(s => `${s.kind}@${s.atMs}:${s.actorId}`)).toEqual(['tackle@2000:away:4', 'tackle@191000:away:3']);
    // With recorded winning tackles, nothing is deduced.
    expect(cutInSources([ev('tackle', 500, { outcome: 'won_ball' }), ev('short_pass', 1000, { side: 'home', actorId: 'home:8' }),
      ev('ball_control', 2000, { side: 'away', actorId: 'away:4' })], [], keepers).map(s => s.id)).toEqual(['tackle:tackle#500']);
  });
  it('a tackle counts only when the event says the ball was won', () => {
    expect(isWinningTackle(ev('tackle', 1, { outcome: 'won_ball' }))).toBe(true);
    expect(isWinningTackle(ev('tackle', 1, { outcome: 'held' }))).toBe(false);
    expect(isWinningTackle(ev('recovery', 1, { outcome: 'won_ball' }))).toBe(false);
  });
});

describe('speed thresholds, settings and reduced motion', () => {
  it('all scenes up to 5×, goals only above 5× or with «goals only», none above 20× or with «none»', () => {
    expect([...allowedKinds('all', 5)].sort()).toEqual(['goal', 'miss', 'save', 'tackle']);
    expect([...allowedKinds('all', 5.01)]).toEqual(['goal']);
    expect([...allowedKinds('all', 20)]).toEqual(['goal']);
    expect([...allowedKinds('all', 20.5)]).toEqual([]);
    expect([...allowedKinds('goals', 1)]).toEqual(['goal']);
    expect([...allowedKinds('none', 1)]).toEqual([]);
  });
  it.each([[1, 'save', true], [10, 'save', false], [10, 'goal', true], [30, 'goal', false]] as const)('at %s× a crossed %s starts a scene: %s', (speed, kind, starts) => {
    const cut = kind === 'goal' ? goal : save, state = primed({ speed });
    expect(!!stepCutIns(state, [cut], input({ cursorMs: 1000 + speed, speed })).start).toBe(starts);
  });
  it('durations are 1.6–2.4 s, and reduced motion shows a 1.2 s static card instead', () => {
    for (const ms of Object.values(CUT_IN_MS)) expect(ms >= 1600 && ms <= 2400).toBe(true);
    expect(cutInDuration('goal', true)).toBe(REDUCED_MOTION_MS);
    const step = stepCutIns(primed(), [goal], input({ cursorMs: 1010, reducedMotion: true, wallMs: 50 }));
    expect(step.state.showing).toMatchObject({ durationMs: 1200, reducedMotion: true });
  });
  it('never fires on a seek, a backwards move, a big jump or while paused', () => {
    expect(stepCutIns(primed(), [goal], input({ cursorMs: 1010, seekToken: 1 })).start).toBeUndefined();
    expect(stepCutIns(primed(), [goal], input({ cursorMs: 500 })).start).toBeUndefined();
    expect(stepCutIns(primed(), [goal], input({ cursorMs: 9000 })).start).toBeUndefined();
    expect(stepCutIns(primed(), [goal], input({ cursorMs: 1010, playing: false })).start).toBeUndefined();
  });
  it('picks the most important event when several are crossed in one step', () => {
    expect(stepCutIns(primed(), [tackle, goal, save], input({ cursorMs: 1010 })).start).toBe(goal);
  });
});

describe('pause/resume sync with the playback clock', () => {
  it('starts paused, waits its duration, then asks to resume; the cursor does not move or cross anything meanwhile', () => {
    const started = stepCutIns(primed(), [goal], input({ cursorMs: 1010, wallMs: 100 }));
    expect(started.start).toBe(goal);
    // The centre pauses: the next step sees the clock stopped at the same cursor.
    let state = stepCutIns(started.state, [goal], input({ cursorMs: 1010, playing: false, wallMs: 120 })).state;
    expect(state.showing?.pausedSeen).toBe(true);
    const mid = stepCutIns(state, [goal], input({ cursorMs: 1010, playing: false, wallMs: 100 + CUT_IN_MS.goal - 1 }));
    expect(mid.end).toBeUndefined(); state = mid.state;
    const done = stepCutIns(state, [goal], input({ cursorMs: 1010, playing: false, wallMs: 100 + CUT_IN_MS.goal }));
    expect(done.end).toEqual({ resume: true, reason: 'done' });
    // After resuming, play continues from the paused cursor and the same goal does not fire again.
    const after = stepCutIns(done.state, [goal], input({ cursorMs: 1026, wallMs: 3000 }));
    expect(after.start).toBeUndefined();
    expect(after.state.cursorMs).toBe(1026);
  });
  it('if the user presses play during the scene it closes without a second resume; a seek closes it without resuming', () => {
    const started = stepCutIns(primed(), [goal], input({ cursorMs: 1010 }));
    const paused = stepCutIns(started.state, [goal], input({ cursorMs: 1010, playing: false }));
    expect(stepCutIns(paused.state, [goal], input({ cursorMs: 1010, playing: true })).end).toEqual({ resume: false, reason: 'played' });
    expect(stepCutIns(paused.state, [goal], input({ cursorMs: 1010, playing: false, seekToken: 1 })).end).toEqual({ resume: false, reason: 'seek' });
  });
  it('the still-playing step right after the start does not count as the user pressing play', () => {
    const started = stepCutIns(primed(), [goal], input({ cursorMs: 1010 }));
    expect(stepCutIns(started.state, [goal], input({ cursorMs: 1010, playing: true, wallMs: 5 })).end).toBeUndefined();
  });
  it('switching scenes off or speeding past the threshold closes the scene and resumes', () => {
    const started = stepCutIns(primed(), [save], input({ cursorMs: 1010 }));
    expect(stepCutIns(started.state, [save], input({ cursorMs: 1010, playing: false, scenes: 'none' })).end).toEqual({ resume: true, reason: 'disabled' });
    expect(stepCutIns(started.state, [save], input({ cursorMs: 1010, playing: false, speed: 10 })).end).toEqual({ resume: true, reason: 'disabled' });
  });
});

describe('skip', () => {
  it('a click or key closes the scene and resumes; with nothing shown it does nothing', () => {
    const started = stepCutIns(primed(), [goal], input({ cursorMs: 1010 }));
    const skipped = skipCutIn(started.state);
    expect(skipped.end).toEqual({ resume: true, reason: 'skip' });
    expect(skipped.state.showing).toBeNull();
    expect(skipCutIn(skipped.state).end).toBeUndefined();
  });
});
