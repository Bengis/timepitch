import { afterEach, describe, expect, it, vi } from 'vitest';
import { CARD_TEAM_KEYS, PLAYER_LINKS, linkFor, loadSquad, parseSquad, recordFor, squadUrl, type PlayerCardRecord } from './player-registry';
import { assertNoTransfermarkt, isAssetSource } from '../presentation/registry-schema';

type SquadFile = { _meta: { teamKey: string }; players: PlayerCardRecord[] };
const modules = import.meta.glob<SquadFile>('../../public/data/players/*.json', { eager: true, import: 'default' });
const squads = new Map(Object.entries(modules).map(([path, doc]) => [path.split('/').pop()!, doc]));
const files = [...squads.keys()].sort();
const squadOf = (teamKey: string) => [...squads.values()].find(s => s._meta.teamKey === teamKey)!.players;

describe('public player cards (demo teams only)', () => {
  it('ships exactly the four demo club-seasons', () => {
    expect(files).toEqual(['arsenal-2003.json', 'chelsea-2015.json', 'mancity-2024.json', 'swansea-2015.json']);
    expect([...CARD_TEAM_KEYS].sort()).toEqual(['arsenal:2003', 'chelsea:2015', 'mancity:2024', 'swansea:2015']);
  });

  it('carries no Transfermarkt field and only Wikidata / Wikipedia sources', () => {
    for (const [file, doc] of squads) {
      expect(() => assertNoTransfermarkt(doc), file).not.toThrow();
      expect(JSON.stringify(doc.players)).not.toMatch(/transfermarkt|"fpl|statsbomb|epldata/i);
      for (const p of doc.players) {
        for (const [field, source] of Object.entries(p.fields)) {
          expect(isAssetSource(source), `${file} ${p.qid}.${field}`).toBe(true);
          expect(['wikidata', 'wikipedia']).toContain(source.kind);
          if (source.kind === 'wikidata') expect(source.qid).toBe(p.qid);
          if (source.kind === 'wikipedia') expect(source.revid).toBeGreaterThan(0);
        }
      }
    }
    expect(() => assertNoTransfermarkt(PLAYER_LINKS)).not.toThrow();
  });

  it('applies the nationality rule: P1532, else P27, else a cited manual correction', () => {
    for (const doc of squads.values()) for (const p of doc.players) {
      if (p.nationBasis === 'sport') expect(p.nation).toBe(p.sportNationalities.join(' / '));
      if (p.nationBasis === 'citizenship') { expect(p.sportNationalities).toEqual([]); expect(p.nation).toBe(p.citizenship.join(' / ')); }
      if (p.nationBasis === 'manual') expect(p.fields.nation.note).toMatch(/P1532/);
    }
    const azpi = squadOf('chelsea:2015').find(p => p.qid === 'Q294806')!;
    expect(azpi).toMatchObject({ nation: 'Spain', nationBasis: 'manual', sportNationalities: ['Euskal-Erria'] });
    expect(squadOf('arsenal:2003').find(p => p.qid === 'Q45901')).toMatchObject({ number: '14', nation: 'France', nationBasis: 'sport', heightCm: 188 });
  });

  it('links every reviewed row to a card of its own club-season, never by name', () => {
    expect(PLAYER_LINKS.links.length).toBeGreaterThan(150);
    for (const l of PLAYER_LINKS.links) {
      expect(l.reviewed).toBe(true);
      expect(['manual', 'jersey_club_season', 'dob_club_season', 'opta']).toContain(l.method);
      expect(l.sourceKey.startsWith(`${l.source}:`)).toBe(true);
      expect(squadOf(l.teamKey).some(p => p.qid === l.qid), l.sourceKey).toBe(true);
      expect(Object.keys(l).sort()).toEqual(['confidence', 'method', 'qid', 'reviewed', 'source', 'sourceKey', 'teamKey']);
    }
  });
});

describe('linkFor / recordFor', () => {
  it('finds approved links by source key', () => {
    expect(linkFor('epldata', 'epldata:2003:arsenal:PIRESR')).toMatchObject({ qid: 'Q113156', method: 'manual' });
    expect(linkFor('fpl', 'nope')).toBeNull();
    expect(linkFor('statsbomb', 'epldata:2003:arsenal:PIRESR')).toBeNull();
  });

  it('resolves only by QID', () => {
    const squad = squadOf('arsenal:2003');
    expect(recordFor(squad, null)).toBeNull();
    expect(recordFor(squad, { qid: 'Q1' })).toBeNull();
    expect(recordFor(squad, { qid: 'Q45901' })?.display).toBe('Thierry Henry');
  });
});

describe('loadSquad', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('fetches the public file for demo teams only', async () => {
    const doc = squads.get('swansea-2015.json');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(doc), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const squad = await loadSquad('swansea:2015', new AbortController().signal);
    expect(squad.length).toBe(doc!.players.length);
    expect(fetchMock).toHaveBeenCalledWith('/data/players/swansea-2015.json', expect.anything());
    expect(squadUrl('everton:2003')).toBeNull();
    expect(await loadSquad('everton:2003', new AbortController().signal)).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns [] on 404 and passes the abort signal', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.signal).toBe(controller.signal);
      return new Response('', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    expect(await loadSquad('arsenal:2003', controller.signal)).toEqual([]);
  });

  it('rejects a file with Transfermarkt fields', () => {
    expect(() => parseSquad({ players: [{ qid: 'Q1', fields: {}, tm_dob: '1990-01-01' }] })).toThrow(/Transfermarkt/);
  });
});
