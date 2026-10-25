import { useEffect, useMemo, useReducer } from 'react';
import { MatchPlaybackController } from './playback';
import { sampleInterval } from './sampling';
import { cursorAt, identityKey, type MatchSessionAdapter, type MotionInterval, type SampleView, type SessionSnapshot, type SessionDemand } from './session';
import type { PlaybackPolicy } from './sequence/types';

function contains(interval: MotionInterval | null, time: number): interval is MotionInterval {
  return interval !== null && time >= interval.fromMs && time <= interval.toMs;
}
function resolves(interval: MotionInterval | null, time: number): interval is MotionInterval {
  // The next interval owns discrete facts at a shared boundary. A zero-duration
  // interval is a resolved marker (including the true final state).
  return contains(interval, time) && (time < interval.toMs || interval.fromMs === interval.toMs);
}

// One lifecycle per immutable source identity; no source-specific timer or coordinate math.
function createPlayback(adapter: MatchSessionAdapter, policy?: PlaybackPolicy) {
  let snapshot = adapter.snapshot();
  const key = identityKey(adapter.identity);
  const controller = new MatchPlaybackController(snapshot.descriptor.durationMs, () => performance.now());
  controller.setHorizon(snapshot.horizonMs, snapshot.loadState);
  if (policy) controller.setPolicy(policy);
  let visible = false, active = false, disposed = false, generation = 0, raf: number | null = null, lastPublish = -Infinity;
  let demand: { cursor: number; endingPeriod: number | undefined; abort: AbortController; generation: number } | null = null;
  let lastDemand: string | null = null;
  let requestedCursor: number | null = null;
  let requestedEnding: number | undefined;
  let notify = () => {};
  let lastView: SampleView | null = null;
  let policyId=policy?.id??null;

  function context(): SessionDemand {
    const state=controller.snapshot();
    return {playback:state.wantsPlay?'playing':'paused',...(state.stop?.kind==='halftime'?{endingPeriod:state.stop.endingPeriod}:{})};
  }
  function resolved(next:SessionSnapshot,time:number) {
    const stop=controller.snapshot().stop;
    if(next.presentedCursor.period!==cursorAt(next.descriptor,time,context().endingPeriod).period)return false;
    return resolves(next.interval,time) || stop?.kind==='halftime' && contains(next.interval,time)
      && next.presentedCursor.period===stop.endingPeriod && next.presentedCursor.elapsedMs===time;
  }

  function accept(next: SessionSnapshot) {
    if (!active || identityKey(next.descriptor.identity) !== key) return;
    const state = controller.snapshot();
    const target = Math.min(state.pendingSeekMs ?? state.elapsedMs, next.descriptor.durationMs ?? Infinity);
    if (requestedCursor !== null && next.requestedCursor.period !== cursorAt(next.descriptor,requestedCursor,requestedEnding).period) return;
    if (next.loadState === 'ready' && !resolved(next, target)) return;
    snapshot = next;
    controller.setDuration(next.descriptor.durationMs);
    controller.setHorizon(next.horizonMs, next.loadState);
    notify();
  }
  function cancelDemand() {
    generation++; demand?.abort.abort(); demand = null; lastDemand = null;
  }
  function request(cursor: number, force = false) {
    if (!active || !visible) return;
    const endingPeriod=context().endingPeriod;
    if (demand?.cursor === cursor && demand.endingPeriod===endingPeriod) return;
    const token = JSON.stringify([cursor, endingPeriod, snapshot.horizonMs, snapshot.loadState]);
    if (!force && (demand || token === lastDemand)) return;
    if (controller.snapshot().pendingSeekMs === null && snapshot.loadState === 'ready' && !resolved(snapshot, cursor)) {
      // Cached horizon can extend beyond the currently resolved interval. Hold the last
      // coherent presentation while asking the adapter to resolve the new destination.
      if (controller.snapshot().stop) controller.setHorizon(snapshot.horizonMs,'buffering');
      else {
        controller.seek(lastView?.cursor.elapsedMs ?? snapshot.presentedCursor.elapsedMs);
        controller.setHorizon(snapshot.horizonMs, 'buffering'); controller.seek(cursor);
      }
    }
    cancelDemand();
    const current = { cursor, endingPeriod, abort: new AbortController(), generation };
    demand = current; lastDemand = token; requestedCursor = cursor; requestedEnding=endingPeriod;
    // Also catch synchronous adapter failures without an unhandled rejection.
    Promise.resolve().then(() => {
      if (current.abort.signal.aborted) return;
      return adapter.ensure(cursor, current.abort.signal, {
        ...context(), endingPeriod:current.endingPeriod, explicitSeek: force,
      });
    }).then(() => {
      if (!active || current.abort.signal.aborted || current.generation !== generation) return;
      demand = null;
      const next = adapter.snapshot();
      if (next.loadState !== 'ready' || resolved(next, cursor)) accept(next);
    }).catch(() => {
      if (!active || current.abort.signal.aborted || current.generation !== generation) return;
      demand = null;
      accept({ ...snapshot, loadState: 'unavailable', reason: 'Playback data could not be loaded' });
    });
  }
  function view(): SampleView | null {
    const time = controller.currentTime();
    if (snapshot.loadState === 'facts_only' || snapshot.loadState === 'unavailable') return null;
    if (!resolved(snapshot, time)) return lastView;
    const interval = snapshot.interval!;
    const frame = sampleInterval(interval, time);
    const previousTime = Math.max(0, time - 100);
    const previousInterval = contains(interval, previousTime) ? interval
      : contains(snapshot.previousInterval, previousTime) ? snapshot.previousInterval : null;
    const previous = previousInterval ? sampleInterval(previousInterval, previousTime) : frame;
    const restarting = !previousInterval || previous.period !== frame.period
      || (interval.continuousPlayers.size === 0 && !interval.continuousBall);
    lastView = { frame, previous, restarting, cue: snapshot.cue, clockMs: snapshot.clockMs,
      cursor: cursorAt(snapshot.descriptor, time, context().endingPeriod) };
    return lastView;
  }
  function tick(now: number) {
    raf = null;
    if (!active || !visible) return;
    if (now - lastPublish >= 32) {
      lastPublish = now;
      const state = controller.snapshot();
      const target = state.pendingSeekMs ?? state.elapsedMs;
      if (state.status === 'buffering' || (snapshot.loadState === 'ready' && (!resolved(snapshot, target)
          || snapshot.presentedCursor.period !== cursorAt(snapshot.descriptor,target,context().endingPeriod).period))
        || (snapshot.loadState === 'facts_only' && snapshot.presentedCursor.elapsedMs !== target)) request(target);
      notify();
    }
    if (active && visible) raf = requestAnimationFrame(tick);
  }
  return {
    controller,
    policyId:()=>policyId,
    context,
    snapshot: () => snapshot,
    view,
    mount(listener: () => void) {
      active = true; notify = listener;
      const unsubscribe = adapter.subscribe(() => {
        const next = adapter.snapshot();
        // While seeking, only the requested destination may publish a new window.
        if (requestedCursor !== null && next.requestedCursor.elapsedMs !== requestedCursor) return;
        accept(next);
      });
      return () => {
        active = false; cancelDemand();
        if (raf !== null) cancelAnimationFrame(raf);
        raf = null; unsubscribe();
        // StrictMode replays effects synchronously; it must not destroy the live adapter.
        queueMicrotask(() => { if (!active && !disposed) { disposed = true; adapter.dispose(); } });
      };
    },
    setVisible(value: boolean) {
      visible = value;
      if (!value) {
        controller.pause(); cancelDemand();
        if (raf !== null) cancelAnimationFrame(raf);
        raf = null; notify();
      } else if (active && raf === null) {
        raf = requestAnimationFrame(tick);
        if (policyId!==null || snapshot.loadState === 'buffering') request(controller.snapshot().pendingSeekMs ?? controller.currentTime());
      }
    },
    play() { if (visible) { controller.play(); notify(); } },
    pause() { controller.pause(); notify(); },
    seek(ms: number) {
      if (!visible) return;
      // Mark the window unknown first, including a backwards seek inside the old horizon.
      controller.setHorizon(snapshot.horizonMs, 'buffering'); controller.seek(ms);
      request(controller.snapshot().pendingSeekMs ?? controller.currentTime(), true); notify();
    },
    setSpeed(speed: number) { controller.setSpeed(speed); notify(); },
    setPolicy(next:PlaybackPolicy|null) {
      const changed=(next?.id??null)!==policyId;
      const before=controller.snapshot();controller.setPolicy(next);
      policyId=next?.id??null;
      if(changed) {
        const after=controller.snapshot();
        cancelDemand();
        if(before.elapsedMs!==after.elapsedMs||before.pendingSeekMs!==after.pendingSeekMs)lastView=null;
        controller.setHorizon(snapshot.horizonMs,'buffering');
        request(after.pendingSeekMs??after.elapsedMs,true);notify();
      }
    },
    continueAfterStop() {
      if(controller.snapshot().stop?.kind!=='halftime')return;
      controller.continueAfterStop();controller.setHorizon(snapshot.horizonMs,'buffering');
      request(controller.currentTime(),true);notify();
    },
    replay() { this.seek(0); this.play(); },
  };
}

export function useMatchPlayback(adapter: MatchSessionAdapter, visible: boolean, policy?: PlaybackPolicy) {
  const key = identityKey(adapter.identity);
  const playback = useMemo(() => createPlayback(adapter,policy), [key]);
  const [, update] = useReducer((n: number) => n + 1, 0);
  useEffect(() => playback.mount(update), [playback]);
  useEffect(() => { playback.setPolicy(policy??null); },[playback,policy]);
  useEffect(() => { playback.setVisible(visible); }, [playback, visible]);
  return {
    state: playback.controller.snapshot(), snapshot: playback.snapshot(), view: playback.view(),
    policyId:playback.policyId(),
    demand:playback.context(),continueAfterStop:()=>playback.continueAfterStop(),
    play: () => playback.play(), pause: () => playback.pause(), seek: (ms: number) => playback.seek(ms),
    setSpeed: (speed: number) => playback.setSpeed(speed), replay: () => playback.replay(),
  };
}
