import { render, screen, waitFor } from '@testing-library/react';
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
  expect(await screen.findByText(/When the match ends, AI agents on Azure will write its report/)).toBeInTheDocument();
  expect(calls.filter(c => c.startsWith('POST'))).toHaveLength(0);
  vi.useFakeTimers({ shouldAdvanceTime: true });
  view.rerender(<LiveCrewPanel engine="touchlines" matchId="tl-1" locale="en" ended />);
  expect(await screen.findByText(/AI agents on Azure are writing the report/)).toBeInTheDocument();
  await vi.advanceTimersByTimeAsync(13_000);
  expect(await screen.findByRole('heading', { name: 'Home Town win 2–1' })).toBeInTheDocument();
  expect(screen.getByText('First sentence. Second.')).toBeInTheDocument();
  expect(screen.getByText(/Model cost: 0\.0041 USD/)).toBeInTheDocument();
  expect(calls.filter(c => c === 'POST /api/crew/live')).toHaveLength(1);
});

it('explains the limits instead of failing silently', async () => {
  server({ 'GET /api/crew/live/status': [[200, { available: true, remaining: 0 }]], 'GET /api/crew/live': [[200, { status: 'none' }]],
    'POST /api/crew/live': [[429, { detail: 'budget_exhausted' }]] });
  render(<LiveCrewPanel engine="grf" matchId="physical-1" locale="es" ended />);
  expect(await screen.findByText('Se ha agotado el presupuesto de crónicas IA de la demo.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Reintentar' })).toBeNull();
});
