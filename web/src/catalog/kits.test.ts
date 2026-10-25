import { describe, expect, it } from 'vitest';
import historical from './historical-kits.json';
import manual from './kits-manual.json';
import crests from './historical-crests.json';
import {
  CLUB_COLOUR_TABLE, ESTIMATED_LABEL, KIT_CLASH_THRESHOLD, chooseMatchKits, colourDistance, createKitResolver,
  patternFamily, resolveKits, type KitRegistry, type ManualKitRegistry, type ResolvedKit,
} from './kits';
import { attributionsFor } from '../presentation/attribution';
import { assertNoTransfermarkt, isAssetSource } from '../presentation/registry-schema';

const HEX = /^#[0-9A-F]{6}$/;
const catalogue = new Set(Object.keys(crests.seasons));
const hist = historical as unknown as KitRegistry;
const man = manual as unknown as ManualKitRegistry;
const COLOURS = ['leftarm', 'body', 'rightarm', 'shorts', 'socks'] as const;

function kitColours(k: ResolvedKit) { return [k.shirt, k.sleeves.left, k.sleeves.right, k.shorts, k.socks, k.trim, k.number]; }

describe('registros de equipaciones', () => {
  it('only uses catalogue keys and #RRGGBB colours', () => {
    const keys = [...Object.keys(hist.seasons), ...Object.keys(man.seasons), ...hist.missing];
    for (const key of keys) expect(catalogue.has(key), key).toBe(true);
    expect(Object.keys(hist.seasons).length + hist.missing.length).toBe(catalogue.size);
    for (const reg of [hist.seasons, man.seasons] as Record<string, Record<string, unknown>>[]) {
      for (const [key, entry] of Object.entries(reg)) {
        for (const role of ['home', 'away', 'third', 'goalkeeper']) {
          const kit = entry[role] as Record<string, unknown> | null | undefined;
          if (!kit) continue;
          for (const c of COLOURS) if (kit[c] !== null) expect(kit[c], `${key}.${role}.${c}`).toMatch(HEX);
        }
      }
    }
  });

  it('keeps coverage 456/686 and every entry has a Wikipedia title and integer revid', () => {
    expect(hist.coverage.with_entry).toBe(456);
    expect(hist.coverage.catalogue).toBe(686);
    for (const [key, e] of Object.entries(hist.seasons)) {
      expect(e.source.title, key).toBeTruthy();
      expect(Number.isInteger(e.source.revid), key).toBe(true);
      expect(e.source.url, key).toMatch(/^https:\/\/en\.wikipedia\.org\//);
    }
  });

  it('marks every manual kit as completed by hand from Wikipedia with a confidence', () => {
    expect(Object.keys(man.seasons).sort()).toEqual(['arsenal:2003', 'chelsea:2015', 'mancity:2017', 'swansea:2015']);
    for (const [key, e] of Object.entries(man.seasons)) {
      expect(e.source.note, key).toBe('completado a mano desde Wikipedia');
      for (const role of ['home', 'away', 'third', 'goalkeeper'] as const) {
        const k = e[role];
        if (!k) continue;
        expect(['high', 'medium'], `${key}.${role}`).toContain(k.confidence);
        expect(k.source.note).toBe('completado a mano desde Wikipedia');
        expect(k.source.title).toBe(e.source.title);
      }
    }
  });

  it('contains no Transfermarkt fields', () => {
    expect(() => assertNoTransfermarkt(historical)).not.toThrow();
    expect(() => assertNoTransfermarkt(manual)).not.toThrow();
  });
});

describe('patternFamily', () => {
  it('maps Wikipedia pattern names to procedural families', () => {
    expect(patternFamily('_whitehalf')).toBe('halves');
    expect(patternFamily('_redstripes')).toBe('stripes');
    expect(patternFamily('_hoops_white')).toBe('hoops');
    expect(patternFamily('_blackgoldhoops')).toBe('hoops');
    expect(patternFamily('_nike_pinstripe_redblack')).toBe('pinstripes');
    expect(patternFamily('_brightblueleftsash')).toBe('sash');
    expect(patternFamily('_whitesides')).toBe('side_panels');
    expect(patternFamily('_whiteborder')).toBe('plain');
    expect(patternFamily('_shoulder_stripes_white_stripes')).toBe('plain');
    expect(patternFamily(null)).toBe('plain');
    expect(patternFamily('')).toBe('plain');
    expect(patternFamily('_arsenal9293h')).toBe('unknown');
  });
});

describe('colourDistance', () => {
  it('is CIE76 over Lab', () => {
    expect(colourDistance('#FFFFFF', '#FFFFFF')).toBe(0);
    expect(colourDistance('#000000', '#FFFFFF')).toBeCloseTo(100, 0);
    expect(colourDistance('#FFFFFF', '#FAFAFA')).toBeLessThan(KIT_CLASH_THRESHOLD);
    expect(colourDistance('#0000FF', '#FFFFFF')).toBeGreaterThan(KIT_CLASH_THRESHOLD);
    expect(KIT_CLASH_THRESHOLD).toBe(30);
  });
});

describe('resolveKits con los registros reales', () => {
  it('resolves Chelsea 2015/16 to its Wikipedia colours', () => {
    const k = resolveKits('chelsea:2015');
    expect(k.home!.shirt).toBe('#0000FF');
    expect(k.home!.shorts).toBe('#0000FF');
    expect(k.home!.socks).toBe('#FFFFFF');
    expect(k.away!.shirt).toBe('#FFFFFF');
    expect(k.away!.socks).toBe('#0000FF');
    expect(k.third!.shirt).toBe('#000000');
    expect(k.home!.provenance.estimated).toBe(false);
    expect(k.home!.provenance.confidence).toBe('high');
    expect(k.home!.source).toMatchObject({ kind: 'wikipedia', title: '2015–16 Chelsea F.C. season', revid: 1376278286, licence: 'CC BY-SA 4.0' });
    expect(k.home!.source.note).toContain('completado a mano desde Wikipedia');
    // Portero del artículo («Goalkeeper 1»), sin revid: enlaza el artículo.
    expect(k.keeper.shirt).toBe('#4FD2CF');
    expect(k.keeper.provenance.origin).toBe('manual');
    expect(k.keeper.provenance.confidence).toBe('medium');
    expect(k.keeper.source.revid).toBeUndefined();
    expect(k.keeper.source.url).toBe('https://en.wikipedia.org/wiki/2015%E2%80%9316_Chelsea_F.C._season');
  });

  it('resolves Swansea 2015/16 to its Wikipedia colours (away kept literal, medium confidence)', () => {
    const k = resolveKits('swansea:2015');
    expect(k.home!.shirt).toBe('#FFFFFF');
    expect(k.away!.shirt).toBe('#00FF00');
    expect(k.away!.sleeves).toEqual({ left: '#000060', right: '#000060' });
    expect(k.away!.provenance.confidence).toBe('medium');
    expect(k.third).toBeNull();
    expect(k.keeper.provenance.estimated).toBe(true);
    expect(k.keeper.provenance.label).toBe(ESTIMATED_LABEL);
  });

  it('keeps the revid of the registry entry (blackburn:2001)', () => {
    const k = resolveKits('blackburn:2001');
    expect(k.home!.source.revid).toBe(1321443254);
    expect(k.home!.pattern.body).toBe('halves');
  });

  it('fills null source fields with an explicit estimate', () => {
    const k = resolveKits('arsenal:2006');
    expect(k.home!.shirt).toBe('#FF0000');
    expect(k.home!.sleeves.left).toBe('#FF0000');
    expect(k.home!.provenance.estimated).toBe(true);
    expect(k.home!.provenance.estimatedFields).toEqual(expect.arrayContaining(['leftarm', 'rightarm', 'shorts', 'socks']));
    expect(k.home!.source.note).toMatch(/^estimado/);
    expect(kitColours(k.home!).every((c) => HEX.test(c))).toBe(true);
  });

  it('falls back to the nearest season of the same club for a missing season, marked estimated', () => {
    expect(hist.missing).toContain('everton:2005');
    const k = resolveKits('everton:2005');
    expect(k.home).not.toBeNull();
    expect(k.home!.provenance).toMatchObject({ origin: 'nearest_season', estimated: true, label: 'estimado' });
    expect(k.home!.provenance.fromSeason).toMatch(/^everton:\d{4}$/);
    expect(k.home!.source.note).toMatch(/^estimado/);
    expect(k.third).toBeNull();
  });

  it('uses the documented club table, marked estimated, for clubs without any registry entry', () => {
    const k = resolveKits('leeds:1995');
    expect(k.home!.provenance).toMatchObject({ origin: 'club_table', estimated: true, label: 'estimado' });
    expect(k.home!.shirt).toBe(CLUB_COLOUR_TABLE.leeds.shirt);
    expect(k.home!.source.kind).toBe('generic');
    expect(k.away).toBeNull();
    for (const club of ['barnsley', 'birmingham', 'blackpool', 'ipswich', 'leeds', 'oldham', 'swindon', 'westbrom', 'wimbledon']) {
      const t = CLUB_COLOUR_TABLE[club];
      expect(t, club).toBeDefined();
      for (const c of [t.shirt, t.shorts, t.socks, t.trim]) expect(c, club).toMatch(HEX);
      expect(t.note, club).toBeTruthy();
    }
  });

  it('every catalogue key resolves to a valid home kit and keeper', () => {
    for (const key of catalogue) {
      const k = resolveKits(key);
      expect(k.home, key).not.toBeNull();
      for (const kit of [k.home!, k.keeper, k.away, k.third]) {
        if (!kit) continue;
        expect(kitColours(kit).every((c) => HEX.test(c)), key).toBe(true);
        expect(isAssetSource(kit.source), key).toBe(true);
        if (kit.provenance.estimated) expect(kit.provenance.label, key).toBe('estimado');
      }
    }
  });

  it('returns a neutral generic kit for an unknown key', () => {
    const k = resolveKits('nadie:1900');
    expect(k.home).toBeNull();
    expect(k.away).toBeNull();
    expect(k.keeper.provenance.estimated).toBe(true);
  });
});

describe('chooseMatchKits con los registros reales', () => {
  it('Chelsea–Swansea 2015/16: both first kits, no clash, source choice', () => {
    const m = chooseMatchKits('chelsea:2015', 'swansea:2015');
    expect(m.home.shirt).toBe('#0000FF');
    expect(m.away.shirt).toBe('#FFFFFF');
    expect(m.choice).toBe('source');
    expect(m.reason).toBe('no_clash');
    expect(m.visitorRole).toBe('home');
  });

  it('keepers contrast both outfield kits and each other', () => {
    for (const [h, a] of [['chelsea:2015', 'swansea:2015'], ['fulham:2010', 'swansea:2015'], ['leeds:1995', 'wimbledon:1995']]) {
      const m = chooseMatchKits(h, a);
      const outfield = [m.home.shirt, m.away.shirt];
      for (const c of outfield) {
        expect(colourDistance(m.homeKeeper.shirt, c), `${h} gk vs ${c}`).toBeGreaterThanOrEqual(KIT_CLASH_THRESHOLD);
        expect(colourDistance(m.awayKeeper.shirt, c), `${a} gk vs ${c}`).toBeGreaterThanOrEqual(KIT_CLASH_THRESHOLD);
      }
      expect(colourDistance(m.homeKeeper.shirt, m.awayKeeper.shirt)).toBeGreaterThanOrEqual(KIT_CLASH_THRESHOLD);
    }
  });

  it('Fulham 2010 (white) v Swansea 2015 (white): the visitor switches to its away kit', () => {
    const m = chooseMatchKits('fulham:2010', 'swansea:2015');
    expect(m.home.shirt).toBe('#FFFFFF');
    expect(m.away.shirt).toBe('#00FF00');
    expect(m.choice).toBe('estimated');
    expect(m.reason).toBe('away_used');
    expect(m.visitorRole).toBe('away');
    expect(m.detail).toContain('choque');
  });

  it('provides Wikipedia attribution data for the chosen kits', () => {
    const kits = chooseMatchKits('chelsea:2015', 'swansea:2015');
    const lines = attributionsFor({ source: 'timepitch', crests: [], kits, cast: null, engine: null });
    const wiki = lines.filter((l) => l.id.startsWith('wikipedia:'));
    expect(wiki.map((l) => l.text).join('\n')).toContain('2015–16 Chelsea F.C. season');
    expect(wiki.map((l) => l.text).join('\n')).toContain('2015–16 Swansea City A.F.C. season');
    expect(wiki.some((l) => l.url?.includes('oldid=1376278286'))).toBe(true);
    for (const l of wiki) expect(l.licence).toBe('CC BY-SA 4.0');
  });
});

// Fixtures inyectados: casos de choque controlados.
const kit = (body: string, shorts = body, socks = body) => ({ leftarm: body, body, rightarm: body, shorts, socks, patterns: { la: null, b: null, ra: null, sh: null, so: null } });
const src = (title: string, revid: number) => ({ title, revid, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}` });
const FIX: KitRegistry = {
  version: 'test', attribution: { licence: 'CC BY-SA 4.0' },
  coverage: { catalogue: 6, with_entry: 5 },
  missing: ['gone:2000'],
  seasons: {
    'white:2000': { home: kit('#FFFFFF'), away: kit('#FF0000'), third: kit('#000080'), source: src('White 2000', 1) },
    'whiteb:2000': { home: kit('#FDFDFD'), away: kit('#FAFAFA'), third: kit('#111111'), source: src('WhiteB 2000', 2) },
    'whitec:2000': { home: kit('#FEFEFE'), away: kit('#F8F8F8'), third: null, source: src('WhiteC 2000', 3) },
    'whited:2000': { home: kit('#FCFCFC'), away: null, third: null, source: src('WhiteD 2000', 4) },
    'gone:2001': { home: kit('#00AA00', '#FFFFFF'), away: kit('#FFFF00'), third: null, source: src('Gone 2001', 5) },
  },
};
const MAN: ManualKitRegistry = {
  version: 'test',
  seasons: {
    'white:2000': {
      home: { ...kit('#EEEEEE'), confidence: 'high', source: { title: 'White 2000', revid: null, url: 'https://en.wikipedia.org/wiki/White_2000', note: 'completado a mano desde Wikipedia' } },
      away: null, third: null, goalkeeper: null,
      source: { title: 'White 2000', revid: null, url: 'https://en.wikipedia.org/wiki/White_2000', note: 'completado a mano desde Wikipedia' },
    },
  },
};
const catalogueFix = ['white:2000', 'whiteb:2000', 'whitec:2000', 'whited:2000', 'gone:2000', 'gone:2001'];
const r = createKitResolver({ historical: FIX, manual: { version: 'test', seasons: {} }, catalogue: catalogueFix, clubTable: {} });

describe('chooseMatchKits: regla de choque (fixtures)', () => {
  it('two white first kits: the visitor gets its away kit, estimated', () => {
    const m = r.chooseMatchKits('white:2000', 'whitec:2000');
    // La segunda de whitec también es blanca y no tiene tercera → se mantiene la primera.
    expect(m.away.shirt).toBe('#FEFEFE');
    expect(m.visitorRole).toBe('home');
    expect(m.reason).toBe('no_alternative');
    expect(m.choice).toBe('estimated');
  });

  it('visitor away clashes too → third', () => {
    const m = r.chooseMatchKits('white:2000', 'whiteb:2000');
    expect(m.away.shirt).toBe('#111111');
    expect(m.visitorRole).toBe('third');
    expect(m.reason).toBe('third_used');
    expect(m.choice).toBe('estimated');
  });

  it('visitor away does not clash → away', () => {
    const m = r.chooseMatchKits('whiteb:2000', 'white:2000');
    expect(m.away.shirt).toBe('#FF0000');
    expect(m.visitorRole).toBe('away');
    expect(m.reason).toBe('away_used');
    expect(m.choice).toBe('estimated');
    expect(m.detail).toMatch(/choque/);
  });

  it('no alternative → keeps the first kit, estimated', () => {
    const m = r.chooseMatchKits('white:2000', 'whited:2000');
    expect(m.away.shirt).toBe('#FCFCFC');
    expect(m.visitorRole).toBe('home');
    expect(m.reason).toBe('no_alternative');
    expect(m.choice).toBe('estimated');
  });

  it('missing season falls back to the nearest season, estimated, and makes the choice estimated', () => {
    const k = r.resolveKits('gone:2000');
    expect(k.home!.shirt).toBe('#00AA00');
    expect(k.home!.provenance).toMatchObject({ origin: 'nearest_season', fromSeason: 'gone:2001', estimated: true });
    expect(k.home!.source).toMatchObject({ kind: 'wikipedia', title: 'Gone 2001', revid: 5 });
    const m = r.chooseMatchKits('white:2000', 'gone:2000');
    expect(m.reason).toBe('estimated_kit');
    expect(m.choice).toBe('estimated');
  });

  it('kits-manual has priority over historical-kits for the same key', () => {
    const rm = createKitResolver({ historical: FIX, manual: MAN, catalogue: catalogueFix, clubTable: {} });
    const k = rm.resolveKits('white:2000');
    expect(k.home!.shirt).toBe('#EEEEEE');
    expect(k.home!.provenance.origin).toBe('manual');
    expect(k.home!.source.note).toContain('completado a mano desde Wikipedia');
    expect(k.away!.shirt).toBe('#FF0000');
    expect(k.away!.provenance.origin).toBe('wikipedia');
  });
});
