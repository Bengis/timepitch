import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MatchCentre } from './MatchCentre';
import { screenFixture } from './unified-screen-fixtures';
import type { useMatchPlayback } from './useMatchPlayback';
import { useEffect } from 'react';
import type { MatchCentreProps } from './MatchCentre';
import type {ReplayAudioSource} from './narration/ReplayAudio';

type ReportContext = Parameters<NonNullable<MatchCentreProps['sideReport']>>[0];
function AvailableReport({ context, half = true, full = true }: { context: ReportContext; half?: boolean; full?: boolean }) {
  useEffect(() => context.onAvailability({ halfTime: half, fullTime: full }), [context.onAvailability, half, full]);
  return <section data-crew-report>{context.halfTime ? 'Half-time facts only' : 'Waiting'}{context.revealed ? ' FINAL FACTS' : ''}</section>;
}

const boundary = vi.hoisted(() => ({ current: null as unknown as ReturnType<typeof useMatchPlayback> }));
vi.mock('./useMatchPlayback', () => ({ useMatchPlayback: () => boundary.current }));
vi.mock('../match/Pitch', () => ({ Pitch: ({ overlay }: { overlay?: React.ReactNode }) => <div className="retro-field" data-testid="field">{overlay}</div> }));
afterEach(() => vi.restoreAllMocks());

it('shows the verified speech half-time marker while the held physical frame is still in period one',()=>{
  const fixture=screenFixture('timepitch');
  boundary.current={state:{elapsedMs:5000,pendingSeekMs:null,speed:1,wantsPlay:false,isPlaying:false,isMatchEnd:false,status:'paused',stop:{kind:'halftime',atMs:5000,endingPeriod:1}},
    snapshot:{...fixture.initial,presentedCursor:{elapsedMs:4900,period:1,periodMs:4900}},view:null,demand:{},policyId:'match-highlights-1',
    play:vi.fn(),pause:vi.fn(),seek:vi.fn(),setSpeed:vi.fn(),replay:vi.fn(),continueAfterStop:vi.fn(),
  } as unknown as ReturnType<typeof useMatchPlayback>;
  render(<MatchCentre adapter={fixture.adapter} visible onBack={()=>{}} savedAudio={{manifestUrl:'/speech-preview/manifest.json',expectedSource:{}} as ReplayAudioSource}/>);
  expect(screen.getByRole('dialog',{name:'Half-time'})).toBeInTheDocument();
  expect(document.querySelector('[data-speech-marker="halftime"]')).toHaveTextContent('Half-time.');
  expect(boundary.current.snapshot.presentedCursor.elapsedMs).toBe(4900);
});
it('does not create a second manual half-time after the highlight policy has resumed across its boundary',()=>{
  const fixture=screenFixture('timepitch'),pause=vi.fn();
  boundary.current={state:{elapsedMs:4900,pendingSeekMs:null,speed:1,wantsPlay:true,isPlaying:true,isMatchEnd:false,status:'playing'},
    snapshot:{...fixture.initial,presentedCursor:{elapsedMs:4900,period:1,periodMs:4900}},view:null,demand:{},policyId:'match-highlights-1',
    play:vi.fn(),pause,seek:vi.fn(),setSpeed:vi.fn(),replay:vi.fn(),continueAfterStop:vi.fn(),
  } as unknown as ReturnType<typeof useMatchPlayback>;
  const props={adapter:fixture.adapter,visible:true,onBack:()=>{}};const mount=render(<MatchCentre {...props}/>);
  boundary.current={...boundary.current,state:{...boundary.current.state,elapsedMs:5001},snapshot:{...fixture.initial,presentedCursor:{elapsedMs:5001,period:2,periodMs:1}}};
  mount.rerender(<MatchCentre {...props}/>);expect(pause).not.toHaveBeenCalled();expect(screen.queryByRole('dialog',{name:'Half-time'})).toBeNull();
});

it('keeps the ordinary phase card out of the historical boundary-check sequence',()=>{
  const fixture=screenFixture('historical');
  boundary.current={state:{elapsedMs:5000,pendingSeekMs:null,speed:1,wantsPlay:false,isPlaying:false,isMatchEnd:false,status:'paused',stop:{kind:'halftime',atMs:5000,endingPeriod:1}},
    snapshot:{...fixture.initial,presentedCursor:{elapsedMs:5000,period:1,periodMs:5000}},view:null,demand:{},policyId:'halftime-check-1',
    play:vi.fn(),pause:vi.fn(),seek:vi.fn(),setSpeed:vi.fn(),replay:vi.fn(),continueAfterStop:vi.fn(),
  } as unknown as ReturnType<typeof useMatchPlayback>;
  render(<MatchCentre adapter={fixture.adapter} visible onBack={()=>{}} sequence={{kind:'boundary-check',policy:{id:'halftime-check-1',fromMs:0,toMs:10000,speeds:[1],pauseAt:[{atMs:5000,endingPeriod:1}]}}}/>);
  expect(screen.queryByRole('dialog',{name:'Half-time'})).toBeNull();
});

