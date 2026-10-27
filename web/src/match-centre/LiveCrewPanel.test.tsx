import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LiveCrewPanel } from './LiveCrewPanel';

// TP253: crónica IA en vivo. El servidor hace el trabajo; el panel pide una vez al acabar, consulta y muestra.
const ready = { status: 'ready', report: { trace_hash: 't', locale: 'en', engine: 'touchlines', headline: 'Home Town win 2–1',
  paragraphs: [['First sentence.', 'Second.']], coverage_notes: ['Fictional cross-era simulation: this match never took place.'],
  model: 'gpt-4.1-mini', total_cost: '0.004115', report_sha256: 'r', provenance: 'crew_ai_draft_checked', evaluation: null } };

function server(responses: Record<string, unknown[]>) {
  const calls: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input), key = `${init?.method ?? 'GET'} ${url.split('?')[0]}`;
    calls.push(key);
    const queue = responses[key] ?? [];
    const next = queue.length > 1 ? queue.shift() : queue[0];
    const [status, body] = next as [number, unknown];
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  });
  return calls;
}

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

it('keeps the live story and simulation warning visible while technical details start closed', async () => {
  const calls = server({ 'GET /api/crew/live/status': [[200, { available: true }]], 'GET /api/crew/live': [[200, ready]] });
  render(<LiveCrewPanel engine="grf" matchId="g-1" locale="en" ended />);
  expect(await screen.findByText('First sentence. Second.')).toBeVisible();
  expect(screen.getByText(/Fictional cross-era simulation/)).toBeVisible();
  const cost = screen.getByText(/0\.0041 USD/), details = cost.closest('details');
  expect(details).not.toBeNull();
  expect(details).not.toHaveAttribute('open');
  expect(cost).not.toBeVisible();
  expect(screen.getByText(/do not guarantee the interpretation/)).toBeVisible();
  fireEvent.click(details!.querySelector('summary')!);
  expect(cost).toBeVisible();
  expect(calls).toEqual(['GET /api/crew/live/status', 'GET /api/crew/live']);
});

it('keeps the factual fallback warning visible outside technical details', async () => {
  server({ 'GET /api/crew/live/status': [[200, { available: true }]], 'GET /api/crew/live': [[200,
    { ...ready, report: { ...ready.report, provenance: 'crew_fact_fallback' } }]] });
  render(<LiveCrewPanel engine="grf" matchId="g-1" locale="en" ended />);
  expect(await screen.findByText(/AI draft did not pass the fact check/)).toBeVisible();
});

it('reports half-time and full-time capabilities only after live reports are confirmed available', async () => {
  const onAvailability = vi.fn();
  let enable!: (response: Response) => void;
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => await new Promise<Response>(resolve => { enable = resolve; }));
  const view = render(<LiveCrewPanel engine="grf" matchId="g-1" locale="en" ended={false} onAvailability={onAvailability} />);
  expect(onAvailability).toHaveBeenLastCalledWith({ halfTime: false, fullTime: false });
  await act(async () => { enable(new Response(JSON.stringify({ available: true }))); });
  expect(onAvailability).toHaveBeenLastCalledWith({ halfTime: true, fullTime: true });
  view.rerender(<LiveCrewPanel engine="grf" matchId="g-1" locale="es" ended={false} onAvailability={onAvailability} />);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher).toHaveBeenCalledWith('/api/crew/live/status', expect.objectContaining({ credentials: 'same-origin' }));
});

it.each([
  ['disabled', () => Promise.resolve(new Response(JSON.stringify({ available: false })))],
  ['failed', () => Promise.reject(new Error('offline'))],
] as const)('reports no live capabilities when status is %s', async (_name, response) => {
  const onAvailability = vi.fn();
  vi.spyOn(globalThis, 'fetch').mockImplementation(response);
  const view = render(<LiveCrewPanel engine="grf" matchId="g-1" locale="en" ended onAvailability={onAvailability} />);
  await act(async () => { await Promise.resolve(); });
  expect(onAvailability).toHaveBeenLastCalledWith({ halfTime: false, fullTime: false });
  expect(onAvailability).not.toHaveBeenCalledWith({ halfTime: true, fullTime: true });
  expect(view.container).toBeEmptyDOMElement();
});

