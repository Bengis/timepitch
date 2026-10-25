import { StrictMode, useRef } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { usePitchRenderer } from './usePitchRenderer';
import { loadRenderer } from './registry';
import type { PitchRenderInput, RendererFactory, RendererFailure, RendererId } from './types';
import { syntheticFrame } from '../../match-centre/unified-fixtures';

const doubles = vi.hoisted(() => ({ instances: [] as {
  id: RendererId; canvas: HTMLCanvasElement; failure: (reason: RendererFailure) => void;
  dispose: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; resize: ReturnType<typeof vi.fn>;
}[], observers: [] as { disconnect: ReturnType<typeof vi.fn>; callback: () => void }[] }));
vi.mock('./registry', () => ({ loadRenderer: vi.fn() }));
vi.mock('./retro', () => ({ createRetroRenderer: (canvas: HTMLCanvasElement, input: PitchRenderInput, failure: (reason: RendererFailure) => void) => factory('retro-1')(canvas, input, failure) }));
function factory(id: RendererId): RendererFactory {
  return (canvas, _input, failure) => {
    const instance = { id, canvas, failure, dispose: vi.fn(), resize: vi.fn(),
      update: vi.fn(() => ({ viewport: { width: 384, height: 256 }, projectFieldPoint: () => ({ x: 20, y: 20 }) })), pickPlayer: vi.fn(() => 'test:home:1') };
    doubles.instances.push(instance); return instance;
  };
}
function deferred() { let resolve!: (value: RendererFactory) => void, reject!: (reason: Error) => void;
  const promise = new Promise<RendererFactory>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function input(): PitchRenderInput { const frame = syntheticFrame(); return { frame, previous: frame, restarting: false, selectedPlayerKey: null,
  camera: 'follow', appearance: 'daylight', detail: 'standard', labels: { home: 'H', away: 'A', clock: '00:00', goal: 'Goal' } }; }
function Host({ requested = 'retro-1', active = true, value }: { requested?: RendererId; active?: boolean; value: PitchRenderInput }) {
  const container = useRef<HTMLDivElement>(null), view = usePitchRenderer({ container, active, requested, input: value });
  return <><div ref={container} data-testid="surface" /><output data-testid="state">{view.effectiveId}:{view.status}</output>
    <button onClick={view.retry}>Retry</button><button onClick={() => view.pickPlayer({ x: 20, y: 20 })}>Pick</button></>;
}
beforeEach(() => {
  doubles.instances.length = 0; doubles.observers.length = 0; vi.mocked(loadRenderer).mockReset();
  vi.stubGlobal('ResizeObserver', class { disconnect = vi.fn(); observe = vi.fn(); constructor(callback: () => void) { doubles.observers.push({ disconnect: this.disconnect, callback }); } });
});
afterEach(() => { vi.unstubAllGlobals(); });

it('late_load_cannot_replace_new_choice; keeps old canvas while loading and uses latest input', async () => {
  const one = deferred(), two = deferred(), value = input(); vi.mocked(loadRenderer).mockReturnValueOnce(one.promise).mockReturnValueOnce(two.promise);
  const view = render(<Host value={value} />), original = screen.getByTestId('surface').querySelector('canvas');
  view.rerender(<Host value={value} requested="stylized-3d-1" />);
  expect(screen.getByTestId('state')).toHaveTextContent('retro-1:loading'); expect(screen.getByTestId('surface').querySelector('canvas')).toBe(original);
  view.rerender(<Host value={value} />); await act(async () => one.resolve(factory('stylized-3d-1')));
  expect(doubles.instances).toHaveLength(1); expect(screen.getByTestId('state')).toHaveTextContent('retro-1:ready');
  view.rerender(<Host value={value} requested="stylized-3d-1" />);
  const latest = { ...value, frame: { ...value.frame, clock_ms: 2500 } };
  view.rerender(<Host value={latest} requested="stylized-3d-1" />);
  await act(async () => two.resolve(factory('stylized-3d-1')));
  expect(screen.getByTestId('surface').querySelectorAll('canvas')).toHaveLength(1);
  expect(screen.getByTestId('surface').querySelector('canvas')).not.toBe(original);
  expect(doubles.instances[0].dispose).toHaveBeenCalledTimes(1);
  expect(doubles.instances.at(-1)!.update).toHaveBeenLastCalledWith(latest);
});

it('context_loss_falls_back_without_overwriting_preference and retry_is_explicit', async () => {
  const first = deferred(), retry = deferred(), value = input(); vi.mocked(loadRenderer).mockReturnValueOnce(first.promise).mockReturnValueOnce(retry.promise);
  const view = render(<Host value={value} requested="stylized-3d-1" />); await act(async () => first.resolve(factory('stylized-3d-1')));
  const three = doubles.instances.at(-1)!; act(() => three.failure('context_lost'));
  expect(screen.getByTestId('state')).toHaveTextContent('retro-1:fallback'); expect(three.dispose).toHaveBeenCalledTimes(1);
  view.rerender(<Host value={{ ...value, camera: 'overview' }} requested="stylized-3d-1" />);
  view.rerender(<Host value={value} requested="stylized-3d-1" active={false} />);
  view.rerender(<Host value={value} requested="stylized-3d-1" />);
  expect(loadRenderer).toHaveBeenCalledTimes(1); expect(screen.getByTestId('state')).toHaveTextContent('retro-1:fallback');
  fireEvent.click(screen.getByText('Retry')); expect(loadRenderer).toHaveBeenCalledTimes(2);
  await act(async () => retry.resolve(factory('stylized-3d-1'))); expect(screen.getByTestId('state')).toHaveTextContent('stylized-3d-1:ready');
  act(() => three.failure('context_lost')); expect(screen.getByTestId('state')).toHaveTextContent('stylized-3d-1:ready');
});

it('load rejection stays bounded until explicit retry, including StrictMode', async () => {
  vi.mocked(loadRenderer).mockRejectedValue(new Error('missing chunk'));
  const value = input(), view = render(<StrictMode><Host value={value} requested="stylized-3d-1" /></StrictMode>);
  await act(async () => {}); const calls = vi.mocked(loadRenderer).mock.calls.length;
  expect(screen.getByTestId('state')).toHaveTextContent('retro-1:fallback');
  view.rerender(<StrictMode><Host value={{ ...value, appearance: 'floodlights' }} requested="stylized-3d-1" /></StrictMode>);
  await act(async () => {}); expect(loadRenderer).toHaveBeenCalledTimes(calls);
  expect(screen.getByTestId('surface').querySelectorAll('canvas')).toHaveLength(1);
});

it('initialization callback plus throw falls back once and never retries on a frame update', async () => {
  const failedFactory = vi.fn<RendererFactory>((_canvas, _input, failure) => { failure('initialization'); throw new Error('No WebGL'); });
  vi.mocked(loadRenderer).mockResolvedValue(failedFactory);
  const value = input(), view = render(<Host value={value} requested="stylized-3d-1" />);
  await act(async () => {});
  expect(screen.getByTestId('state')).toHaveTextContent('retro-1:fallback'); expect(failedFactory).toHaveBeenCalledTimes(1);
  view.rerender(<Host value={{ ...value, frame: { ...value.frame, clock_ms: 3000 } }} requested="stylized-3d-1" />);
  expect(failedFactory).toHaveBeenCalledTimes(1); expect(screen.getByTestId('surface').querySelectorAll('canvas')).toHaveLength(1);
});

it('a failure of the retained Retro surface cannot leave Retry 3D inert', async () => {
  const one = deferred(), two = deferred(), value = input();
  vi.mocked(loadRenderer).mockReturnValueOnce(one.promise).mockReturnValueOnce(two.promise);
  const view = render(<Host value={value} requested="stylized-3d-1" />);
  act(() => doubles.instances[0].failure('context_lost'));
  expect(screen.getByTestId('state')).toHaveTextContent('failed');
  fireEvent.click(screen.getByText('Retry'));
  expect(loadRenderer).toHaveBeenCalledTimes(2);
  await act(async () => one.resolve(factory('stylized-3d-1')));
  expect(doubles.instances.filter(instance => instance.id === 'stylized-3d-1')).toHaveLength(0);
  await act(async () => two.resolve(factory('stylized-3d-1')));
  expect(screen.getByTestId('state')).toHaveTextContent('stylized-3d-1:ready');
  expect(screen.getByTestId('surface').querySelectorAll('canvas')).toHaveLength(1); view.unmount();
});

it('hidden_switch_does_not_mount and pending loads cannot resurrect an inactive canvas', async () => {
  const pending = deferred(), value = input(); vi.mocked(loadRenderer).mockReturnValue(pending.promise);
  const view = render(<Host value={value} active={false} />);
  view.rerender(<Host value={value} active={false} requested="stylized-3d-1" />);
  expect(loadRenderer).not.toHaveBeenCalled(); expect(doubles.instances).toHaveLength(0);
  view.rerender(<Host value={value} requested="stylized-3d-1" />);
  view.rerender(<Host value={value} active={false} requested="stylized-3d-1" />);
  await act(async () => pending.resolve(factory('stylized-3d-1')));
  expect(screen.getByTestId('surface').querySelectorAll('canvas')).toHaveLength(0);
  expect(doubles.instances.every(instance => instance.id === 'retro-1')).toBe(true);
});

it('strictmode_leaves_one_canvas and releases observers/resources after unmount', () => {
  const view = render(<StrictMode><Host value={input()} /></StrictMode>);
  expect(screen.getByTestId('surface').querySelectorAll('canvas')).toHaveLength(1);
  expect(doubles.instances).toHaveLength(2); expect(doubles.instances[0].dispose).toHaveBeenCalledTimes(1);
  const current = doubles.instances[1];
  act(() => doubles.observers.at(-1)!.callback()); expect(current.resize).toHaveBeenCalled();
  view.unmount();
  for (const instance of doubles.instances) expect(instance.dispose).toHaveBeenCalledTimes(1);
  for (const observer of doubles.observers) expect(observer.disconnect).toHaveBeenCalledTimes(1);
  const calls = current.update.mock.calls.length; act(() => doubles.observers.at(-1)!.callback()); expect(current.update).toHaveBeenCalledTimes(calls);
});
