import { fireEvent, render, screen } from '@testing-library/react';
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