it('shows the final phase when a montage reaches its terminal stop without an intermediate playing render',async()=>{
  const fixture=screenFixture('timepitch');
  boundary.current={state:{elapsedMs:10000,pendingSeekMs:null,speed:1,wantsPlay:false,isPlaying:false,isMatchEnd:true,status:'paused',stop:{kind:'clip-end',atMs:10000}},
    snapshot:{...fixture.initial,presentedCursor:{elapsedMs:10000,period:2,periodMs:5000}},view:null,demand:{},policyId:'match-highlights-1',
    play:vi.fn(),pause:vi.fn(),seek:vi.fn(),setSpeed:vi.fn(),replay:vi.fn(),continueAfterStop:vi.fn(),
  } as unknown as ReturnType<typeof useMatchPlayback>;
  render(<MatchCentre adapter={fixture.adapter} visible onBack={()=>{}}/>);
  expect(await screen.findByRole('dialog',{name:'Full-time'})).toBeInTheDocument();
});

it('directs full-time to one report host and a collapsed replay that can be reopened without resetting it',async()=>{
  const fixture=screenFixture('timepitch');
  boundary.current={state:{elapsedMs:0,pendingSeekMs:null,speed:1,wantsPlay:false,isPlaying:false,isMatchEnd:false,status:'paused'},
    snapshot:fixture.initial,view:null,demand:{},policyId:null,play:vi.fn(),pause:vi.fn(),seek:vi.fn(),setSpeed:vi.fn(),replay:vi.fn(),continueAfterStop:vi.fn(),
  } as unknown as ReturnType<typeof useMatchPlayback>;
  const props={adapter:fixture.adapter,visible:true,onBack:vi.fn(),sideReport:(context:ReportContext)=><AvailableReport context={context}/>};
  const mount=render(<MatchCentre {...props}/>),host=document.querySelector('[data-side-report]');
  expect(host).not.toBeVisible();
  boundary.current={...boundary.current,state:{...boundary.current.state,elapsedMs:10000,isMatchEnd:true,status:'ended',wantsPlay:false},snapshot:{...fixture.initial,presentedCursor:{elapsedMs:10000,period:2,periodMs:5000}}};
  mount.rerender(<MatchCentre {...props}/>);
  await screen.findByRole('dialog',{name:'Full-time'});
  fireEvent.click(screen.getByRole('button',{name:/Read the AI match report/}));
  expect(host).toBeVisible();expect(document.querySelector('[data-side-report]')).toBe(host);
  expect(document.querySelector('[data-director-field]')).not.toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'Show replay'}));
  expect(document.querySelector('[data-director-field]')).toBeVisible();
  expect(boundary.current.replay).not.toHaveBeenCalled();
  expect(document.querySelectorAll('[data-side-report]')).toHaveLength(1);
  boundary.current={...boundary.current,state:{...boundary.current.state,elapsedMs:3000,isMatchEnd:false,status:'paused'},snapshot:{...fixture.initial,presentedCursor:{elapsedMs:3000,period:1,periodMs:3000}}};
  mount.rerender(<MatchCentre {...props}/>);
  expect(host).toBeVisible();
  expect(host).toHaveTextContent('FINAL FACTS');
  expect(document.querySelector('[data-unified-match-centre]')).toHaveAttribute('data-director-phase','fulltime');
  fireEvent.click(screen.getByRole('button',{name:'Hide replay'}));
  expect(document.querySelector('[data-director-field]')).not.toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'Show replay'}));
  expect(document.querySelector('[data-side-report]')).toBe(host);
  expect(boundary.current.replay).not.toHaveBeenCalled();
  expect(boundary.current.seek).not.toHaveBeenCalled();
});

