import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { LanguageProvider } from '../i18n';
import type { SceneFrame } from '../match/retroScene';
import { MatchBreak } from './MatchBreak';
import { walkoutDuration, walkoutFrame } from './match-phases';

// TP247: salida de los equipos al estadio y rótulos de descanso y final.
const player = (side: 'home' | 'away', i: number, role: 'GK' | 'DEF' | 'MID' | 'FWD') => ({ key: `${side}-${i}`, name: `${side} ${i}`, side, role, x: 30 + i, y: 20 + i });
const kickoff: SceneFrame = { clock_ms: 0, period: 1, score: { home: 0, away: 0 }, possession: 'home', carrier: 'home-1', ball: { x: 52.5, y: 34 },
  players: [player('home', 0, 'FWD'), player('home', 1, 'GK'), player('away', 0, 'DEF'), player('away', 1, 'GK')] };

it('walks both teams out of the tunnel into two lines beside the halfway line, keepers first, with no ball', () => {
  const start = walkoutFrame(kickoff, 0), end = walkoutFrame(kickoff, walkoutDuration(kickoff));
  expect(start.ball).toBeNull();
  expect(start.players.every(p => p.y > 68)).toBe(true);
  expect(end.players.map(p => p.key)).toEqual(['home-1', 'home-0', 'away-1', 'away-0']);
  expect(end.players.every(p => p.y === 57)).toBe(true);
  expect(end.players.filter(p => p.side === 'home').every(p => p.x < 52.5)).toBe(true);
  expect(end.players.filter(p => p.side === 'away').every(p => p.x > 52.5)).toBe(true);
  expect(walkoutDuration({ ...kickoff, players: [] })).toBe(0);
});

it('half-time shows the score, scorers and statistics and starts the second half', () => {
  let resumed = 0;
  render(<LanguageProvider><MatchBreak phase="halftime" home="Arsenal" away="Manchester City" score={{ home: 1, away: 0 }}
    scorers={{ home: [{ id: 'g1', name: 'Robert Pires', minute: "23'", ownGoal: false }], away: [] }} stats={<p>Possession 55%</p>}
    onContinue={() => resumed++} /></LanguageProvider>);
  expect(screen.getByRole('dialog', { name: 'Half-time' })).toHaveTextContent('1 – 0');
  expect(screen.getByText("Robert Pires 23'")).toBeInTheDocument();
  expect(screen.getByText('Possession 55%')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Start the second half/ }));
  expect(resumed).toBe(1);
});

it('full-time offers to watch again or close; the walkout can be skipped', () => {
  const calls: string[] = [];
  const { unmount } = render(<LanguageProvider><MatchBreak phase="fulltime" home="A" away="B" score={{ home: 2, away: 2 }}
    onReplay={() => calls.push('again')} onClose={() => calls.push('close')} /></LanguageProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Watch again' }));
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  unmount();
  render(<LanguageProvider><MatchBreak phase="walkout" home="A" away="B" score={null} onContinue={() => calls.push('skip')} /></LanguageProvider>);
  expect(screen.getByText('The teams walk out')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Skip to kick-off/ }));
  expect(calls).toEqual(['again', 'close', 'skip']);
});
