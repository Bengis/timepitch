// Equipaciones por temporada (spec §3.2): kits-manual.json → historical-kits.json → estimación rotulada.
// Los colores de la fuente nunca se inventan: todo hueco se rellena con una regla documentada y queda marcado
// «estimado» en `provenance` y en `source.note`.
import historicalJson from './historical-kits.json';
import manualJson from './kits-manual.json';
import crests from './historical-crests.json';
import type { AssetSource, KitSpec, MatchKits, PatternFamily } from '../presentation/types';

export const KIT_CLASH_THRESHOLD = 30;
export const ESTIMATED_LABEL = 'estimado';

const COLOUR_FIELDS = ['leftarm', 'body', 'rightarm', 'shorts', 'socks'] as const;
type ColourField = typeof COLOUR_FIELDS[number];
export type KitRole = 'home' | 'away' | 'third';

type RawPatterns = Readonly<{ la: string | null; b: string | null; ra: string | null; sh: string | null; so: string | null }>;
export type RawKit = Readonly<Record<ColourField, string | null> & { patterns: RawPatterns }>;
type RawSource = Readonly<{ title: string; revid: number | null; url: string; note?: string }>;
export type KitRegistry = Readonly<{
  version: string;
  attribution: Readonly<{ licence: string }>;
  coverage: Readonly<{ catalogue: number; with_entry: number }>;
  missing: readonly string[];
  seasons: Readonly<Record<string, Readonly<{ home: RawKit | null; away: RawKit | null; third: RawKit | null; source: RawSource; null_fields?: readonly string[] }>>>;
}>;
export type ManualKit = RawKit & Readonly<{ confidence: 'high' | 'medium'; source: RawSource; note?: string }>;
export type ManualKitRegistry = Readonly<{
  version: string;
  seasons: Readonly<Record<string, Readonly<{ home: ManualKit | null; away: ManualKit | null; third: ManualKit | null; goalkeeper: ManualKit | null; source: RawSource }>>>;
}>;

export type ClubColours = Readonly<{ shirt: string; shorts: string; socks: string; trim: string; pattern?: PatternFamily; note: string }>;

/**
 * Colores tradicionales de los 9 clubes del catálogo sin ninguna entrada en historical-kits.json.
 * Estimación de TimePitch (conocimiento general del club, valores aproximados), no de una fuente por temporada:
 * se usan solo como reserva de la primera equipación y siempre se rotulan «estimado».
 */
export const CLUB_COLOUR_TABLE: Readonly<Record<string, ClubColours>> = Object.freeze({
  barnsley: { shirt: '#D71920', shorts: '#FFFFFF', socks: '#D71920', trim: '#FFFFFF', note: 'camiseta roja, pantalón blanco' },
  birmingham: { shirt: '#0033A0', shorts: '#FFFFFF', socks: '#0033A0', trim: '#FFFFFF', note: 'camiseta azul, pantalón blanco' },
  blackpool: { shirt: '#F68712', shorts: '#FFFFFF', socks: '#F68712', trim: '#FFFFFF', note: 'camiseta mandarina, pantalón blanco' },
  ipswich: { shirt: '#0033A0', shorts: '#FFFFFF', socks: '#0033A0', trim: '#FFFFFF', note: 'camiseta azul, pantalón blanco' },
  leeds: { shirt: '#FFFFFF', shorts: '#FFFFFF', socks: '#FFFFFF', trim: '#1D428A', note: 'todo blanco con detalles azules' },
  oldham: { shirt: '#0055A4', shorts: '#0055A4', socks: '#0055A4', trim: '#FFFFFF', note: 'todo azul' },
  swindon: { shirt: '#D71920', shorts: '#FFFFFF', socks: '#D71920', trim: '#FFFFFF', note: 'camiseta roja, pantalón blanco' },
  westbrom: { shirt: '#091453', shorts: '#FFFFFF', socks: '#FFFFFF', trim: '#FFFFFF', pattern: 'stripes', note: 'rayas azul marino y blancas, pantalón blanco' },
  wimbledon: { shirt: '#00205B', shorts: '#00205B', socks: '#00205B', trim: '#FFE600', note: 'todo azul marino con detalles amarillos' },
});

/** Paleta de porteros (elección propia): se toma la de mayor contraste con las equipaciones del partido. */
export const KEEPER_PALETTE: readonly string[] = Object.freeze([
  '#1E9E4A', '#F5D20A', '#111111', '#F2711C', '#7A3FB0', '#4FD2CF', '#E5007E', '#9AA0A6',
]);

