import { expect, it } from 'vitest';
import { momentsAt } from './analysis';
import { analysisSource } from './test-fixtures';

it('cutoff_excludes_future_goal_and_final_result', () => {
  const source = analysisSource(), original = JSON.stringify(source);
  const early = momentsAt(source,1695068,'en');
  expect(JSON.stringify(early)).not.toContain('Cahill');
  const cards = momentsAt(source,1695328,'en'), card = cards.at(-1)!;
  expect(card.shotXg).toBe(.26275134);
  expect(card.explanation).toMatch(/Courtois.*Gomis.*Ayew.*Cahill/);
  expect(card.explanation).toContain('1.4');
  expect(card.evidenceIds).toEqual(expect.arrayContaining(['historical:header','historical:save','historical:recovery','historical:shot','historical:block']));
  expect(JSON.stringify(cards)).not.toMatch(/historical:goal|2[–-]2|equalis|goal assist/);
  expect(momentsAt(source,1697116,'en').at(-1)!.evidenceIds).toContain('historical:goal');
  expect(momentsAt(source,1695328,'en')).toEqual(cards);
  expect(momentsAt(source,1695328,'es').at(-1)!.explanation).toMatch(/Cahill/);
  expect(JSON.stringify(source)).toBe(original);
});
it('a foreign or ambiguous block cannot name a defender or convert a saved shot assist into a goal assist', () => {
  const source = analysisSource();
  const events = source.events.map(e => e.kind === 'Block' ? { ...e, relatedIds:['historical:foreign'],actorId:'historical:foreign' } : e);
  expect(JSON.stringify(momentsAt({...source,events},1695328,'en'))).not.toContain('Cahill');
  expect(JSON.stringify(momentsAt(source,1697850,'en'))).not.toContain('goal assist');
  expect(() => momentsAt({...source,events:[...source.events,source.events[0]]},1697850,'en')).toThrow(/duplicate/i);
});
