import type { GrfReplay } from '../api';
import { createGrfSession } from '../match-centre/adapters/grf';
import { MatchPlaybackController } from '../match-centre/playback';
import { sampleInterval } from '../match-centre/sampling';
const sessions = new WeakMap<GrfReplay, ReturnType<typeof createGrfSession>>();
function session(record: GrfReplay) { let value = sessions.get(record); if (!value) { value = createGrfSession('compatibility', record); sessions.set(record, value); } return value; }
export function sampleGrfFrame(record: GrfReplay, timeMs: number) {
  const time = Math.max(0, Math.min(Number.isFinite(timeMs) ? timeMs : 0, record.duration_ms));
  const snapshot = session(record).resolveFrame(time), interval = snapshot.interval!, raw = sampleInterval(interval, time);
  const key = (id: string) => id.slice('grf:'.length);
  return { frame: { ...raw, ball: raw.ball!, score: raw.score!, players: raw.players.map(p => ({ ...p, key: key(p.key) })), carrier: raw.carrier ? key(raw.carrier) : null },
    nativeStep: snapshot.observations?.values.engine_step, matchTimeMs: snapshot.clockMs,
    transition: !!interval.after && !interval.continuousBall && !interval.continuousPlayers.size,
    ownerKnown: snapshot.facts.carrierId.value !== null, completed: time >= record.duration_ms };
}
// Compatibility shell only; there is no second clock or interpolation path.
export class GrfReplayController {
  private clock: MatchPlaybackController;
  constructor(record: GrfReplay, now: () => number = () => performance.now()) { this.clock = new MatchPlaybackController(record.duration_ms, now); }
  get isPlaying() { return this.clock.snapshot().isPlaying; }
  get speed() { return this.clock.snapshot().speed; }
  currentTime() { return this.clock.currentTime(); }
  play() { this.clock.play(); }
  pause() { this.clock.pause(); }
  seek(ms: number) { this.clock.seek(ms); }
  setSpeed(speed: number) { this.clock.setSpeed(speed); }
}