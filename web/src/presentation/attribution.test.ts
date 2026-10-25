import { describe, expect, it } from 'vitest';
import { attributionsFor, type AttributionInput } from './attribution';
import { GENERIC_APPEARANCE, type AssetSource, type CastEntry, type CrestRef, type KitSpec, type MatchKits, type PlayerRecord } from './types';

const HFK: CrestRef = { src: '/assets/crests/chelsea-2005.png', kind: 'hfk', source: { kind: 'hfk', licence: 'non-commercial with attribution', url: 'https://www.historicalkits.co.uk/' } };
const HFK2: CrestRef = { src: '/assets/crests/swansea-2011.png', kind: 'hfk', source: { kind: 'hfk', licence: 'non-commercial with attribution' } };
const HD: CrestRef = { src: '/assets/crests-hd/arsenal-2002.svg', kind: 'hd', source: { kind: 'wikipedia', title: 'File:Arsenal FC.svg', url: 'https://en.wikipedia.org/wiki/File:Arsenal_FC.svg', licence: 'non-free logo' } };
const NONE: CrestRef = { src: '', kind: 'none', source: null };
// Tal como lo devuelve resolveCrest('arsenal:2024'): nivel hfk, pero fuente Arsenal/adidas.
const ARSENAL_2024: CrestRef = { src: '/assets/crests/arsenal-2024.png', kind: 'hfk', source: { kind: 'generic', url: 'https://news.adidas.com/football/the-cannon-returns', licence: 'Arsenal FC trademark artwork; editorial identity reference, not freely licensed artwork.', note: 'Arsenal / adidas' } };

const WIKI_KIT: AssetSource = { kind: 'wikipedia', title: '2015–16 Chelsea F.C. season', revid: 1234567, licence: 'CC BY-SA 4.0' };
const kit = (source: AssetSource): KitSpec => ({
  shirt: '#034694', sleeves: { left: '#034694', right: '#034694' }, shorts: '#034694', socks: '#ffffff', trim: '#ffffff', number: '#ffffff',
  collar: 'crew', pattern: { body: 'plain', sleeves: 'plain', shorts: 'plain', socks: 'plain' }, source,
});
const GENERIC_KIT = kit({ kind: 'generic', licence: 'TimePitch' });
const KITS_GENERIC: MatchKits = { home: GENERIC_KIT, away: GENERIC_KIT, homeKeeper: GENERIC_KIT, awayKeeper: GENERIC_KIT, choice: 'estimated' };
const KITS_WIKI: MatchKits = { home: kit(WIKI_KIT), away: kit(WIKI_KIT), homeKeeper: GENERIC_KIT, awayKeeper: GENERIC_KIT, choice: 'source' };

const record: PlayerRecord = { qid: 'Q1', number: '10', display: 'X', position: 'MF', nation: 'ENG', dob: null, heightCm: null, fields: {} };
const entry = (r: PlayerRecord | null): CastEntry => ({ number: '10', displayName: 'X', appearance: GENERIC_APPEARANCE, appearanceSource: 'generic', record: r });

const base: AttributionInput = { source: 'timepitch', crests: [], kits: KITS_GENERIC, cast: null, engine: null };
const ids = (input: Partial<AttributionInput>) => attributionsFor({ ...base, ...input }).map((l) => l.id);
const line = (input: Partial<AttributionInput>, id: string) => attributionsFor({ ...base, ...input }).find((l) => l.id === id);

