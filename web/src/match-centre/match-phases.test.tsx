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
  expect(end.players.every(p => p.y === 63)).toBe(true);
  expect(end.players.filter(p => p.side === 'home').every(p => p.x < 52.5)).toBe(true);
  expect(end.players.filter(p => p.side === 'away').every(p => p.x > 52.5)).toBe(true);
  expect(walkoutDuration({ ...kickoff, players: [] })).toBe(0);
});

it('keeps two full teams separated and walking at a bounded human pace throughout the entrance', () => {
  const full:SceneFrame={...kickoff,players:(['home','away'] as const).flatMap(side=>Array.from({length:11},(_,i)=>player(side,i,i===0?'GK':'MID')))};
  const original=JSON.stringify(full);let before=walkoutFrame(full,0),minimum=Infinity,maximum=0;
  for(let t=50;t<=walkoutDuration(full)+50;t+=50){
    const frame=walkoutFrame(full,t),prior=new Map(before.players.map(p=>[p.key,p]));
    for(const [i,p] of frame.players.entries()){
      const old=prior.get(p.key);if(old)maximum=Math.max(maximum,Math.hypot(p.x-old.x,p.y-old.y)/.05);
      for(const q of frame.players.slice(i+1))minimum=Math.min(minimum,Math.hypot(p.x-q.x,p.y-q.y));
    }before=frame;
  }
  expect(maximum).toBeLessThanOrEqual(1.8);
  expect(minimum).toBeGreaterThan(.85);
  expect(before.players).toHaveLength(22);
  expect(JSON.stringify(full)).toBe(original);
  expect(walkoutFrame(full,3200)).toEqual(walkoutFrame(full,3200));
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

it('TP250: the walkout lists both line-ups; full-time names the player of the match and opens the AI report', () => {
  const calls: string[] = [];
  const { unmount } = render(<LanguageProvider><MatchBreak phase="walkout" home="A" away="B" score={null}
    lineups={{ home: ['1 Jens Lehmann', '14 Thierry Henry'], away: ['31 Ederson'] }} /></LanguageProvider>);
  expect(screen.getByText('14 Thierry Henry')).toBeInTheDocument();
  expect(screen.getByText('31 Ederson')).toBeInTheDocument();
  unmount();
  render(<LanguageProvider><MatchBreak phase="fulltime" home="A" away="B" score={{ home: 6, away: 1 }}
    best={{ name: '14 Thierry Henry', detail: '2 goals · 7 shots · 30 passes' }} onReport={() => calls.push('report')} /></LanguageProvider>);
  expect(screen.getByText('Player of the match')).toBeInTheDocument();
  expect(screen.getByText('14 Thierry Henry')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Read the AI match report/ }));
  expect(calls).toEqual(['report']);
});

it('offers the half-time report without resuming and prioritizes the report over replay at full-time', () => {
  const calls: string[] = [];
  const view = render(<MatchBreak phase="halftime" home="A" away="B" score={{ home: 1, away: 0 }}
    onContinue={() => calls.push('continue')} onReport={() => calls.push('report')} />);
  fireEvent.click(screen.getByRole('button', { name: /Read the half-time report/ }));
  expect(calls).toEqual(['report']);
  expect(screen.getByRole('button', { name: /Start the second half/ })).toBeInTheDocument();
  view.unmount();
  render(<MatchBreak phase="fulltime" home="A" away="B" score={{ home: 1, away: 0 }}
    onReplay={() => calls.push('replay')} onReport={() => calls.push('report')} />);
  const report = screen.getByRole('button', { name: /Read the AI match report/ });
  expect(report).toHaveClass('tp-break-primary');
  expect(report).toHaveFocus();
  expect(screen.getByRole('button', { name: 'Watch again' })).not.toHaveClass('tp-break-primary');
});

it('offers analysis as the main full-time action when no AI report exists', () => {
  const analyse = () => {};
  render(<MatchBreak phase="fulltime" home="A" away="B" score={{ home: 0, away: 0 }} onAnalysis={analyse} onReplay={() => {}} />);
  expect(screen.getByRole('button', { name: 'Analyse the match' })).toHaveClass('tp-break-primary');
  expect(screen.getByRole('button', { name: 'Watch again' })).not.toHaveClass('tp-break-primary');
});
