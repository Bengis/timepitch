import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlayerView, SessionDescriptor } from '../match-centre/session';
import { GENERIC_APPEARANCE, type MatchCast, type PlayerRecord } from './types';
import { buildMatchCast, castSignature } from './cast';
import { useMatchCast } from './useMatchCast';

const ARTICLE = { kind: 'wikipedia', title: '2003–04 Arsenal F.C. season', revid: 1380992540, licence: 'CC BY-SA 4.0' } as const;
const WD = (qid: string) => ({ kind: 'wikidata', qid, revision: 2541362287, licence: 'CC0 1.0' }) as const;

function rec(qid: string, number: string, display: string): PlayerRecord {
  return { qid, number, display, position: null, nation: null, dob: null, heightCm: 188,
    fields: { number: ARTICLE, display: WD(qid), heightCm: WD(qid) } };
}
const HENRY = rec('Q45901', '14', 'Thierry Henry');
const PIRES = rec('Q113156', '7', 'Robert Pires');
const HAALAND = rec('Q28967995', '9', 'Erling Haaland');

function view(id: string, side: 'home' | 'away' | null, sourceKey: string | null, name: string | null, jersey: string | null): PlayerView {
  return {
    id, sourceRefs: [], name, side,
    role: { value: null, provenance: 'unavailable', refs: [] },
    jersey: { value: jersey, provenance: jersey === null ? 'unavailable' : 'source_recorded', refs: [] },
    intervals: { value: null, provenance: 'unavailable', refs: [] },
    estimatedAttributes: [], metrics: [], availability: { status: 'available', reason: null },
    details: sourceKey === null ? {} : { sourceKey },
  } as PlayerView;
}

const squads = { home: [HENRY, PIRES], away: [HAALAND] };
const base = { source: 'timepitch' as const, homeKey: 'arsenal:2003', awayKey: 'mancity:2024', squads };

