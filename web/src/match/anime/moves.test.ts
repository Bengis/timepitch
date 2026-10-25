import { describe, expect, it } from 'vitest';
import { allMoveNames, hashKey, moveNameFor, roleFor, ROLE_NOUNS, themeFor, THEMES } from './moves';

// TP234 · Capitán Hane: original move names, deterministic per player, themed by nationality and position.
const henry = { seedKey: 'Q45901', nation: 'France', position: 'FW' };
const haaland = { seedKey: 'Q28967995', nation: 'Norway', position: 'FW' };

describe('deterministic move names', () => {
  it('the same player always gets the same move, in both languages, and the hash is stable', () => {
    expect(hashKey('Q45901')).toBe(hashKey('Q45901'));
    expect(hashKey('')).toBe(0x811c9dc5);
    for (const id of [henry, haaland]) for (const locale of ['en', 'es'] as const)
      expect(new Set(Array.from({ length: 5 }, () => moveNameFor(id, locale))).size).toBe(1);
  });
  it('pins the demo players (a change here changes what was approved: update the doc too)', () => {
    expect(moveNameFor(henry, 'en')).toBe('AZURE MISTRAL'); expect(moveNameFor(henry, 'es')).toBe('MISTRAL AZUR');
    expect(moveNameFor(haaland, 'en')).toBe('POLAR STORM'); expect(moveNameFor(haaland, 'es')).toBe('TORMENTA POLAR');
    expect(moveNameFor({ seedKey: 'Q190142', nation: 'Brazil', position: 'MF' }, 'es')).toBe('SAMBA DE RÍO');
    expect(moveNameFor({ seedKey: 'Q17074511', nation: 'Brazil', position: 'GK' }, 'es')).toBe('FORTALEZA DE RÍO');
  });
  it('different players spread over many names', () => {
    const names = new Set(Array.from({ length: 200 }, (_, i) => moveNameFor({ seedKey: `p${i}`, nation: 'England', position: 'FW' }, 'en')));
    expect(names.size).toBeGreaterThan(8);
  });
});

describe('theming by nationality and position', () => {
  it('maps the sporting nationality (first of «A / B») to a theme; unknown ones go neutral', () => {
    expect(themeFor('Norway')).toBe('nordic'); expect(themeFor('France')).toBe('france'); expect(themeFor('Brazil / Portugal')).toBe('brazil');
    expect(themeFor('England')).toBe('england'); expect(themeFor('Uzbekistan')).toBe('neutral'); expect(themeFor(null)).toBe('neutral');
  });
  it('reads card positions and engine roles', () => {
    expect(['GK', 'goalkeeper', 'DF', 'DEF', 'MF', 'MID', 'FW', 'FWD', 'forward', 'xx', null].map(roleFor)).toEqual(['K', 'K', 'D', 'D', 'M', 'M', 'A', 'A', 'A', null, null]);
  });
  it('a Nordic forward gets a Nordic tag; keepers only keeper words; defenders only defender words', () => {
    const nordicTags = THEMES.nordic.tags.map(t => t.pre ?? t.post);
    for (let i = 0; i < 40; i++) {
      const name = moveNameFor({ seedKey: `n${i}`, nation: 'Norway', position: 'FW' }, 'en');
      expect(nordicTags.some(t => name.includes(t!))).toBe(true);
    }
    const allowed = (role: 'K' | 'D') => new Set([...THEMES.brazil.nouns.filter(n => n.roles.includes(role)).map(n => n.es), ...ROLE_NOUNS[role].map(n => n.es)]);
    for (const role of ['K', 'D'] as const) for (let i = 0; i < 40; i++) {
      const name = moveNameFor({ seedKey: `k${i}`, nation: 'Brazil', position: role === 'K' ? 'GK' : 'DF' }, 'es');
      expect([...allowed(role)].some(noun => name.startsWith(noun))).toBe(true);
    }
  });
  it('every generated name is upper case, short enough for the bubble and Spanish agrees in gender', () => {
    for (const locale of ['en', 'es'] as const) for (const name of allMoveNames(locale)) {
      expect(name).toBe(name.toUpperCase()); expect(name.length).toBeLessThanOrEqual(36);
    }
    expect(allMoveNames('es')).toContain('TORMENTA POLAR');
    expect(allMoveNames('es')).not.toContain('FLECHA AZURA');
    expect(allMoveNames('es')).toContain('ALA ELÉCTRICA');
  });
});
