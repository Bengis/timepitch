import { describe, expect, it } from 'vitest';
import { APPEARANCE_REGISTRY, HAND_ASSIGNED_PROVENANCE, appearanceFor } from './appearance';
import { HAIR_STYLES } from '../match/renderers/character';
import { GENERIC_APPEARANCE, type PlayerRecord } from '../presentation/types';
import { assertNoTransfermarkt } from '../presentation/registry-schema';

const HENRY = 'Q45901';
const HAALAND = 'Q28967995';

function record(qid: string | null, heightCm: number | null): PlayerRecord {
  return { qid, number: null, display: 'x', position: null, nation: null, dob: null, heightCm, fields: {} };
}

describe('appearanceFor', () => {
  it('returns the hand-assigned look for a demo QID, with the record height', () => {
    const r = appearanceFor(HENRY, record(HENRY, 190));
    expect(r.source).toBe('hand_assigned');
    expect(r.params.heightCm).toBe(190);
    expect(r.params.skin).toBe(APPEARANCE_REGISTRY.players[HENRY].skin);
  });

  it('falls back to the Wikidata height stored in the registry when there is no record', () => {
    expect(appearanceFor(HAALAND, null).params.heightCm).toBe(APPEARANCE_REGISTRY.players[HAALAND].heightCm);
  });

  it('returns the generic look for unknown or missing QIDs, always the same object', () => {
    const a = appearanceFor('Q1', record('Q1', 180));
    const b = appearanceFor('Q2', null);
    expect(a.source).toBe('generic');
    expect(a.params).toBe(GENERIC_APPEARANCE);
    expect(b.params).toBe(a.params);
    expect(appearanceFor(null, null).params).toBe(GENERIC_APPEARANCE);
  });
});

describe('appearance-demo.json', () => {
  const players = Object.entries(APPEARANCE_REGISTRY.players);

  it('covers both demo squads keyed by QID, with hand-assigned provenance', () => {
    expect(Object.keys(APPEARANCE_REGISTRY.squads).sort()).toEqual(['arsenal:2003', 'mancity:2024']);
    expect(players.filter(([, e]) => e.club === 'arsenal').length).toBeGreaterThanOrEqual(25);
    expect(players.filter(([, e]) => e.club === 'mancity').length).toBeGreaterThanOrEqual(25);
    for (const [qid, e] of players) {
      expect(qid).toMatch(/^Q\d+$/);
      expect(e.provenance).toBe(HAND_ASSIGNED_PROVENANCE);
      expect(`${e.club}:${e.season}` in APPEARANCE_REGISTRY.squads, qid).toBe(true);
      if (e.heightSource) expect(e.heightSource.qid).toBe(qid);
    }
    expect(APPEARANCE_REGISTRY._meta.match).toMatch(/ficticia/);
  });

  it('uses only values the renderer understands', () => {
    for (const [qid, e] of players) {
      expect(['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'], qid).toContain(e.skin);
      expect(HAIR_STYLES, qid).toContain(e.hairStyle);
      expect(['black', 'dkbrown', 'brown', 'ltbrown', 'dkblond', 'blond'], qid).toContain(e.hairColour);
      expect(['none', 'light', 'stubble', 'full'], qid).toContain(e.beard);
      expect(['dk', 'br', 'hz', 'bl', 'gr'], qid).toContain(e.eyes);
      expect(e.boots, qid).toMatch(/^#[0-9a-f]{6}$/);
      expect(e.build).toBeGreaterThan(0.8);
      expect(e.build).toBeLessThan(1.2);
    }
  });

  it('carries no Transfermarkt fields', () => {
    expect(() => assertNoTransfermarkt(APPEARANCE_REGISTRY)).not.toThrow();
  });
});