describe('buildMatchCast', () => {
  it('linked player → record by QID, hand-assigned appearance and per-field provenance', () => {
    const cast = buildMatchCast({ ...base, players: [view('home:HENRYT', 'home', 'epldata:2003:arsenal:HENRYT', 'T. Henry', '14')] });
    const e = cast.players.get('home:HENRYT')!;
    expect(e.record?.qid).toBe('Q45901');
    expect(e.appearanceSource).toBe('hand_assigned');
    expect(e.appearance).not.toBe(GENERIC_APPEARANCE);
    expect(e.appearance.heightCm).toBe(188);
    expect(e.number).toBe('14');
    expect(e.displayName).toBe('Thierry Henry');
    expect(e.provenance.number).toMatchObject({ origin: 'match_source', provenance: 'source_recorded' });
    expect(e.provenance.displayName).toMatchObject({ origin: 'player_card', source: WD('Q45901') });
    expect(e.provenance.appearance).toBe('hand_assigned');
    expect(e.provenance.link).toMatchObject({ source: 'epldata', sourceKey: 'epldata:2003:arsenal:HENRYT', method: 'dob_club_season' });
  });

  it('linked player without a source jersey takes the card number, citing the season article', () => {
    const cast = buildMatchCast({ ...base, players: [view('away:351', 'away', 'fpl:2024:mancity:351', null, null)] });
    const e = cast.players.get('away:351')!;
    expect(e.number).toBe('9');
    expect(e.provenance.number).toMatchObject({ origin: 'player_card' });
    const pires = buildMatchCast({ ...base, players: [view('home:PIRESR', 'home', 'epldata:2003:arsenal:PIRESR', null, null)] })
      .players.get('home:PIRESR')!;
    expect(pires.number).toBe('7');
    expect(pires.provenance.number).toMatchObject({ origin: 'player_card', source: ARTICLE });
  });

  it('unlinked player → no record, generic appearance, source jersey or null', () => {
    const cast = buildMatchCast({ ...base, players: [
      view('home:YOUTH', 'home', 'epldata:2003:arsenal:NOBODY', 'Youth Player', '43'),
      view('home:NOJERSEY', 'home', 'epldata:2003:arsenal:NOBODY2', null, null),
    ] });
    const youth = cast.players.get('home:YOUTH')!;
    expect(youth).toMatchObject({ record: null, appearanceSource: 'generic', number: '43', displayName: 'Youth Player' });
    expect(youth.appearance).toBe(GENERIC_APPEARANCE);
    expect(youth.provenance).toMatchObject({ link: null, appearance: 'generic', displayName: { origin: 'match_source' } });
    const none = cast.players.get('home:NOJERSEY')!;
    expect(none).toMatchObject({ number: null, displayName: null, record: null });
    expect(none.provenance.number).toEqual({ origin: 'none' });
    expect(none.provenance.displayName).toEqual({ origin: 'none' });
  });

  it('same shirt number on both sides never crosses records', () => {
    const cast = buildMatchCast({ ...base, players: [
      view('home:PIRESR', 'home', 'epldata:2003:arsenal:PIRESR', 'R. Pires', '7'),
      view('away:X7', 'away', 'fpl:2024:mancity:99999', 'Someone', '7'),
    ] });
    expect(cast.players.get('home:PIRESR')!.record?.qid).toBe('Q113156');
    const away = cast.players.get('away:X7')!;
    expect(away.record).toBeNull();
    expect(away.appearanceSource).toBe('generic');
    expect(away.number).toBe('7');
  });

  it('a link for the other team is not applied (no cross-side identity)', () => {
    const cast = buildMatchCast({ ...base, players: [view('away:HENRYT', 'away', 'epldata:2003:arsenal:HENRYT', 'T. Henry', '14')] });
    const e = cast.players.get('away:HENRYT')!;
    expect(e.record).toBeNull();
    expect(e.provenance.link).toBeNull();
    expect(e.appearanceSource).toBe('generic');
  });

  it('a name equal to a squad player without a link does not produce a record (no name joins)', () => {
    const cast = buildMatchCast({ ...base, players: [view('home:N', 'home', 'epldata:2003:arsenal:UNKNOWN', 'Thierry Henry', null)] });
    expect(cast.players.get('home:N')!.record).toBeNull();
    expect(cast.players.get('home:N')!.appearanceSource).toBe('generic');
  });

  it('linked player whose QID is missing from the loaded squad keeps no record but keeps the reviewed link', () => {
    const cast = buildMatchCast({ ...base, squads: { home: [], away: [] },
      players: [view('home:HENRYT', 'home', 'epldata:2003:arsenal:HENRYT', 'T. Henry', '14')] });
    const e = cast.players.get('home:HENRYT')!;
    expect(e.record).toBeNull();
    expect(e.provenance.link?.qid).toBe('Q45901');
    // La apariencia asignada a mano va por QID del enlace revisado, no por la ficha.
    expect(e.appearanceSource).toBe('hand_assigned');
    expect(e.displayName).toBe('T. Henry');
  });

  it('player without side or sourceKey stays generic', () => {
    const cast = buildMatchCast({ ...base, players: [view('x', null, 'epldata:2003:arsenal:HENRYT', 'T. Henry', '14'), view('y', 'home', null, 'Y', '2')] });
    expect(cast.players.get('x')).toMatchObject({ record: null, appearanceSource: 'generic', number: '14' });
    expect(cast.players.get('y')).toMatchObject({ record: null, appearanceSource: 'generic', number: '2' });
  });

  it('team keys without registries → per-side fallback kits and no records', () => {
    const cast = buildMatchCast({ source: 'historical', homeKey: 'statsbomb:1', awayKey: 'statsbomb:2', squads: { home: [], away: [] },
      players: [view('home:a', 'home', 'statsbomb:10', 'A', '10'), view('away:b', 'away', 'statsbomb:11', 'B', '10')] });
    expect(cast.kits.home.provenance.origin).toBe('neutral');
    expect(cast.kits.away.provenance.origin).toBe('neutral');
    expect(cast.kits.home.shirt).not.toBe(cast.kits.away.shirt);
    expect([...cast.players.values()].every(e => e.record === null && e.appearanceSource === 'generic')).toBe(true);
    expect(cast.source).toBe('historical');
  });

  it('demo match uses the clash-resolved kits for both sides and their keepers', () => {
    const cast = buildMatchCast({ ...base, players: [] });
    expect(cast.kits.home.provenance.origin).not.toBe('neutral');
    expect(cast.kits.away.provenance.origin).not.toBe('neutral');
    expect(['source', 'estimated']).toContain(cast.kits.choice);
    expect(cast.kits.homeKeeper.shirt).not.toBe(cast.kits.home.shirt);
  });

  it('signature changes only when an identity-bearing field changes', () => {
    const a = [view('home:HENRYT', 'home', 'epldata:2003:arsenal:HENRYT', 'T. Henry', '14')];
    const b = [{ ...a[0], metrics: [] }];
    expect(castSignature(a)).toBe(castSignature(b));
    expect(castSignature(a)).not.toBe(castSignature([view('home:HENRYT', 'home', 'epldata:2003:arsenal:HENRYT', 'T. Henry', '12')]));
  });
});

