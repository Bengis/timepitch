import type { MatchRecord, MatchRecordV2, RenderFrame } from '../api';
import { createTimePitchSession } from '../match-centre/adapters/timepitch';
import { MatchPlaybackController } from '../match-centre/playback';
import { sampleInterval } from '../match-centre/sampling';

export const FULL_TIME = 5400000;
export const isSpatial = (record: MatchRecord): record is MatchRecordV2 => 'format_version' in record && record.format_version === 2;
const sessions = new WeakMap<MatchRecord, ReturnType<typeof createTimePitchSession>>();
function session(record: MatchRecord) {
  let value = sessions.get(record);
  if (!value) { value = createTimePitchSession('compatibility', record); sessions.set(record, value); }
  return value;
}
// Compatibility readers use the exact same source decoder and sampler as live playback.
export function sampleFrame(record: MatchRecord, clockMs: number) {
  const adapter = session(record), time = Math.max(0, Math.min(Number.isFinite(clockMs) ? clockMs : 0, adapter.snapshot().descriptor.durationMs ?? FULL_TIME));
  const snapshot = adapter.resolveFrame(time), frame = sampleInterval(snapshot.interval!, time);
  const key = (id: string) => id.slice('timepitch:'.length);
  return { ...frame, score: frame.score!, ball: frame.ball!, players: frame.players.map(p => ({ ...p, key: key(p.key) })), carrier: frame.carrier ? key(frame.carrier) : null };
}
export function resolvedEvents(record: MatchRecord, endMs: number) { return record.events.filter(event => event.t1_ms <= Math.max(0, Math.min(FULL_TIME, endMs))); }
export function scoreAt(record: MatchRecord, endMs: number): RenderFrame['score'] { return sampleFrame(record, endMs).score; }
export function restartAt(record: MatchRecord, clockMs: number): number {
  if (!isSpatial(record)) return 0;
  return record.motion.filter(s => s[0] <= clockMs && clockMs - s[0] < 750 && s[7]).at(-1)?.[7] ?? 0;
}
// Kept for existing consumers; all clock behavior belongs to the common controller.
export class ReplayController {
  private clock: MatchPlaybackController;
  constructor(record: MatchRecord, now: () => number = () => performance.now()) { this.clock = new MatchPlaybackController(session(record).snapshot().descriptor.durationMs, now); }
  get isPlaying() { return this.clock.snapshot().isPlaying; }
  get speed() { return this.clock.snapshot().speed; }
  currentTime() { return this.clock.currentTime(); }
  play() { this.clock.play(); }
  pause() { this.clock.pause(); }
  seek(ms: number) { this.clock.seek(ms); }
  setSpeed(speed: number) { this.clock.setSpeed(speed); }
}
export function clockLabel(time: number) { return `${Math.floor(time / 60000).toString().padStart(2, '0')}:${Math.floor(time / 1000 % 60).toString().padStart(2, '0')}`; }