it('stops an exhausted report lookup visibly and checks the existing request again without another POST', async () => {
  const lookups: unknown[] = [[200, { status: 'none' }], [200, { status: 'pending' }]];
  const calls = server({ 'GET /api/crew/live/status': [[200, { available: true }]],
    'GET /api/crew/live': lookups,
    'POST /api/crew/live': [[202, { status: 'pending', request_hash: 'h' }]] });
  vi.useFakeTimers();
  const view = render(<LiveCrewPanel engine="touchlines" matchId="tl-1" locale="en" ended />);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  await act(async () => { await vi.advanceTimersByTimeAsync(300_000); });
  expect(screen.getByText(/Automatic checks are paused/)).toBeInTheDocument();
  expect(screen.getByText(/Last checked/)).toBeInTheDocument();
  expect(view.container.querySelector('[aria-busy="true"]')).toBeNull();
  const count = calls.filter(c => c === 'GET /api/crew/live').length;
  await act(async () => { await vi.advanceTimersByTimeAsync(12_000); });
  expect(calls.filter(c => c === 'GET /api/crew/live')).toHaveLength(count);
  // Even a lagging lookup reporting 'none' must not resubmit the job already accepted by POST.
  lookups.splice(0, lookups.length, [200, { status: 'none' }]);
  fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(calls.filter(c => c === 'GET /api/crew/live')).toHaveLength(count + 1);
  expect(calls.filter(c => c === 'POST /api/crew/live')).toHaveLength(1);
  expect(screen.queryByText(/Automatic checks are paused/)).toBeNull();
  lookups.splice(0, lookups.length, [200, ready]);
  await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
  expect(screen.getByRole('heading', { name: 'Home Town win 2–1' })).toBeInTheDocument();
});

it('keeps a new match idle instead of reusing the previous match half-time activation', async () => {
  const calls = server({ 'GET /api/crew/live/status': [[200, { available: true }]], 'GET /api/crew/live': [[200, ready]] });
  const view = render(<LiveCrewPanel engine="grf" matchId="old" locale="en" ended={false} halfTime />);
  expect(await screen.findByRole('heading', { name: 'Home Town win 2–1' })).toBeInTheDocument();
  const before = calls.length;
  view.rerender(<LiveCrewPanel engine="grf" matchId="new" locale="en" ended={false} />);
  await act(async () => { await Promise.resolve(); });
  expect(screen.queryByRole('heading', { name: 'Home Town win 2–1' })).toBeNull();
  expect(screen.getByText(/At half-time and when the match ends/)).toBeInTheDocument();
  expect(calls).toHaveLength(before);
});

it('aborts an outstanding live report lookup when its panel unmounts', async () => {
  let signal: AbortSignal | null | undefined;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (String(input).endsWith('/status')) return new Response(JSON.stringify({ available: true }));
    signal = init?.signal;
    return await new Promise<Response>(() => {});
  });
  const view = render(<LiveCrewPanel engine="grf" matchId="g-1" locale="en" ended />);
  await waitFor(() => expect(signal).toBeDefined());
  view.unmount();
  expect(signal?.aborted).toBe(true);
});

it('preserves the match, locale, names and audience in separate half-time and full-time requests', async () => {
  const posts: unknown[] = [], queries: URLSearchParams[] = [];
  const accepted = new Set<string>();
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith('/status')) return new Response(JSON.stringify({ available: true }));
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      posts.push(body); accepted.add(body.period);
      return new Response(JSON.stringify({ status: 'pending', request_hash: `hash-${body.period}` }), { status: 202 });
    }
    const params = new URL(url, 'http://test').searchParams;
    queries.push(params);
    return new Response(JSON.stringify(accepted.has(params.get('period')!) ? ready : { status: 'none' }));
  });
  const view = render(<LiveCrewPanel engine="grf" matchId="g / 1" locale="es" ended={false} halfTime />);
  await waitFor(() => expect(posts).toHaveLength(1));
  view.rerender(<LiveCrewPanel engine="grf" matchId="g / 1" locale="es" ended halfTime />);
  await waitFor(() => expect(posts).toHaveLength(2));
  expect(posts).toEqual([
    { engine: 'grf', match_id: 'g / 1', locale: 'es', names: 'real', audience: 'fan', period: 'half_time' },
    { engine: 'grf', match_id: 'g / 1', locale: 'es', names: 'real', audience: 'fan', period: 'full_time' },
  ]);
  expect(queries.map(p => Object.fromEntries(p))).toEqual(posts);
  expect(screen.queryByText(/El visitante no dispara ninguna llamada/)).toBeNull();
});

