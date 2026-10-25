// Escudos híbridos (spec §3.1): SVG HD revisado (D6) → imagen HFK actual → neutro.
import hdRegistry from './crests-hd.json';
import historical from './historical-crests.json';
import { resolveHistoricalCrest } from './crests';
import { isAssetSource } from '../presentation/registry-schema';
import type { AssetSource, CrestRef } from '../presentation/types';

export type CrestHdEntry = Readonly<{
  eraId: string;
  /** Nombre del archivo servido bajo `CREST_HD_BASE`. */
  file: string;
  /** Solo `true` tras revisión visual; `false` nunca se muestra. */
  reviewed: boolean;
  /** Era cuyo archivo se reutiliza (p. ej. Manchester United 2010 → 1998). */
  shares_file_with?: string;
  /** SHA256 y tamaño del archivo servido (copia saneada). */
  sha256: string; bytes: number;
  /** Página del archivo en Wikipedia y licencia tal como figura en ella. */
  source: AssetSource;
  upload_url: string;
}>;
export type CrestHdRegistry = Readonly<{ eras: Readonly<Record<string, CrestHdEntry>> }>;

export const CREST_HD_BASE = '/assets/crests-hd/';
export const NO_CREST: CrestRef = Object.freeze({ src: '', kind: 'none', source: null });

const SAFE_FILE = /^[a-z0-9-]+\.svg$/;
const seasons = historical.seasons as Record<string, string>;
const historicalAssets = historical.assets as Record<string, { source: string; rights?: string }>;
const HFK_LICENCE = 'Copyright Historical Football Kits and reproduced by kind permission (non-commercial use with attribution)';

function hfkRef(teamKey: string): CrestRef | null {
  const crest = resolveHistoricalCrest(teamKey);
  if (!crest) return null;
  const rights = historicalAssets[crest.id]?.rights;
  const source: AssetSource = crest.source.startsWith('https://www.historicalkits.co.uk/')
    ? { kind: 'hfk', url: crest.source, licence: HFK_LICENCE }
    : { kind: 'generic', url: crest.source, licence: rights ?? 'Club trademark artwork; not freely licensed', note: 'Arsenal / adidas' };
  return Object.freeze({ src: crest.src, kind: 'hfk', source: Object.freeze(source) });
}

/** Crea un resolutor sobre un registro HD (inyectable en pruebas). */
export function createCrestResolver(registry: CrestHdRegistry) {
  const hdRefs = new Map<string, CrestRef>();
  for (const [eraId, e] of Object.entries(registry.eras)) {
    if (e.eraId !== eraId || e.reviewed !== true || !SAFE_FILE.test(e.file) || !isAssetSource(e.source)) continue;
    hdRefs.set(eraId, Object.freeze({ src: `${CREST_HD_BASE}${e.file}`, kind: 'hd', source: Object.freeze({ ...e.source }) }));
  }
  const chain = (teamKey: string): CrestRef[] => {
    const hfk = hfkRef(teamKey);
    if (!hfk) return [];
    const hd = hdRefs.get(seasons[teamKey]);
    return hd ? [hd, hfk] : [hfk];
  };
  const resolve = (teamKey: string): CrestRef => chain(teamKey)[0] ?? NO_CREST;
  return Object.assign(resolve, { chain });
}

const defaultResolver = createCrestResolver(hdRegistry as unknown as CrestHdRegistry);

/** Escudo a mostrar para `club:season_start`: HD revisado, si no HFK, si no neutro. */
export function resolveCrest(teamKey: string): CrestRef { return defaultResolver(teamKey); }

/** Orden de reserva para la carga de imágenes: `[hd, hfk]`, `[hfk]` o `[]`. */
export function crestChain(teamKey: string): CrestRef[] { return defaultResolver.chain(teamKey); }

const SAFE_DATA = /^data:image\/(?:png|jpe?g|gif|webp);/i;

/** Rechaza SVG con contenido activo o referencias externas (ingesta y prueba de los archivos servidos). */
export function sanitizeSvgText(svg: string): { ok: true } | { ok: false; reason: string } {
  if (/<!DOCTYPE|<!ENTITY/i.test(svg)) return { ok: false, reason: 'doctype or entity declaration' };
  if (/<\s*script\b/i.test(svg)) return { ok: false, reason: 'script element' };
  if (/foreignObject/i.test(svg)) return { ok: false, reason: 'foreignObject' };
  if (/<\s*(?:iframe|embed|object)\b/i.test(svg)) return { ok: false, reason: 'embedded document' };
  if (/\son[a-z]+\s*=/i.test(svg)) return { ok: false, reason: 'event handler attribute' };
  if (/javascript:/i.test(svg)) return { ok: false, reason: 'javascript URL' };
  if (/@import/i.test(svg)) return { ok: false, reason: 'CSS import' };
  for (const m of svg.matchAll(/(?:^|[\s<])(?:[\w.-]+:)?href\s*=\s*(["'])(.*?)\1/gi)) {
    const value = m[2].trim();
    if (!value.startsWith('#') && !SAFE_DATA.test(value)) return { ok: false, reason: `external href: ${value.slice(0, 40)}` };
  }
  for (const m of svg.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/gi)) {
    if (!m[2].trim().startsWith('#')) return { ok: false, reason: `external url(): ${m[2].slice(0, 40)}` };
  }
  return { ok: true };
}