describe('useMatchCast', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  const descriptor = (home: string, away: string) => ({
    identity: { source: 'timepitch', id: 'm', revision: 'r' },
    home: { id: home, name: 'H', crestUrl: null }, away: { id: away, name: 'A', crestUrl: null },
  }) as unknown as SessionDescriptor;

  it('loads both demo squads, then builds the cast; crests resolve per side', async () => {
    const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify({
      players: url.includes('arsenal-2003') ? [HENRY] : [HAALAND],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const players = [view('home:HENRYT', 'home', 'epldata:2003:arsenal:HENRYT', 'T. Henry', '14')];
    const { result } = renderHook(() => useMatchCast(descriptor('arsenal:2003', 'mancity:2024'), players));
    expect(result.current.cast).toBeNull();
    expect(result.current.crests.home.kind).not.toBe('none');
    await waitFor(() => expect(result.current.cast).not.toBeNull());
    expect(result.current.cast!.players.get('home:HENRYT')!.record?.qid).toBe('Q45901');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('a failed squad load still yields a generic cast (no records)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 500 })));
    const players = [view('home:HENRYT', 'home', 'epldata:2003:arsenal:HENRYT', 'T. Henry', '14')];
    const { result } = renderHook(() => useMatchCast(descriptor('arsenal:2003', 'mancity:2024'), players));
    await waitFor(() => expect(result.current.cast).not.toBeNull());
    expect(result.current.cast!.players.get('home:HENRYT')!.record).toBeNull();
  });

  it('teams outside the demo build immediately without fetching; unknown crest is NO_CREST', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useMatchCast(descriptor('statsbomb:1', 'statsbomb:2'), []));
    await waitFor(() => expect(result.current.cast).not.toBeNull());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.crests.away.kind).toBe('none');
  });

  it('keeps the same cast object across renders with equivalent players', async () => {
    vi.stubGlobal('fetch', vi.fn());
    let players = [view('h', 'home', null, 'A', '1')];
    const { result, rerender } = renderHook(() => useMatchCast(descriptor('statsbomb:1', 'statsbomb:2'), players));
    await waitFor(() => expect(result.current.cast).not.toBeNull());
    const first = result.current.cast;
    players = [{ ...players[0] }];
    rerender();
    expect(result.current.cast).toBe(first);
  });
});

describe('contract', () => {
  it('a built cast is a MatchCast (renderers and UI consume it without knowing provenance)', () => {
    const asMatchCast: MatchCast = buildMatchCast({ ...base, players: [] });
    expect(asMatchCast.players.size).toBe(0);
  });
});
