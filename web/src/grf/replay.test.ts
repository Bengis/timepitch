import { expect,it } from 'vitest';
import {legacyFixture as fixture,fullFixture} from './test-fixtures';
import { sampleGrfFrame,GrfReplayController } from './replay';

it('keeps side-scoped actors, native margins and resolved score without future disclosure',()=>{
  const record=fixture();
  record.samples[0].home_xy[0]=[-1.01,-.43];
  const frame=sampleGrfFrame(record,50);
  expect(frame.nativeStep).toBe(-1);
  expect(frame.frame.players[0].x).toBeLessThan(0);
  expect(new Set(frame.frame.players.map(p=>p.key)).size).toBe(22);
  expect(sampleGrfFrame(record,199).frame.score).toEqual({home:0,away:0});
  expect(sampleGrfFrame(record,200).frame.score).toEqual({home:1,away:0});
});

it('interpolates normal movement but holds the prior state through a discontinuity',()=>{
  const record=fixture();
  expect(sampleGrfFrame(record,50).frame.players[0].x).toBeCloseTo(26.5125);
  record.samples[1].home_xy[0]=[.9,0];
  expect(sampleGrfFrame(record,50).transition).toBe(true);
  expect(sampleGrfFrame(record,50).frame.players[0].x).toBeCloseTo(26.25);
  expect(sampleGrfFrame(record,100).frame.players[0].x).toBeCloseTo(99.75);
  record.samples[0].owner_team=-1;record.samples[0].owner_slot=-1;
  expect(sampleGrfFrame(record,0).ownerKnown).toBe(false);
});

it('uses its own duration and freezes pause, speed changes and seek reproducibly',()=>{
  let now=0;const controller=new GrfReplayController(fixture(),()=>now);
  expect(controller.speed).toBe(1);
  controller.play();now=50;controller.pause();now=100;
  expect(controller.currentTime()).toBe(50);
  controller.setSpeed(5);controller.play();now=120;
  expect(controller.currentTime()).toBe(150);
  controller.seek(0);expect(controller.currentTime()).toBe(0);
  now=1000;expect(controller.currentTime()).toBe(200);expect(controller.isPlaying).toBe(false);
});

it('uses native match time and halves without changing animation time or leaking the next half',()=>{
  const record=fullFixture();
  const before=sampleGrfFrame(record,199),after=sampleGrfFrame(record,200),end=sampleGrfFrame(record,300);
  expect(before.matchTimeMs).toBe(2700000);expect(before.frame.period).toBe(1);
  expect(after.matchTimeMs).toBe(2701800);expect(after.frame.period).toBe(2);
  expect(after.frame.clock_ms).toBe(200);
  expect(end.completed).toBe(true);expect(end.matchTimeMs).toBe(5414400);
});