export type KitProvenance = Readonly<{
  /** manual: kits-manual; wikipedia: historical-kits; nearest_season: otra temporada del club; club_table: tabla
   *  propia; contrast: portero elegido por contraste; neutral: clave desconocida. */
  origin: 'manual' | 'wikipedia' | 'nearest_season' | 'club_table' | 'contrast' | 'neutral';
  estimated: boolean;
  /** Campos de color rellenados por estimación (vacíos o ausentes en la fuente). */
  estimatedFields: readonly string[];
  /** Ribete, dorsal y cuello: nunca vienen en la fuente; se derivan del resto. */
  derivedFields: readonly string[];
  label: typeof ESTIMATED_LABEL | null;
  confidence: 'high' | 'medium' | null;
  fromSeason?: string;
  note?: string;
}>;
export type ResolvedKit = KitSpec & Readonly<{ provenance: KitProvenance }>;
export type TeamKits = Readonly<{ home: ResolvedKit | null; away: ResolvedKit | null; third: ResolvedKit | null; keeper: ResolvedKit }>;
export type KitChoiceReason = 'no_clash' | 'estimated_kit' | 'away_used' | 'third_used' | 'no_alternative';
export type MatchKitChoice = MatchKits & Readonly<{
  home: ResolvedKit; away: ResolvedKit; homeKeeper: ResolvedKit; awayKeeper: ResolvedKit;
  reason: KitChoiceReason; visitorRole: KitRole; detail: string;
}>;

// ---------- Color ----------

