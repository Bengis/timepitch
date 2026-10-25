import { expect, it } from 'vitest';
import { clockFor } from './football-clock';
import { cursorAt } from './session';
import { syntheticSnapshot } from './unified-fixtures';
import { sequenceDescriptor } from './sequence/test-fixtures';

it('uses recorded local periods, added time and explicit half-time context', () => {
  const s = syntheticSnapshot(); s.descriptor = sequenceDescriptor();
  s.presentedCursor = cursorAt(s.descriptor,2880495,1); s.clockMs=2880495;
  expect(clockFor(s,null,'en')).toEqual({state:'playing',period:1,text:'45+03:00'});
  expect(clockFor(s,{kind:'halftime',atMs:2880495,endingPeriod:1},'en').text).toBe('Half-time');
  s.presentedCursor = cursorAt(s.descriptor,2880495);s.clockMs=0;
  expect(clockFor(s,null,'en').text).toBe('45:00');
  s.presentedCursor = cursorAt(s.descriptor,5851968);s.clockMs=2971473;
  expect(clockFor(s,null,'en')).toEqual({state:'fulltime',period:2,text:'90+04:31'});
  expect(cursorAt(s.descriptor,2880495,1)).toMatchObject({period:1,periodMs:2880495});
  expect(cursorAt(s.descriptor,2880494,1).period).toBe(0);
});
it('passes native GRF clock through and never guesses a missing clock or boundary', () => {
  const s = syntheticSnapshot({source:'grf',id:'test',revision:'1'});s.clockMs=2812345;
  expect(clockFor(s,null,'en').text).toBe('46:52');
  s.clockMs=null;expect(clockFor(s,null,'es').state).toBe('unavailable');
  s.descriptor=sequenceDescriptor();s.descriptor.periods=[{period:1,startMs:0,durationMs:null}];
  expect(cursorAt(s.descriptor,2880495,1).period).toBe(0);
  expect(clockFor(s,{kind:'halftime',atMs:2880495,endingPeriod:1},'en').state).toBe('unavailable');
});