it('aborts the previous match lookup and ignores its late report', async () => {
  let resolveOld!: (r: Response) => void;
  let oldSignal: AbortSignal | null | undefined;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith('/status')) return new Response(JSON.stringify({ available: true }));
    if (url.includes('match_id=old')) {
      oldSignal = init?.signal;
      return await new Promise<Response>(resolve => { resolveOld = resolve; });
    }
    return new Response(JSON.stringify({ ...ready, report: { ...ready.report, headline: 'New match report' } }));
  });
  const view = render(<LiveCrewPanel engine="grf" matchId="old" locale="en" ended />);
  await waitFor(() => expect(resolveOld).toBeDefined());
  view.rerender(<LiveCrewPanel engine="grf" matchId="new" locale="en" ended />);
  expect(await screen.findByRole('heading', { name: 'New match report' })).toBeInTheDocument();
  expect(oldSignal?.aborted).toBe(true);
  await act(async () => { resolveOld(new Response(JSON.stringify(ready))); });
  expect(screen.queryByRole('heading', { name: 'Home Town win 2–1' })).toBeNull();
  view.unmount();
});

it('shows nothing when live reports are not enabled on the server', async () => {
  server({ 'GET /api/crew/live/status': [[200, { available: false, remaining: null }]] });
  const { container } = render(<LiveCrewPanel engine="grf" matchId="physical-1" locale="en" ended />);
  await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
  expect(container).toBeEmptyDOMElement();
});

it('before the end it says what will happen; at the end it requests once, waits and shows the checked report', async () => {
  const calls = server({ 'GET /api/crew/live/status': [[200, { available: true, remaining: 40 }]],
    'GET /api/crew/live': [[200, { status: 'none' }], [200, { status: 'pending' }], [200, ready]],
    'POST /api/crew/live': [[202, { status: 'pending', request_hash: 'h' }]] });
  const view = render(<LiveCrewPanel engine="touchlines" matchId="tl-1" locale="en" ended={false} />);
  expect(await screen.findByText(/At half-time and when the match ends, AI agents on Azure will write a report/)).toBeInTheDocument();
  expect(calls.filter(c => c.startsWith('POST'))).toHaveLength(0);
  vi.useFakeTimers({ shouldAdvanceTime: true });
  view.rerender(<LiveCrewPanel engine="touchlines" matchId="tl-1" locale="en" ended />);
  expect(await screen.findByText(/Report requested on Azure/)).toBeInTheDocument();
  await vi.advanceTimersByTimeAsync(13_000);
  expect(await screen.findByRole('heading', { name: 'Home Town win 2–1' })).toBeInTheDocument();
  expect(screen.getByText('First sentence. Second.')).toBeInTheDocument();
  expect(screen.getByText(/checked line by line against the match data/)).toBeInTheDocument();
  expect(screen.getByText(/· 0\.0041 USD/)).toBeInTheDocument();
  expect(calls.filter(c => c === 'POST /api/crew/live')).toHaveLength(1);
});

it('explains the limits instead of failing silently', async () => {
  server({ 'GET /api/crew/live/status': [[200, { available: true, remaining: 0 }]], 'GET /api/crew/live': [[200, { status: 'none' }]],
    'POST /api/crew/live': [[429, { detail: 'budget_exhausted' }]] });
  render(<LiveCrewPanel engine="grf" matchId="physical-1" locale="es" ended />);
  expect(await screen.findByText('Se ha agotado el presupuesto de crónicas IA de la demo.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Reintentar' })).toBeNull();
});

it('at half-time it asks for the first-half report, and keeps it under the full-time one', async () => {
  const half = { ...ready, report: { ...ready.report, headline: 'At the break Home Town lead 1–0', report_sha256: 'h1' } };
  const posts: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.startsWith('/api/crew/live/status')) return new Response(JSON.stringify({ available: true, remaining: 40 }), { status: 200 });
    if (init?.method === 'POST') { posts.push(JSON.parse(String(init.body)).period); return new Response('{}', { status: 202 }); }
    const period = new URL(url, 'http://x').searchParams.get('period');
    return new Response(JSON.stringify(period === 'half_time' ? half : ready), { status: 200 });
  });
  const view = render(<LiveCrewPanel engine="grf" matchId="g-1" locale="en" ended={false} halfTime />);
  expect(await screen.findByRole('heading', { name: 'At the break Home Town lead 1–0' })).toBeInTheDocument();
  expect(screen.getByText('Half-time report')).toBeInTheDocument();
  view.rerender(<LiveCrewPanel engine="grf" matchId="g-1" locale="en" ended halfTime />);
  expect(await screen.findByRole('heading', { name: 'Home Town win 2–1' })).toBeInTheDocument();
  expect(screen.getByText('Full-time report')).toBeInTheDocument();
  expect(screen.getByText('Half-time report', { selector: 'summary' })).toBeInTheDocument();
  expect(posts).toEqual([]);
});