describe('attributionsFor', () => {
  it('always lists Three.js MIT, the club trademark notice and own art', () => {
    const lines = attributionsFor(base);
    const three = lines.find((l) => l.id === 'threejs');
    expect(three).toMatchObject({ licence: 'MIT', url: '/licenses/three.txt' });
    expect(three!.text).toContain('Three.js');
    expect(lines.find((l) => l.id === 'trademarks')!.text).toContain('TimePitch no está respaldado');
    expect(lines.find((l) => l.id === 'own-art')!.text).toMatch(/no son fotografías/);
  });

  it('HFK crest gives the HFK permission line with the non-commercial note, only once', () => {
    const lines = attributionsFor({ ...base, crests: [HFK, HFK2] }).filter((l) => l.id.startsWith('crest'));
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toContain('Copyright Historical Football Kits and reproduced by kind permission');
    expect(lines[0].licence).toMatch(/no comercial/i);
    expect(lines[0].url).toBe('https://www.historicalkits.co.uk/');
  });

  it('HD crest gives the file title, its licence as written on the file page and the file page link', () => {
    const l = line({ crests: [HD] }, 'crest:hd:File:Arsenal FC.svg');
    expect(l).toMatchObject({ licence: 'non-free logo', url: 'https://en.wikipedia.org/wiki/File:Arsenal_FC.svg' });
    expect(l!.text).toContain('File:Arsenal FC.svg');
    expect(ids({ crests: [NONE] }).some((id) => id.startsWith('crest'))).toBe(false);
  });

  it('HFK-tier crest from a non-HFK source (Arsenal 2024) is credited by its own source, not as HFK', () => {
    const lines = attributionsFor({ ...base, crests: [ARSENAL_2024] }).filter((l) => l.id.startsWith('crest'));
    expect(lines).toHaveLength(1);
    expect(lines[0].text).not.toContain('Historical Football Kits');
    expect(lines[0].text).toContain('Arsenal / adidas');
    expect(lines[0]).toMatchObject({ licence: ARSENAL_2024.source!.licence, url: ARSENAL_2024.source!.url });
    const both = attributionsFor({ ...base, crests: [HFK, ARSENAL_2024] }).filter((l) => l.id.startsWith('crest'));
    expect(both).toHaveLength(2);
  });

  it('Commons sources are labelled Wikimedia Commons, not a Wikipedia article', () => {
    const commonsKit = kit({ kind: 'commons', title: 'File:Kit body.svg', revid: 42, licence: 'CC BY-SA 3.0' });
    const kl = attributionsFor({ ...base, kits: { ...KITS_GENERIC, home: commonsKit } }).find((l) => l.id.startsWith('wikipedia:'));
    expect(kl!.text).toContain('Wikimedia Commons');
    expect(kl!.text).not.toContain('artículo de Wikipedia');
    expect(kl!.url).toMatch(/^https:\/\/commons\.wikimedia\.org\//);
    const crest: CrestRef = { src: '/assets/crests-hd/x.svg', kind: 'hd', source: { kind: 'commons', title: 'File:X.svg', url: 'https://commons.wikimedia.org/wiki/File:X.svg', licence: 'PD' } };
    const cl = attributionsFor({ ...base, crests: [crest] }).find((l) => l.id.startsWith('crest'));
    expect(cl!.text).toContain('Wikimedia Commons');
    expect(cl!.text).not.toMatch(/Wikipedia,/);
  });

  it('Wikipedia kit gives article, revid and CC BY-SA 4.0 with a permanent link, deduplicated', () => {
    const kits = attributionsFor({ ...base, kits: KITS_WIKI }).filter((l) => l.id.startsWith('wikipedia:'));
    expect(kits).toHaveLength(1);
    expect(kits[0].text).toContain('2015–16 Chelsea F.C. season');
    expect(kits[0].text).toContain('1234567');
    expect(kits[0].licence).toBe('CC BY-SA 4.0');
    expect(kits[0].url).toBe('https://en.wikipedia.org/w/index.php?title=2015%E2%80%9316_Chelsea_F.C._season&oldid=1234567');
    expect(ids({ kits: KITS_GENERIC }).some((id) => id.startsWith('wikipedia:'))).toBe(false);
  });

  it('any cast record gives one Wikidata CC0 line; no record gives none', () => {
    const cast = { kits: KITS_GENERIC, players: new Map([['a', entry(record)], ['b', entry(record)], ['c', entry(null)]]) };
    const wd = attributionsFor({ ...base, cast }).filter((l) => l.id === 'wikidata');
    expect(wd).toHaveLength(1);
    expect(wd[0].licence).toBe('CC0');
    const noRecord = { kits: KITS_GENERIC, players: new Map([['c', entry(null)]]) };
    expect(ids({ cast: noRecord })).not.toContain('wikidata');
  });

  it('record fields taken from a Wikipedia article are credited like the kit article (no duplicate)', () => {
    const r: PlayerRecord = { ...record, fields: { number: WIKI_KIT, position: WIKI_KIT } };
    const cast = { kits: KITS_WIKI, players: new Map([['a', entry(r)]]) };
    expect(attributionsFor({ ...base, kits: KITS_WIKI, cast }).filter((l) => l.id.startsWith('wikipedia:'))).toHaveLength(1);
  });

  it('historical source credits StatsBomb Open Data; simulated sources do not', () => {
    const sb = line({ source: 'historical' }, 'statsbomb');
    expect(sb!.text).toContain('StatsBomb');
    expect(sb!.url).toBe('https://github.com/hudl/open-data');
    expect(ids({ source: 'grf' })).not.toContain('statsbomb');
  });

  it('engine lines: GRF Apache-2.0 (modified), TouchLines AGPL-3.0 with TimePitch source offer', () => {
    const grf = line({ engine: 'grf' }, 'engine:grf');
    expect(grf!.licence).toContain('Apache-2.0');
    expect(grf!.text).toMatch(/modificad/);
    const tl = line({ engine: 'touchlines' }, 'engine:touchlines');
    expect(tl!.licence).toContain('AGPL-3.0');
    expect(tl!.text).toMatch(/código fuente/);
    expect(tl!.url).toMatch(/timepitch/);
    expect(ids({ engine: null }).some((id) => id.startsWith('engine:'))).toBe(false);
  });

  it('open-football: Apache-2.0 with the upstream link and a notice of the TimePitch effort-knobs modification', () => {
    const of = line({ engine: 'open-football' }, 'engine:open-football');
    expect(of!.licence).toBe('Apache-2.0');
    expect(of!.url).toBe('https://github.com/ZOXEXIVO/open-football');
    expect(of!.text).toMatch(/bfb2273/);
    expect(of!.text).toMatch(/modificad[ao] por TimePitch/);
    expect(of!.text).toMatch(/esfuerzo/);
    expect(ids({ engine: 'open-football' }).filter((id) => id.startsWith('engine:'))).toEqual(['engine:open-football']);
  });

  it('TouchLines also names its upstream and the AGPL source offer; GRF names its upstream', () => {
    expect(line({ engine: 'touchlines' }, 'engine:touchlines')!.text).toMatch(/github\.com\/brenosss\/touchlines.*5c5c71a/);
    expect(line({ engine: 'grf' }, 'engine:grf')!.url).toBe('https://github.com/google-research/football');
  });

  it('never returns duplicate ids', () => {
    const cast = { kits: KITS_WIKI, players: new Map([['a', entry(record)]]) };
    const all = ids({ source: 'historical', crests: [HFK, HFK2, HD, HD, NONE], kits: KITS_WIKI, cast, engine: 'touchlines' });
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('attributionsFor in English (TP221)', () => {
  const cast = { kits: KITS_WIKI, players: new Map([['a', entry(record)]]) };
  const full: AttributionInput = { source: 'historical', crests: [HFK, HD, ARSENAL_2024], kits: KITS_WIKI, cast, engine: 'touchlines' };
  const en = attributionsFor(full, 'en');
  const es = attributionsFor(full, 'es');

  it('keeps the same lines, ids, URLs and licence names in both languages', () => {
    expect(en.map((l) => l.id)).toEqual(es.map((l) => l.id));
    expect(en.map((l) => l.url)).toEqual(es.map((l) => l.url));
    for (const id of ['crest:hd:File:Arsenal FC.svg', 'wikipedia:2015–16 Chelsea F.C. season:1234567', 'wikidata', 'engine:touchlines', 'threejs']) {
      expect(en.find((l) => l.id === id)!.licence).toBe(es.find((l) => l.id === id)!.licence);
    }
    expect(attributionsFor(full)).toEqual(es);
  });

  it('keeps the HFK permission phrase literal and translates the rest', () => {
    const hfk = en.find((l) => l.id === 'crest:hfk')!;
    expect(hfk.text).toBe('Historical crests: Copyright Historical Football Kits and reproduced by kind permission.');
    expect(hfk.licence).toBe('Non-commercial use with attribution');
    expect(es.find((l) => l.id === 'crest:hfk')!.text).toBe('Escudos históricos: Copyright Historical Football Kits and reproduced by kind permission.');
  });

  it('has no Spanish wording in English and keeps titles, revisions and upstream names', () => {
    const text = en.map((l) => `${l.text} ${l.licence}`).join('\n');
    expect(text).not.toMatch(/Escudo|Equipación|artículo|revisión|Datos|Motor:|marcas|Arte propio|uso no comercial|código fuente/);
    const kit = en.find((l) => l.id.startsWith('wikipedia:'))!;
    expect(kit.text).toBe('Kit: Wikipedia article “2015–16 Chelsea F.C. season” (revision 1234567); derived data is published under the same licence.');
    expect(en.find((l) => l.id === 'crest:hd:File:Arsenal FC.svg')!.text).toBe('Crest: Wikipedia, file File:Arsenal FC.svg.');
    expect(en.find((l) => l.id.startsWith('crest:src:'))!.text).toBe('Crest: Arsenal / adidas.');
    expect(en.find((l) => l.id === 'statsbomb')!.text).toBe('Event data: StatsBomb Open Data (Hudl).');
    expect(en.find((l) => l.id === 'engine:touchlines')!.text).toMatch(/brenosss.*5c5c71a.*AGPL-3\.0.*source code/);
    expect(en.find((l) => l.id === 'threejs')!.text).toBe('3D graphics: Three.js (© three.js authors).');
    expect(en.find((l) => l.id === 'trademarks')!.text).toContain('TimePitch is not endorsed');
  });

  it('translates the GRF and open-football engine lines', () => {
    expect(line({ engine: 'grf' }, 'engine:grf')!.text).toMatch(/modificado/);
    expect(attributionsFor({ ...base, engine: 'grf' }, 'en').find((l) => l.id === 'engine:grf')!.text).toMatch(/© Google LLC.*modified by TimePitch.*The Unlicense/);
    expect(attributionsFor({ ...base, engine: 'open-football' }, 'en').find((l) => l.id === 'engine:open-football')!.text).toMatch(/bfb2273.*modified by TimePitch.*movement effort/);
  });
});