function lab(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const r = lin((n >> 16) & 255), g = lin((n >> 8) & 255), b = lin(n & 255);
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b;
  const z = (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** Distancia CIE76 (ΔE*ab) entre dos colores `#RRGGBB`. */
export function colourDistance(a: string, b: string): number {
  const [l1, a1, b1] = lab(a), [l2, a2, b2] = lab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

const contrastText = (hex: string) => (lab(hex)[0] > 60 ? '#111111' : '#FFFFFF');

// ---------- Patrones ----------

const TRIM_WORDS = /shoulder|collar|border|vneck|line|band|top|bottom|lower|trim|cuff|flick|seam|sleeve|adidas|nike|kappa|socks|shorts|swoosh|button/;

/** Familia procedural para un nombre de patrón de Wikipedia (`_whitehalf`, `_redstripes`, `_arsenal9293h`…). */
export function patternFamily(wikiPattern: string | null): PatternFamily {
  const p = (wikiPattern ?? '').trim().toLowerCase().replace(/^_+/, '');
  if (!p) return 'plain';
  if (/\d/.test(p)) return 'unknown'; // patrón propio de una temporada (imagen de Commons no descargada)
  if (p.includes('pinstripe')) return 'pinstripes';
  if (p.includes('sash')) return 'sash';
  if (p.includes('half')) return 'halves';
  if (/hoop|horizontal/.test(p)) return 'hoops';
  if (TRIM_WORDS.test(p)) return 'plain'; // ribetes, cuellos, franjas de marca: cuerpo liso
  if (p.includes('stripe')) return 'stripes';
  if (p.includes('side')) return 'side_panels';
  return 'unknown';
}

// Nombres de color CSS cuando el patrón los menciona (acento de rayas, aros…).
const COLOUR_WORDS: ReadonlyArray<[RegExp, string]> = [
  [/white/, '#FFFFFF'], [/black/, '#000000'], [/navy/, '#000080'], [/sky|lightblue/, '#87CEEB'], [/blue/, '#0000FF'],
  [/claret|maroon/, '#800000'], [/red/, '#FF0000'], [/yellow/, '#FFFF00'], [/gold/, '#FFD700'], [/green/, '#008000'], [/orange/, '#FFA500'],
];
function patternColour(p: string | null): string | null {
  const s = (p ?? '').toLowerCase();
  for (const [re, hex] of COLOUR_WORDS) if (re.test(s)) return hex;
  return null;
}

// ---------- Resolutor ----------

export type KitResolverInput = Readonly<{
  historical: KitRegistry; manual: ManualKitRegistry; catalogue: readonly string[];
  clubTable: Readonly<Record<string, ClubColours>>;
}>;

type Candidate = Readonly<{ kit: RawKit; source: AssetSource; origin: 'manual' | 'wikipedia'; confidence: 'high' | 'medium' | null }>;

const ZONES: Readonly<Record<ColourField, ColourField[]>> = {
  leftarm: ['rightarm', 'body'], rightarm: ['leftarm', 'body'], body: ['leftarm', 'rightarm'], shorts: [], socks: [],
};
const KIT_KEY = /^([a-z0-9]+):(\d{4})$/;
const sameKit = (a: RawKit, b: RawKit) =>
  COLOUR_FIELDS.every((f) => a[f] === b[f]) && (['la', 'b', 'ra', 'sh', 'so'] as const).every((p) => a.patterns[p] === b.patterns[p]);
const usable = (k: RawKit | null | undefined): k is RawKit => !!k && (k.body !== null || k.leftarm !== null || k.rightarm !== null);
const freezeKit = (k: ResolvedKit): ResolvedKit => Object.freeze(k);

export function createKitResolver(input: KitResolverInput) {
  const { historical, manual, clubTable } = input;
  const catalogue = new Set(input.catalogue);
  const licence = historical.attribution.licence;

  function wikiSource(s: RawSource, note?: string): AssetSource {
    return {
      kind: 'wikipedia', title: s.title, ...(typeof s.revid === 'number' ? { revid: s.revid } : {}), url: s.url, licence,
      ...(note ? { note } : {}),
    };
  }

  /** Mejor candidato de la fuente para un rol: kits-manual primero, después historical-kits. */
  function candidate(key: string, role: KitRole | 'goalkeeper'): Candidate | null {
    const h = historical.seasons[key];
    const hk = role === 'goalkeeper' ? null : h?.[role] ?? null;
    const m = manual.seasons[key]?.[role] ?? null;
    if (m) {
      const confidence = m.confidence;
      const matches = hk && h && sameKit(m, hk);
      if (matches) return { kit: m, origin: 'wikipedia', confidence, source: wikiSource(h.source, 'completado a mano desde Wikipedia; coincide con el registro') };
      const rawNote = m.source.note ?? 'completado a mano desde Wikipedia';
      const note = typeof m.source.revid === 'number' ? rawNote : `${rawNote} (revid no disponible; leído el ${(m.source as { fetched?: string }).fetched ?? '?'})`;
      return { kit: m, origin: 'manual', confidence, source: wikiSource(m.source, note) };
    }
    if (hk && h) return { kit: hk, origin: 'wikipedia', confidence: null, source: wikiSource(h.source) };
    return null;
  }

  const seasonsByClub = new Map<string, number[]>();
  for (const key of new Set([...Object.keys(historical.seasons), ...Object.keys(manual.seasons)])) {
    const m = KIT_KEY.exec(key);
    if (!m) continue;
    const list = seasonsByClub.get(m[1]) ?? [];
    list.push(Number(m[2]));
    seasonsByClub.set(m[1], list);
  }

  /** Temporadas del club ordenadas por cercanía (empate → la anterior), sin la propia. */
  function nearestKeys(club: string, year: number): string[] {
    return (seasonsByClub.get(club) ?? [])
      .filter((y) => y !== year)
      .sort((a, b) => Math.abs(a - year) - Math.abs(b - year) || a - b)
      .map((y) => `${club}:${y}`);
  }

  function nearestField(club: string, year: number, role: KitRole, field: ColourField): string | null {
    for (const k of nearestKeys(club, year)) {
      const c = candidate(k, role)?.kit[field];
      if (c) return c;
    }
    return null;
  }

  function finish(
    raw: RawKit, club: string, year: number, role: KitRole | 'goalkeeper',
    base: Omit<KitProvenance, 'estimated' | 'estimatedFields' | 'derivedFields' | 'label'>, source: AssetSource,
    alreadyEstimated: boolean,
  ): ResolvedKit {
    const values = {} as Record<ColourField, string>;
    const estimatedFields: string[] = [];
    const table = clubTable[club];
    for (const f of COLOUR_FIELDS) {
      let v = raw[f];
      if (!v) {
        for (const s of ZONES[f]) if (!v && raw[s]) v = raw[s];
        if (!v && role !== 'goalkeeper') v = nearestField(club, year, role, f);
        if (!v && role === 'home' && table) v = f === 'shorts' ? table.shorts : f === 'socks' ? table.socks : table.shirt;
        if (!v) v = raw.body ?? raw.leftarm ?? raw.rightarm ?? raw.shorts ?? '#9AA0A6';
        estimatedFields.push(f);
      }
      values[f] = v;
    }
    const estimated = alreadyEstimated || estimatedFields.length > 0;
    const allFields = alreadyEstimated ? [...COLOUR_FIELDS] : estimatedFields;
    const shirt = values.body;
    const bodyFamily = patternFamily(raw.patterns.b);
    const number = contrastText(shirt);
    const accent = bodyFamily !== 'plain' && bodyFamily !== 'unknown' ? patternColour(raw.patterns.b) : null;
    const trim = accent && colourDistance(accent, shirt) >= KIT_CLASH_THRESHOLD ? accent
      : colourDistance(values.shorts, shirt) >= KIT_CLASH_THRESHOLD ? values.shorts : number;
    let src = source;
    if (estimatedFields.length > 0 && !alreadyEstimated) {
      src = { ...source, note: `estimado: ${estimatedFields.join(', ')} vacíos en la fuente${source.note ? `; ${source.note}` : ''}` };
    }
    return freezeKit({
      shirt, sleeves: Object.freeze({ left: values.leftarm, right: values.rightarm }),
      shorts: values.shorts, socks: values.socks, trim, number, collar: 'unknown',
      pattern: Object.freeze({
        body: bodyFamily, sleeves: patternFamily(raw.patterns.la), shorts: patternFamily(raw.patterns.sh), socks: patternFamily(raw.patterns.so),
      }),
      source: Object.freeze(src),
      provenance: Object.freeze({
        ...base, estimated, estimatedFields: Object.freeze(allFields), derivedFields: Object.freeze(['trim', 'number', 'collar']),
        label: estimated ? ESTIMATED_LABEL : null,
      }),
    });
  }

  function kitFor(key: string, club: string, year: number, role: KitRole): ResolvedKit | null {
    const own = candidate(key, role);
    if (own && usable(own.kit)) {
      return finish(own.kit, club, year, role, { origin: own.origin, confidence: own.confidence }, own.source, false);
    }
    if (role === 'third') return null; // la tercera es opcional: no se supone que existiera
    const hasEntry = Object.hasOwn(historical.seasons, key) || Object.hasOwn(manual.seasons, key);
    if (!catalogue.has(key)) return null;
    for (const k of nearestKeys(club, year)) {
      const c = candidate(k, role);
      if (!c || !usable(c.kit)) continue;
      const why = hasEntry ? 'la fuente no trae esta equipación' : 'temporada sin plantilla en la fuente';
      const note = `estimado: colores de ${k} (${why})`;
      return finish(c.kit, club, year, role, { origin: 'nearest_season', confidence: null, fromSeason: k, note }, { ...c.source, note }, true);
    }
    const t = clubTable[club];
    if (role === 'home' && t) {
      const note = `estimado: colores tradicionales del club (${t.note}); tabla propia de TimePitch`;
      const raw: RawKit = {
        leftarm: t.shirt, body: t.shirt, rightarm: t.shirt, shorts: t.shorts, socks: t.socks,
        patterns: { la: null, b: null, ra: null, sh: null, so: null },
      };
      const k = finish(raw, club, year, role, { origin: 'club_table', confidence: null, note },
        { kind: 'generic', licence: 'Tabla propia de TimePitch (estimado)', note }, true);
      return freezeKit({ ...k, trim: t.trim, pattern: Object.freeze({ ...k.pattern, body: t.pattern ?? 'plain' }) });
    }
    return null;
  }

  function contrastKeeper(avoid: readonly string[], why: string): ResolvedKit {
    let best = KEEPER_PALETTE[0], bestScore = -1;
    for (const c of KEEPER_PALETTE) {
      const score = avoid.length ? Math.min(...avoid.map((a) => colourDistance(c, a))) : 100;
      if (score > bestScore) { best = c; bestScore = score; }
    }
    const note = `estimado: portero elegido por contraste con ${why}`;
    const raw: RawKit = { leftarm: best, body: best, rightarm: best, shorts: best, socks: best, patterns: { la: null, b: null, ra: null, sh: null, so: null } };
    return finish(raw, '', 0, 'goalkeeper', { origin: 'contrast', confidence: null, note },
      { kind: 'generic', licence: 'Elección propia de TimePitch (estimado)', note }, true);
  }

  function resolveKits(teamKey: string): TeamKits {
    const m = KIT_KEY.exec(teamKey);
    const club = m?.[1] ?? '', year = m ? Number(m[2]) : 0;
    const home = m ? kitFor(teamKey, club, year, 'home') : null;
    const away = m ? kitFor(teamKey, club, year, 'away') : null;
    const third = m ? kitFor(teamKey, club, year, 'third') : null;
    const gk = candidate(teamKey, 'goalkeeper');
    const keeper = gk && usable(gk.kit)
      ? finish(gk.kit, club, year, 'goalkeeper', { origin: gk.origin, confidence: gk.confidence }, gk.source, false)
      : contrastKeeper([home, away, third].filter((k): k is ResolvedKit => !!k).map((k) => k.shirt), 'las equipaciones del equipo');
    return Object.freeze({ home, away, third, keeper });
  }

  function neutral(shirt: string, what: string): ResolvedKit {
    const note = `estimado: equipación neutra (${what} sin datos)`;
    const raw: RawKit = { leftarm: shirt, body: shirt, rightarm: shirt, shorts: shirt, socks: shirt, patterns: { la: null, b: null, ra: null, sh: null, so: null } };
    return finish(raw, '', 0, 'goalkeeper', { origin: 'neutral', confidence: null, note }, { kind: 'generic', licence: 'Elección propia de TimePitch (estimado)', note }, true);
  }

  function chooseMatchKits(homeKey: string, awayKey: string): MatchKitChoice {
    const h = resolveKits(homeKey), a = resolveKits(awayKey);
    const home = h.home ?? neutral('#D9D9D9', homeKey);
    const first = a.home ?? neutral('#3A3A3A', awayKey);
    const clashes = (k: ResolvedKit) => colourDistance(k.shirt, home.shirt) < KIT_CLASH_THRESHOLD;
    let away = first, visitorRole: KitRole = 'home', reason: KitChoiceReason;
    let detail: string;
    if (!clashes(first)) {
      reason = home.provenance.estimated || first.provenance.estimated ? 'estimated_kit' : 'no_clash';
      detail = reason === 'no_clash'
        ? 'Primeras equipaciones de ambos equipos; sin choque de colores.'
        : 'Primeras equipaciones, sin choque; alguna equipación es estimada (fuente incompleta).';
    } else {
      const d = colourDistance(first.shirt, home.shirt).toFixed(1);
      const clash = `choque de colores con el local (ΔE ${d} < ${KIT_CLASH_THRESHOLD})`;
      if (a.away && !clashes(a.away)) {
        away = a.away; visitorRole = 'away'; reason = 'away_used';
        detail = `Elección estimada: ${clash}; el visitante usa su segunda equipación.`;
      } else if (a.third && !clashes(a.third)) {
        away = a.third; visitorRole = 'third'; reason = 'third_used';
        detail = `Elección estimada: ${clash}; la segunda también choca o falta; el visitante usa su tercera.`;
      } else {
        reason = 'no_alternative';
        detail = `Elección estimada: ${clash}; sin alternativa en la fuente, se mantiene la primera.`;
      }
    }
    const outfield = [home.shirt, away.shirt];
    const keeperOk = (k: ResolvedKit, extra: readonly string[]) =>
      !k.provenance.estimated && [...outfield, ...extra].every((c) => colourDistance(k.shirt, c) >= KIT_CLASH_THRESHOLD);
    const why = 'las dos equipaciones del partido';
    const homeKeeper = keeperOk(h.keeper, []) ? h.keeper : contrastKeeper(outfield, why);
    const awayKeeper = keeperOk(a.keeper, [homeKeeper.shirt]) ? a.keeper : contrastKeeper([...outfield, homeKeeper.shirt], `${why} y el otro portero`);
    return Object.freeze({
      home, away, homeKeeper, awayKeeper,
      choice: reason === 'no_clash' ? 'source' : 'estimated',
      reason, visitorRole, detail,
    });
  }

  return { resolveKits, chooseMatchKits };
}

const defaultResolver = createKitResolver({
  historical: historicalJson as unknown as KitRegistry,
  manual: manualJson as unknown as ManualKitRegistry,
  catalogue: Object.keys(crests.seasons),
  clubTable: CLUB_COLOUR_TABLE,
});

/** Primera, segunda y tercera de `club:season_start`, más el portero (de la fuente o estimado por contraste). */
export function resolveKits(teamKey: string): TeamKits { return defaultResolver.resolveKits(teamKey); }

/** Equipaciones del partido: local con la primera; el visitante cambia si su primera choca (ΔE < umbral). */
export function chooseMatchKits(homeKey: string, awayKey: string): MatchKitChoice {
  return defaultResolver.chooseMatchKits(homeKey, awayKey);
}