it('hides technical event/data panels and display settings from the match screen', () => {
  const fixture=screenFixture('timepitch');
  boundary.current = {state:{elapsedMs:0,pendingSeekMs:null,speed:1,wantsPlay:false,isPlaying:false,isMatchEnd:false,status:'paused'},
    snapshot:fixture.initial,view:null,demand:{},policyId:null,play:vi.fn(),pause:vi.fn(),seek:vi.fn(),setSpeed:vi.fn(),replay:vi.fn(),continueAfterStop:vi.fn(),
  } as unknown as ReturnType<typeof useMatchPlayback>;
  const {container}=render(<MatchCentre adapter={fixture.adapter} visible onBack={()=>{}}/>);
  expect(screen.getByText('Technical event log')).not.toBeVisible();
  expect(screen.getByText('Technical details')).not.toBeVisible();
  expect(container.querySelector('.tp-pitch-settings-host')).not.toBeVisible();
});

it('keeps one scoreboard above the full-width field on a short desktop without a fit observer', () => {
  const observers: Element[] = [];
  vi.stubGlobal('ResizeObserver', class {
    observe(target: Element) { observers.push(target); }
    disconnect() {}
  });
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1280);
  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(720);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1200);
  try {
    const fixture = screenFixture('timepitch');
    boundary.current = { state: { elapsedMs: 0, pendingSeekMs: null, speed: 1, wantsPlay: false, isPlaying: false, isMatchEnd: false, status: 'paused' },
      snapshot: fixture.initial, view: null, demand: {}, policyId: null, play: vi.fn(), pause: vi.fn(), seek: vi.fn(), setSpeed: vi.fn(), replay: vi.fn(), continueAfterStop: vi.fn(),
    } as unknown as ReturnType<typeof useMatchPlayback>;
    render(<MatchCentre adapter={fixture.adapter} visible onBack={() => {}} />);
    const centre = document.querySelector('[data-unified-match-centre]')!;
    const scoreboard = document.querySelector('[data-unified-scoreboard]')!;
    expect(scoreboard.parentElement).toBe(centre);
    expect(document.querySelectorAll('[data-unified-scoreboard]')).toHaveLength(1);
    expect(scoreboard.compareDocumentPosition(screen.getByTestId('field')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(observers).not.toContain(centre);
    expect(centre).not.toHaveAttribute('data-fit');
    expect((centre as HTMLElement).style.getPropertyValue('--tp-fit-h')).toBe('');
    act(() => { window.dispatchEvent(new Event('resize')); });
    expect(document.querySelector('[data-unified-scoreboard]')).toBe(scoreboard);
    expect(screen.getByRole('slider')).toBeInTheDocument();
  } finally { vi.unstubAllGlobals(); }
});

it('opens the half-time report in place without revealing final facts or requesting final analysis', async () => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline boundary fixture'));
  const fixture = screenFixture('timepitch');
  boundary.current = {
    state: { elapsedMs: 4900, pendingSeekMs: null, speed: 1, wantsPlay: true, isPlaying: true, isMatchEnd: false, status: 'playing' },
    snapshot: { ...fixture.initial, presentedCursor: { elapsedMs: 4900, period: 1, periodMs: 4900 } },
    view: null, demand: {}, policyId: null, play: vi.fn(), pause: vi.fn(), seek: vi.fn(), setSpeed: vi.fn(), replay: vi.fn(), continueAfterStop: vi.fn(),
  } as unknown as ReturnType<typeof useMatchPlayback>;
  const side = vi.fn((context: ReportContext) => <AvailableReport context={context} />);
  const props = { adapter: fixture.adapter, visible: true, onBack: vi.fn(), sideReport: side };
  const view = render(<MatchCentre {...props} />);
  const reportElement = document.querySelector('[data-crew-report]');
  boundary.current = { ...boundary.current, state: { ...boundary.current.state, elapsedMs: 5000 },
    snapshot: { ...fixture.initial, presentedCursor: { elapsedMs: 5000, period: 2, periodMs: 0 } } };
  view.rerender(<MatchCentre {...props} />);
  expect(await screen.findByRole('dialog', { name: 'Half-time' })).toBeInTheDocument();
  expect(document.querySelector('[data-unified-scoreboard] .tp-sb-t')).toHaveTextContent('Half-time');
  expect(document.querySelector('[data-unified-scoreboard] .tp-sb-half')).toBeNull();
  expect(boundary.current.snapshot.presentedCursor.period).toBe(2);
  fireEvent.click(screen.getByRole('button', { name: /Read the half-time report/ }));
  expect(screen.queryByRole('dialog', { name: 'Half-time' })).toBeNull();
  expect(screen.getByText('Half-time facts only')).toBeInTheDocument();
  expect(document.querySelector('[data-crew-report]')).toBe(reportElement);
  expect(document.querySelectorAll('[data-side-report]')).toHaveLength(1);
  expect(screen.queryByText(/FINAL FACTS/)).toBeNull();
  expect(document.querySelector('[data-side-report]')).toHaveFocus();
  expect(document.querySelector('[data-unified-match-centre]')).toHaveAttribute('data-side-priority', 'report');
  expect(document.querySelector('[data-unified-scoreboard] .tp-sb-t')).toHaveTextContent('Half-time');
  await waitFor(() => expect(fixture.adapter.loadPanel).toHaveBeenCalled());
  expect(vi.mocked(fixture.adapter.loadPanel).mock.calls.every(call => call[2] === false)).toBe(true);
  expect(side.mock.calls.at(-1)?.[0]).toMatchObject({ revealed: false, halfTime: true });
  expect(new Set(side.mock.calls.map(([context]) => context.onAvailability)).size).toBe(1);
  fireEvent.change(screen.getByRole('slider'), { target: { value: '8000' } });
  expect(document.querySelector('[data-unified-scoreboard] .tp-sb-t')).not.toHaveTextContent('Half-time');
});

