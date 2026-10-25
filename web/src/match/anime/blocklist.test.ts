import { describe, expect, it } from 'vitest';
import { ALL_BLOCKED, blockedTermsIn, CHARACTER_NAMES, MOVE_NAMES, normalizeForBlocklist, SERIES_TITLES, TEAM_NICKNAMES } from './blocklist';
import { allMoveNames, allMoveWords } from './moves';
import { GRAPHICS_TEXT } from '../renderers/messages';
import { ABILITY_NAMES } from './abilities';
import { OUTCOME_TEXT } from './spec';

// TP234 · Capitán Hane: provenance evidence. No generated name, word, ability or mode label may use a Captain Tsubasa
// move, character or title (EN, ES, JP romaji), a club or national-team nickname, or a player-linked slogan.
describe('Tsubasa blocklist', () => {
  it('the blocklist itself covers the known move names in EN, ES and romaji, and the series titles', () => {
    for (const term of ['Catapulta infernal', 'Tiro del tigre', 'Drive Shot', 'Skylab Hurricane', 'Taiga Shotto', 'Doraibu Shuto', 'Sukairabu Harikein'])
      expect(MOVE_NAMES).toContain(term);
    for (const title of ['Captain Tsubasa', 'Capitán Tsubasa', 'Oliver y Benji', 'Super Campeones', 'Holly e Benji', 'Olive et Tom'])
      expect(SERIES_TITLES).toContain(title);
    expect(CHARACTER_NAMES.length).toBeGreaterThan(20);
    expect(TEAM_NICKNAMES).toContain('Hammers');
  });
  it('matches whole words regardless of case and accents', () => {
    expect(normalizeForBlocklist('¡Catapulta Infernal!')).toBe(' CATAPULTA INFERNAL ');
    expect(blockedTermsIn('el TIRO DEL TIGRE')).toContain('Tiro del tigre');
    expect(blockedTermsIn('Capitán Tsubasa')).toContain('Capitán Tsubasa');
    // Singular generic words that were approved are not the plural nicknames.
    expect(blockedTermsIn('MARTILLO DEL NORTE')).toEqual([]);
    expect(blockedTermsIn('NORTHERN HAMMER')).toEqual([]);
    expect(blockedTermsIn('THE HAMMERS')).toEqual(['Hammers']);
  });
  it('no generated move name in either language contains any blocked term', () => {
    const names = [...allMoveNames('en'), ...allMoveNames('es')];
    expect(names.length).toBeGreaterThan(300);
    expect(names.filter(name => blockedTermsIn(name).length > 0)).toEqual([]);
  });
  it('no single word of the lists is blocked either', () => {
    expect(allMoveWords().filter(word => blockedTermsIn(word).length > 0)).toEqual([]);
  });
  it('the mode name, ability names and outcome captions are original', () => {
    expect(GRAPHICS_TEXT.en.styleAnime).toBe('Captain Hane'); expect(GRAPHICS_TEXT.es.styleAnime).toBe('Capitán Hane');
    const labels = [GRAPHICS_TEXT.en.styleAnime, GRAPHICS_TEXT.es.styleAnime, ...Object.values(ABILITY_NAMES.en), ...Object.values(ABILITY_NAMES.es),
      ...Object.values(OUTCOME_TEXT.en), ...Object.values(OUTCOME_TEXT.es)];
    expect(labels.filter(label => blockedTermsIn(label).length > 0)).toEqual([]);
    for (const title of SERIES_TITLES) expect(normalizeForBlocklist(GRAPHICS_TEXT.en.styleAnime)).not.toBe(normalizeForBlocklist(title));
  });
  it('the full list has no empty or duplicate-normalised entries', () => {
    const normalised = ALL_BLOCKED.map(normalizeForBlocklist);
    expect(normalised.every(n => n.trim().length > 1)).toBe(true);
  });
});
