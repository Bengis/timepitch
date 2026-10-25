import { expect, it } from 'vitest';
import type { RenderFrame } from '../api';
import { hitPlayer, sceneFor, type SceneFrame } from './retroScene';

it('keeps missing historical balls absent and falls back to the pitch centre',()=>{
  const empty:SceneFrame={clock_ms:0,period:1,players:[],ball:null,score:{home:0,away:0},carrier:null,possession:null};
  const scene=sceneFor(empty,empty,'follow','');
  expect(scene.ball).toBeNull();
  expect(Number.isFinite(scene.transform.ox)).toBe(true);
});

const frame: RenderFrame = { clock_ms: 1500, period: 1, score: { home: 0, away: 0 }, carrier: 'away:p', possession: 'away',
  ball: { x: 95, y: 60 }, players: [
    { key: 'home:p', name: 'A', side: 'home', role: 'MID', x: 20, y: 20 },
    { key: 'away:p', name: 'B', side: 'away', role: 'GK', x: 90, y: 60 },
  ] };

it('a source header never becomes a foot kick in the Retro fallback; unknown body part keeps its generic cue',()=>{
  const shot={type:'shot' as const,t1_ms:1450,participants:['home:p']};
  expect(sceneFor(frame,frame,'follow','',shot).players[0].state).toBe('kick');
  expect(sceneFor(frame,frame,'follow','',{...shot,bodyPart:'head'}).players[0].state).toBe('idle');
  const focus=sceneFor(frame,frame,'follow','',undefined,false,{x:40,y:35});
  expect(focus.transform).not.toEqual(sceneFor(frame,frame,'follow','').transform);
  expect(sceneFor(frame,frame,'follow','',undefined,false,null).transform).toEqual(sceneFor(frame,frame,'overview','').transform);
});

it('picks the displayed player after a panned camera, with a separate all-pitch view', () => {
  const before = JSON.stringify(frame);
  const follow = sceneFor(frame, frame, 'follow', 'away:p');
  const p = follow.players[1];
  expect(hitPlayer(follow, p.px, p.py - 8)).toBe('away:p');
  expect(hitPlayer(follow, p.px, 240)).toBeNull();
  const overview = sceneFor(frame, frame, 'overview', 'away:p');
  expect(overview.players.every(person => person.px >= 0 && person.px <= 384 && person.py >= 24 && person.py <= 232)).toBe(true);
  expect(overview.players[1].px).not.toBe(p.px);
  expect(overview.players[1].palette).toBe(3);
  expect(JSON.stringify(frame)).toBe(before);
});

it('derives poses from recorded time so seeking back is identical and resets do not become runs', () => {
  const previous = { ...frame, clock_ms: 1400, players: frame.players.map(p => ({ ...p, x: p.x - .5 })) };
  const first = sceneFor(frame, previous, 'follow', '');
  expect(first.players[0].state).toMatch(/^run-/);
  sceneFor({ ...frame, clock_ms: 5000 }, previous, 'overview', 'away:p');
  expect(sceneFor(frame, previous, 'follow', '')).toEqual(first);
  expect(sceneFor(frame, previous, 'follow', '', undefined, true).players[0].state).toBe('idle');
});

it('shows only resolved kicks or goals and never reveals a future score through a celebration', () => {
  const cue = { type: 'goal', side: 'away', participants: ['away:p'], t1_ms: 1600 } as const;
  expect(sceneFor(frame, frame, 'follow', '', { ...cue, participants: [...cue.participants] }).goal).toBe(false);
  const goal = sceneFor({ ...frame, clock_ms: 1700 }, frame, 'follow', '', { ...cue, participants: [...cue.participants] });
  expect(goal.goal).toBe(true);
  expect(goal.players.map(p => p.state)).toEqual(['idle', 'celebrate']);
});

it('selects the sprite painted last when bodies share a depth row', () => {
  const overlap = { ...frame, players: frame.players.map(p => ({ ...p, x: 50, y: 34 })) };
  const scene = sceneFor(overlap, overlap, 'overview', '');
  expect(hitPlayer(scene, scene.players[0].px, scene.players[0].py - 6)).toBe('away:p');
});
