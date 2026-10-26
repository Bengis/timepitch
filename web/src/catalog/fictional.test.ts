import { describe, expect, it } from 'vitest';
import { fictionalAbbr, fictionalClub, fictionalPlayer, fnv1a } from './fictional';

// Mismos pares que backend/tests/test_fictional_league.py: la crónica en vivo nombra lo mismo que la web.
const PLAYERS: Record<string, string> = {
  'Thierry Henry': 'Nico Warburton', 'Erling Haaland': 'Lewis Dunmore', 'Ilkay Gündogan': 'Danny Vance',
  "Steven N'Zonzi": 'Arlo Moffat', 'Gilberto Silva': 'Jude Norris',
};

describe('liga ficticia (TP259)', () => {
  it('usa el FNV-1a de 32 bits estándar', () => {
    expect(fnv1a('a')).toBe(0xe40c292c);
  });
  it('da a cada jugador el mismo nombre inventado que el backend', () => {
    for (const [real, made] of Object.entries(PLAYERS)) expect(fictionalPlayer(real)).toBe(made);
    expect(fictionalPlayer('  thierry   HENRY ')).toBe('Nico Warburton');
  });
  it('conserva la temporada del club y deja como está un club desconocido', () => {
    expect(fictionalClub('Arsenal 2003/04')).toBe('North London Reds 2003/04');
    expect(fictionalClub('Manchester City')).toBe('Mancunian Sky');
    expect(fictionalClub('Unknown FC')).toBe('Unknown FC');
  });
  it('da la abreviatura de un club ficticio, con o sin temporada', () => {
    expect(fictionalAbbr('North London Reds 2003/04')).toBe('NLR');
    expect(fictionalAbbr('Mancunian Sky')).toBe('MSY');
    expect(fictionalAbbr('Arsenal')).toBeNull();
  });
});
