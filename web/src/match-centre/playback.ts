import type { LoadState } from './session';
import type { PlaybackPolicy, PlaybackStop } from './sequence/types';

export const PLAYBACK_SPEEDS = [1, 5, 10, 20, 60, 120] as const;
/** TP254: sin política (secuencias), la velocidad es libre entre 1× y 120×: la barra la calcula a partir de la duración
 *  de cada parte que elige el usuario, como en FIFA, y no siempre cae en un valor de la lista. */
export const freeSpeed = (speed: number) => Number.isFinite(speed) && speed >= 1 && speed <= 120;
export type PlaybackState = {
  elapsedMs: number; pendingSeekMs: number | null; speed: number; wantsPlay: boolean; isPlaying: boolean;
  status: 'paused' | 'playing' | 'buffering' | 'ended' | 'unavailable';
  stop: PlaybackStop | null; isMatchEnd: boolean;
};

export class MatchPlaybackController {
  private duration: number | null;
  private horizon: number;
  private readiness: LoadState = 'ready';
  private elapsed = 0;
  private anchor: number;
  private rate = 1;
  private intent = false;
  private pending: number | null = null;
  private policy: PlaybackPolicy | null = null;
  private stop: PlaybackStop | null = null;

  private limit() { return Math.min(this.duration ?? this.elapsed, this.policy?.toMs ?? Infinity); }
  setPolicy(policy: PlaybackPolicy | null) {
    // Validate before sync: an invalid request cannot mutate a playing clock.
    if (policy !== null) {
      if (this.duration === null || !Number.isFinite(policy.fromMs) || !Number.isFinite(policy.toMs)
        || policy.fromMs < 0 || policy.toMs <= policy.fromMs || policy.toMs > this.duration
        || !policy.speeds.length || !policy.speeds.includes(1) || policy.speeds.some(s => !Number.isFinite(s) || s <= 0)
        || policy.pauseAt.some(p => !Number.isFinite(p.atMs) || p.atMs <= policy.fromMs || p.atMs >= policy.toMs || !Number.isInteger(p.endingPeriod) || p.endingPeriod <= 0)
        || new Set(policy.pauseAt.map(p => p.atMs)).size !== policy.pauseAt.length) throw new RangeError('Invalid playback policy');
    }
    const canonical:PlaybackPolicy|null=policy?{id:policy.id,fromMs:policy.fromMs,toMs:policy.toMs,
      speeds:[...policy.speeds].sort((a,b)=>a-b),pauseAt:policy.pauseAt.map(p=>({atMs:p.atMs,endingPeriod:p.endingPeriod})).sort((a,b)=>a.atMs-b.atMs)}:null;
    if (policy?.id === this.policy?.id) {
      if (JSON.stringify(canonical) !== JSON.stringify(this.policy)) throw new RangeError('Playback policy ID changed its definition');
      return;
    }
    this.sync();
    this.policy = canonical;
    this.stop = null;
    if (policy) { this.intent = false; this.rate = 1; this.seek(policy.fromMs); }
    else if (!freeSpeed(this.rate)) this.rate = 1;
  }
  continueAfterStop() {
    if (this.stop?.kind !== 'halftime') return;
    this.stop = null; this.anchor = this.now(); this.play();
  }

  constructor(durationMs: number | null, private readonly now: () => number) {
    this.duration = this.validDuration(durationMs);
    this.horizon = this.duration ?? 0;
    this.anchor = now();
  }
  private validDuration(value: number | null): number | null {
    return value !== null && Number.isFinite(value) && value >= 0 ? value : null;
  }
  private ready() { return this.readiness === 'ready' || this.readiness === 'facts_only'; }
  private canAdvance() {
    return this.stop === null && this.intent && this.duration !== null && this.ready() && this.pending === null
      && this.elapsed < Math.min(this.limit(), this.horizon);
  }
  private sync() {
    const now = this.now();
    if (this.canAdvance()) {
      const target = Math.min(this.limit(), this.horizon, this.elapsed + Math.max(0, now - this.anchor) * this.rate);
      const boundary = this.policy?.pauseAt.find(p => p.atMs > this.elapsed && p.atMs <= target);
      this.elapsed = boundary?.atMs ?? target;
      if (boundary) { this.stop = {kind:'halftime',...boundary}; this.intent = false; }
      else if (this.policy && this.elapsed >= this.policy.toMs) { this.stop = {kind:'clip-end',atMs:this.elapsed}; this.intent = false; }
    }
    this.anchor = now;
    if (this.duration !== null && this.elapsed >= this.duration && this.pending === null) this.intent = false;
  }
  currentTime() { this.sync(); return this.elapsed; }
  play() {
    this.sync();
    if (!this.stop && this.duration !== null && (this.pending ?? this.elapsed) < this.limit()) this.intent = true;
  }
  pause() { this.sync(); this.intent = false; }
  seek(ms: number) {
    this.sync();
    const target = Math.max(this.policy?.fromMs ?? 0, Math.min(Number.isFinite(ms) ? ms : 0, this.limit()));
    this.stop = null;
    if (!this.ready() || target > this.horizon) this.pending = target;
    else { this.elapsed = target; this.pending = null; }
    if (this.duration !== null && this.elapsed >= this.duration && this.pending === null) this.intent = false;
  }
  setSpeed(speed: number) {
    if (this.policy ? !this.policy.speeds.includes(speed) : !freeSpeed(speed)) throw new RangeError('Unsupported playback speed');
    this.sync(); this.rate = speed;
  }
  setDuration(ms: number | null) {
    this.sync();
    const prior = this.duration;
    this.duration = this.validDuration(ms);
    if (this.duration === null) { this.intent = false; return; }
    this.elapsed = Math.min(this.elapsed, this.duration);
    if (this.pending !== null) this.pending = Math.min(this.pending, this.duration);
    // A bare controller covers the extent. Hook always supplies the adapter's horizon.
    if (prior === null || this.horizon === prior) this.horizon = this.duration;
  }
  setHorizon(ms: number, status: LoadState) {
    this.sync();
    this.horizon = Number.isFinite(ms) ? Math.max(0, ms) : 0;
    this.readiness = status;
    if (this.pending !== null && this.ready() && this.pending <= this.horizon && this.duration !== null) {
      this.elapsed = Math.min(this.pending, this.duration); this.pending = null;
    }
    if (this.duration !== null && this.elapsed >= this.duration && this.pending === null) this.intent = false;
  }
  replay() { this.seek(0); this.play(); }
  snapshot(): PlaybackState {
    this.sync();
    const ended = this.duration !== null && this.elapsed >= this.duration && this.pending === null;
    const unavailable = this.duration === null || this.readiness === 'unavailable';
    const buffering = this.pending !== null || this.readiness === 'buffering'
      || (this.intent && this.elapsed >= this.horizon && !ended);
    const isPlaying = this.canAdvance();
    return { elapsedMs: this.elapsed, pendingSeekMs: this.pending, speed: this.rate, wantsPlay: this.intent, isPlaying,
      stop:this.stop ? {...this.stop} : null, isMatchEnd:ended,
      status: unavailable ? 'unavailable' : this.stop ? 'paused' : ended ? 'ended' : buffering ? 'buffering' : isPlaying ? 'playing' : 'paused' };
  }
}