it('transport Play resumes a policy half-time after the report has replaced its phase card',async()=>{
  const fixture=screenFixture('timepitch');
  boundary.current={state:{elapsedMs:5000,pendingSeekMs:null,speed:1,wantsPlay:false,isPlaying:false,isMatchEnd:false,status:'paused',stop:{kind:'halftime',atMs:5000,endingPeriod:1}},
    snapshot:{...fixture.initial,presentedCursor:{elapsedMs:5000,period:1,periodMs:5000}},view:null,demand:{},policyId:'match-highlights-1',
    play:vi.fn(),pause:vi.fn(),seek:vi.fn(),setSpeed:vi.fn(),replay:vi.fn(),continueAfterStop:vi.fn(),
  } as unknown as ReturnType<typeof useMatchPlayback>;
  render(<MatchCentre adapter={fixture.adapter} visible onBack={()=>{}} sideReport={context=><AvailableReport context={context}/>}/>);
  await screen.findByRole('dialog',{name:'Half-time'});
  fireEvent.click(screen.getByRole('button',{name:/Read the half-time report/}));
  fireEvent.click(screen.getByRole('button',{name:'Play'}));
  expect(boundary.current.continueAfterStop).toHaveBeenCalledOnce();
});

it.each([{ name: 'static final-only report', full: true }, { name: 'unavailable live AI', full: false }])('uses declared availability for $name without promising a half-time report', async ({ full }) => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline boundary fixture'));
  const fixture = screenFixture('timepitch');
  boundary.current = {
    state: { elapsedMs: 4900, pendingSeekMs: null, speed: 1, wantsPlay: true, isPlaying: true, isMatchEnd: false, status: 'playing' },
    snapshot: { ...fixture.initial, presentedCursor: { elapsedMs: 4900, period: 1, periodMs: 4900 } },
    view: null, demand: {}, policyId: null, play: vi.fn(), pause: vi.fn(), seek: vi.fn(), setSpeed: vi.fn(), replay: vi.fn(), continueAfterStop: vi.fn(),
  } as unknown as ReturnType<typeof useMatchPlayback>;
  const props = { adapter: fixture.adapter, visible: true, onBack: vi.fn(), sideReport: (context: ReportContext) => <AvailableReport context={context} half={false} full={full} /> };
  const view = render(<MatchCentre {...props} />);
  boundary.current = { ...boundary.current, state: { ...boundary.current.state, elapsedMs: 5000 }, snapshot: { ...fixture.initial, presentedCursor: { elapsedMs: 5000, period: 2, periodMs: 0 } } };
  view.rerender(<MatchCentre {...props} />);
  expect(await screen.findByRole('dialog', { name: 'Half-time' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Read the half-time report/ })).toBeNull();
  boundary.current = { ...boundary.current, state: { ...boundary.current.state, elapsedMs: 10000, isMatchEnd: true, wantsPlay: false, status: 'ended' }, snapshot: { ...fixture.initial, presentedCursor: { elapsedMs: 10000, period: 2, periodMs: 5000 } } };
  view.rerender(<MatchCentre {...props} />);
  expect(await screen.findByRole('dialog', { name: 'Full-time' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: full ? /Read the AI match report/ : 'Analyse the match' })).toHaveClass('tp-break-primary');
  if (!full) expect(screen.queryByRole('button', { name: /Read the AI match report/ })).toBeNull();
});
