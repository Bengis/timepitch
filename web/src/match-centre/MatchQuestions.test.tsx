import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MatchQuestions } from './MatchQuestions';

// TP263: el panel pregunta y muestra; el servidor consulta los hechos con el agente y comprueba cada frase.
afterEach(() => { vi.restoreAllMocks(); });

function server(answer: unknown, status = 200) {
  const posts: unknown[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (String(input).endsWith('/status')) return new Response(JSON.stringify({ available: true, remaining: 100 }), { status: 200 });
    posts.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify(answer), { status });
  });
  return posts;
}

it('stays hidden until the match ends, then answers a suggested question with its check', async () => {
  const posts = server({ status: 'answered', sentences: [{ text: 'Jude Norris scored at 03:23.', fact_ids: ['goal:grf:1'] }], fetched: ['goal:grf:1'], cost: '0.0005' });
  const view = render(<MatchQuestions engine="grf" matchId="g-1" locale="en" ended={false} />);
  await Promise.resolve();
  expect(screen.queryByText('Ask the match')).toBeNull();
  view.rerender(<MatchQuestions engine="grf" matchId="g-1" locale="en" ended />);
  fireEvent.click(await screen.findByRole('button', { name: 'Who scored, and when?' }));
  expect(await screen.findByText('Jude Norris scored at 03:23.')).toBeInTheDocument();
  expect(screen.getByText(/Checked against 1 recorded fact the agent fetched/)).toBeInTheDocument();
  expect(posts).toEqual([expect.objectContaining({ engine: 'grf', match_id: 'g-1', question: 'Who scored, and when?' })]);
});

it('says when a question is not about the match, and explains the limits', async () => {
  server({ status: 'off_topic', sentences: [], fetched: [], cost: '0.0003' });
  render(<MatchQuestions engine="touchlines" matchId="tl-1" locale="es" ended />);
  const input = await screen.findByRole('textbox');
  fireEvent.change(input, { target: { value: 'Escribe un poema' } });
  fireEvent.click(screen.getByRole('button', { name: 'Preguntar' }));
  expect(await screen.findByText('Solo puedo responder sobre este partido, con lo que grabó el motor.')).toBeInTheDocument();
});

it('shows each sentence references, fetched IDs and the exact reported cost without inventing fact text', async () => {
  server({ status: 'answered', sentences: [
    { text: 'Jude Norris scored at 03:23.', fact_ids: ['goal:grf:1'] },
    { text: 'The match ended 1–0.', fact_ids: ['result'] }], fetched: ['goal:grf:1', 'result', 'team:home'], cost: '0.000517' });
  const view = render(<MatchQuestions engine="grf" matchId="g-1" locale="en" ended />);
  fireEvent.click(await screen.findByRole('button', { name: 'Who scored, and when?' }));
  const sentence = await screen.findByText('Jude Norris scored at 03:23.');
  expect(sentence.closest('[data-fact-ids]')).toHaveAttribute('data-fact-ids', 'goal:grf:1');
  const result = screen.getByText('The match ended 1–0.');
  expect(result.closest('[data-fact-ids]')).toHaveAttribute('data-fact-ids', 'result');
  expect(screen.getByText(/0\.000517 USD/)).toBeInTheDocument();
  expect(screen.getByText('team:home')).toBeInTheDocument();
  expect(screen.getByText(/names and numbers/)).toBeInTheDocument();
  expect(screen.getByText(/interpretation/)).toBeInTheDocument();
  expect(screen.getByText(/Identifiers returned by the API/)).toBeInTheDocument();
  expect(view.container.querySelector('a[href*="event"]')).toBeNull();
});

it('folds evidence and cost without hiding the answer, its check or the interpretation limit', async () => {
  const posts = server({ status: 'answered', sentences: [{ text: 'The match ended 1–0.', fact_ids: ['result'] }],
    fetched: ['result'], cost: '0.000517' });
  render(<MatchQuestions engine="grf" matchId="g-1" locale="en" ended />);
  fireEvent.click(await screen.findByRole('button', { name: 'Who scored, and when?' }));
  expect(await screen.findByText('The match ended 1–0.')).toBeVisible();
  expect(screen.getByText(/Checked against 1/)).toBeVisible();
  expect(screen.getByText(/do not guarantee the interpretation/)).toBeVisible();
  const cost = screen.getByText(/0\.000517 USD/), details = cost.closest('details');
  expect(details).not.toBeNull();
  expect(details).not.toHaveAttribute('open');
  expect(cost).not.toBeVisible();
  expect(screen.getByText('result', { selector: '.match-questions-references code' })).not.toBeVisible();
  fireEvent.click(details!.querySelector('summary')!);
  expect(cost).toBeVisible();
  expect(screen.getByText('result', { selector: '.match-questions-references code' })).toBeVisible();
  expect(posts).toHaveLength(1);
});

it('keeps a facts-only fallback and its scope visible while its receipt stays folded', async () => {
  server({ status: 'facts_only', sentences: [{ text: 'The match ended 1–0.', fact_ids: ['result'] }],
    fetched: ['result'], cost: '0.000517' });
  render(<MatchQuestions engine="grf" matchId="g-1" locale="es" ended />);
  fireEvent.click(await screen.findByRole('button', { name: '¿Quién marcó y cuándo?' }));
  expect(await screen.findByText(/La respuesta de la IA no pasó la comprobación/)).toBeVisible();
  expect(screen.getByText('The match ended 1–0.')).toBeVisible();
  expect(screen.getByText(/No garantiza la interpretación/)).toBeVisible();
  expect(screen.getByText(/0\.000517 USD/)).not.toBeVisible();
  expect(screen.queryByText(/Comprobada con/)).toBeNull();
});

it('aborts and discards a late answer when the match changes', async () => {
  let resolveAnswer!: (r: Response) => void;
  let signal: AbortSignal | null | undefined;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (String(input).endsWith('/status')) return new Response(JSON.stringify({ available: true }));
    signal = init?.signal;
    return await new Promise<Response>(resolve => { resolveAnswer = resolve; });
  });
  const view = render(<MatchQuestions engine="grf" matchId="old" locale="en" ended />);
  fireEvent.click(await screen.findByRole('button', { name: 'Who scored, and when?' }));
  view.rerender(<MatchQuestions engine="grf" matchId="new" locale="en" ended />);
  await act(async () => { resolveAnswer(new Response(JSON.stringify({ status: 'answered', sentences: [
    { text: 'Old match answer', fact_ids: ['result'] }], fetched: ['result'], cost: '0.001' }))); });
  expect(signal?.aborted).toBe(true);
  expect(screen.queryByText('Old match answer')).toBeNull();
  expect(screen.queryByText('Who scored, and when?', { selector: '.match-questions-q' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Who scored, and when?' })).toBeEnabled();
});

it('aborts an outstanding question when its panel unmounts', async () => {
  let signal: AbortSignal | null | undefined;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (String(input).endsWith('/status')) return new Response(JSON.stringify({ available: true }));
    signal = init?.signal;
    return await new Promise<Response>(() => {});
  });
  const view = render(<MatchQuestions engine="grf" matchId="g-1" locale="en" ended />);
  fireEvent.click(await screen.findByRole('button', { name: 'Who scored, and when?' }));
  view.unmount();
  expect(signal?.aborted).toBe(true);
});
