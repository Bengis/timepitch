import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createRetroRenderer } from './retro';
import { loadRenderer } from './registry';
import type { PitchProjection, PitchRenderer, PitchRenderInput, RendererFactory, RendererId, ScreenPoint } from './types';

type Status = 'loading' | 'ready' | 'fallback' | 'failed';
type Mounted = { id: RendererId; canvas: HTMLCanvasElement; renderer: PitchRenderer | null; disposed: boolean; size?: string };
type View = { effectiveId: RendererId | null; status: Status; projection: PitchProjection | null; artFailed: boolean };

/** Owns only drawing resources. Source/controller state never enters the lifecycle dependencies. */
export function usePitchRenderer({ container, active, requested, input }: {
  container: RefObject<HTMLDivElement | null>; active: boolean; requested: RendererId; input: PitchRenderInput;
}) {
  const latest = useRef(input), desired = useRef(requested), priorRequest = useRef(requested);
  const current = useRef<Mounted | null>(null), alive = useRef(false), generation = useRef(0), lifetime = useRef(0);
  const failedRequest = useRef(false), status = useRef<Status>('ready'), projection = useRef<PitchProjection | null>(null), artFailed = useRef(false);
  const [view, setView] = useState<View>({ effectiveId: null, status: 'loading', projection: null, artFailed: false });
  const [attempt, setAttempt] = useState(0);
  function publish() { setView({ effectiveId: current.current?.id ?? null, status: status.current, projection: projection.current, artFailed: artFailed.current }); }
  function retire(instance: Mounted | null) {
    if (!instance || instance.disposed) return;
    instance.disposed = true;
    try { instance.renderer?.dispose(); } finally { instance.canvas.remove(); }
  }
  function applySize(instance: Mounted) {
    const box = container.current?.getBoundingClientRect(), width = box?.width || 384, height = box?.height || 256;
    const dpr = Number.isFinite(window.devicePixelRatio) && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
    const size = `${width}:${height}:${dpr}`;
    if (instance.size === size) return false;
    instance.renderer!.resize({ width, height }, dpr); instance.size = size; return true;
  }
  function mount(factory: RendererFactory, id: RendererId, nextStatus: Status) {
    const canvas = document.createElement('canvas'); canvas.dataset.renderer = id;
    const instance: Mounted = { id, canvas, renderer: null, disposed: false };
    let constructing = true, initialFailure: string | null = null;
    try {
      instance.renderer = factory(canvas, latest.current, reason => {
        if (constructing) { initialFailure = reason; return; }
        if (!alive.current || current.current !== instance || instance.disposed) return;
        if (id === 'retro-1' && reason === 'assets') { artFailed.current = true; publish(); }
        else fail(instance);
      });
      applySize(instance);
      const nextProjection = instance.renderer.update(latest.current);
      if (initialFailure && !(id === 'retro-1' && initialFailure === 'assets')) throw new Error('Renderer initialization failed');
      const previous = current.current;
      current.current = instance; projection.current = nextProjection; status.current = nextStatus;
      artFailed.current = initialFailure === 'assets'; constructing = false;
      canvas.dataset.camera = latest.current.camera;
      container.current!.append(canvas); retire(previous); publish();
    } catch (error) { retire(instance); throw error; }
  }
  function retro(nextStatus: Status) {
    try {
      if (current.current?.id === 'retro-1') { status.current = nextStatus; redraw(false); }
      else mount(createRetroRenderer, 'retro-1', nextStatus);
    } catch { retire(current.current); current.current = null; projection.current = null; status.current = 'failed'; publish(); }
  }
  function fail(instance: Mounted) {
    if (current.current !== instance) return;
    generation.current++;
    // Cualquier gráfico elegido (3D o Retro 16 bits) que falle cae al respaldo `retro-1` (TP205, TP220).
    if (instance.id !== 'retro-1') { failedRequest.current = true; retro('fallback'); }
    else {
      if (desired.current !== 'retro-1') failedRequest.current = true;
      retire(instance); current.current = null; projection.current = null; status.current = 'failed'; publish();
    }
  }
  function redraw(resize: boolean) {
    const instance = current.current;
    if (!alive.current || !instance?.renderer || instance.disposed) return;
    try {
      if (resize && !applySize(instance)) return;
      const next = instance.renderer.update(latest.current);
      if (current.current !== instance || instance.disposed) return;
      instance.canvas.dataset.camera = latest.current.camera; projection.current = next; publish();
    } catch { fail(instance); }
  }
  useLayoutEffect(() => {
    latest.current = input; desired.current = requested;
    if (priorRequest.current !== requested) { failedRequest.current = false; priorRequest.current = requested; }
    redraw(false);
  }, [input, requested]);
  useLayoutEffect(() => {
    if (!active || !container.current) { projection.current = null; publish(); return; }
    alive.current = true; const epoch = ++lifetime.current;
    retro(failedRequest.current && requested !== 'retro-1' ? 'fallback' : 'ready');
    const resize = () => { if (alive.current && epoch === lifetime.current) redraw(true); };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
    observer?.observe(container.current); window.addEventListener('resize', resize);
    return () => {
      alive.current = false; generation.current++; lifetime.current++;
      observer?.disconnect(); window.removeEventListener('resize', resize);
      const previous = current.current; current.current = null; projection.current = null; retire(previous);
    };
  }, [active]);
  useLayoutEffect(() => {
    const ticket = ++generation.current;
    if (!active || !alive.current) return;
    if (requested === 'retro-1') { retro('ready'); return; }
    if (failedRequest.current) { retro('fallback'); return; }
    if (current.current?.id === requested) { status.current = 'ready'; publish(); return; }
    status.current = 'loading'; publish();
    const valid = () => alive.current && ticket === generation.current;
    void loadRenderer(requested).then(factory => {
      if (!valid()) return;
      try { mount(factory, requested, 'ready'); }
      catch { if (valid()) { failedRequest.current = true; retro('fallback'); } }
    }, () => { if (valid()) { failedRequest.current = true; retro('fallback'); } });
    return () => { if (ticket === generation.current) generation.current++; };
  }, [active, requested, attempt]);
  const pickPlayer = useCallback((point: ScreenPoint) => alive.current ? current.current?.renderer?.pickPlayer(point) ?? null : null, []);
  const retry = useCallback(() => { if (desired.current !== 'retro-1' && failedRequest.current) { failedRequest.current = false; setAttempt(value => value + 1); } }, []);
  return { ...view, pickPlayer, retry };
}
