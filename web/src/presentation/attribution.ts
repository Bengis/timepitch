// Créditos y licencias construidos con la procedencia de lo que realmente se muestra (spec §8).
// TP221: textos en inglés y español. Quedan literales los nombres de licencia, los títulos de archivo y artículo, los
// avisos de copyright y la frase de permiso de HFK, que se reproduce tal como la exige su autor.
import type { Locale } from '../i18n';
import type { MatchSource } from '../match-centre/session';
import type { AssetSource, CrestRef, MatchCast, MatchKits } from './types';

export type AttributionLine = Readonly<{ id: string; text: string; licence: string; url: string | null }>;

export type AttributionInput = Readonly<{
  source: MatchSource;
  crests: readonly CrestRef[];
  kits: MatchKits;
  cast: MatchCast | null;
  engine: 'grf' | 'touchlines' | 'open-football' | 'timepitch' | null;
}>;

/** Código fuente de TimePitch ofrecido a los usuarios si el motor es TouchLines (AGPL-3.0 §13). */
export const TIMEPITCH_SOURCE_URL = 'https://github.com/Bengis/timepitch';

const HFK_URL = 'https://www.historicalkits.co.uk/';
/** Frase de permiso de Historical Football Kits: no se traduce. */
export const HFK_PERMISSION = 'Copyright Historical Football Kits and reproduced by kind permission.';

const TEXTS = {
  en: {
    kit: 'Kit', playerFields: 'Shirt number, position and nationality',
    revision: (rev: string | number) => ` (revision ${rev})`,
    commonsFile: 'Wikimedia Commons file', wikipediaArticle: 'Wikipedia article', quote: (t: string) => `“${t}”`,
    shareAlike: 'derived data is published under the same licence.',
    hfkCrests: 'Historical crests', hfkLicence: 'Non-commercial use with attribution',
    crestFile: (origin: string, title: string) => `Crest: ${origin}, file ${title}.`,
    crestOther: (note: string | undefined) => `Crest: ${note ?? 'see the linked source'}.`,
    statsbomb: 'Event data: StatsBomb Open Data (Hudl).',
    statsbombLicence: 'StatsBomb Open Data (non-commercial use; logo and attribution required)',
    wikidata: 'Player data (date of birth, height, identifiers): Wikidata.',
    grf: 'Engine: Google Research Football (© Google LLC), built and modified by TimePitch; native engine based on GameplayFootball (The Unlicense).',
    touchlines: 'Engine: TouchLines (brenosss and contributors; https://github.com/brenosss/touchlines, commit 5c5c71a), packaged with calibration adjustments in the TimePitch harness. TimePitch is distributed under AGPL-3.0: the complete source code is available in its repository.',
    openFootball: 'Engine: open-football (ZOXEXIVO and contributors), commit bfb2273, modified by TimePitch: a harness patch that adjusts movement effort (speed, sprint and acceleration).',
    three: '3D graphics: Three.js (© three.js authors).',
    quaternius: '3D players: body, hair and motion-captured animations from Universal Base Characters and Universal Animation Library by Quaternius, trimmed and recoloured for TimePitch.',
    trademarks: 'Crests are trademarks of their clubs; TimePitch is not endorsed by them.', trademarksLicence: 'Registered trademarks',
    ownArt: 'Avatars, stadium and 3D kits: procedural artwork by TimePitch; they are not photographs or official artwork.',
    ownArtLicence: 'TimePitch original artwork',
    retro16Art: 'Retro 16-bit graphics: original pixel art by TimePitch (players, hairstyles, shirt-number lettering, stadium); not taken from any game. The referee and assistants are illustrative figures placed by fixed rules: they are not in the engine data.',
  },
  es: {
    kit: 'Equipación', playerFields: 'Dorsal, posición y nacionalidad',
    revision: (rev: string | number) => ` (revisión ${rev})`,
    commonsFile: 'archivo de Wikimedia Commons', wikipediaArticle: 'artículo de Wikipedia', quote: (t: string) => `«${t}»`,
    shareAlike: 'los datos derivados se publican bajo la misma licencia.',
    hfkCrests: 'Escudos históricos', hfkLicence: 'Uso no comercial con atribución',
    crestFile: (origin: string, title: string) => `Escudo: ${origin}, archivo ${title}.`,
    crestOther: (note: string | undefined) => `Escudo: ${note ?? 'referencia de la fuente enlazada'}.`,
    statsbomb: 'Datos de eventos: StatsBomb Open Data (Hudl).',
    statsbombLicence: 'StatsBomb Open Data (uso no comercial, logo y atribución obligatorios)',
    wikidata: 'Datos de jugadores (fecha de nacimiento, altura, identificadores): Wikidata.',
    grf: 'Motor: Google Research Football (© Google LLC), compilado y modificado por TimePitch; motor nativo basado en GameplayFootball (The Unlicense).',
    touchlines: 'Motor: TouchLines (brenosss y colaboradores; https://github.com/brenosss/touchlines, commit 5c5c71a), empaquetado con ajustes de calibración en el arnés de TimePitch. TimePitch se distribuye bajo AGPL-3.0: el código fuente completo está disponible en su repositorio.',
    openFootball: 'Motor: open-football (ZOXEXIVO y colaboradores), commit bfb2273, modificado por TimePitch: parche del arnés que ajusta el esfuerzo de movimiento (velocidad, sprint y aceleración).',
    three: 'Gráficos 3D: Three.js (© three.js authors).',
    quaternius: 'Jugadores 3D: cuerpo, pelo y animaciones capturadas de Universal Base Characters y Universal Animation Library, de Quaternius, recortados y recoloreados para TimePitch.',
    trademarks: 'Los escudos son marcas de sus clubes; TimePitch no está respaldado por ellos.', trademarksLicence: 'Marcas registradas',
    ownArt: 'Avatares, estadio y equipaciones 3D: dibujo procedural de TimePitch; no son fotografías ni arte oficial.',
    ownArtLicence: 'Arte propio de TimePitch',
    retro16Art: 'Gráficos Retro 16 bits: pixel art propio de TimePitch (jugadores, peinados, letra de dorsales, estadio); no procede de ningún juego. Árbitro y asistentes son figurantes ilustrativos colocados por reglas fijas: no están en los datos del motor.',
  },
} as const;
type Texts = (typeof TEXTS)[Locale];

function wikipediaLine(s: AssetSource, what: string, t: Texts): AttributionLine | null {
  if ((s.kind !== 'wikipedia' && s.kind !== 'commons') || !s.title) return null;
  const rev = s.revid ?? s.revision;
  const url = rev !== undefined
    ? `https://${s.kind === 'commons' ? 'commons.wikimedia.org' : 'en.wikipedia.org'}/w/index.php?title=${encodeURIComponent(s.title.replace(/ /g, '_'))}&oldid=${rev}`
    : s.url ?? null;
  const revText = rev !== undefined ? t.revision(rev) : '';
  const origin = s.kind === 'commons' ? t.commonsFile : t.wikipediaArticle;
  return {
    id: `wikipedia:${s.title}:${rev ?? ''}`,
    text: `${what}: ${origin} ${t.quote(s.title)}${revText}; ${t.shareAlike}`,
    licence: s.licence, url,
  };
}

// Se acredita por la fuente real del escudo, no por su nivel: un escudo de nivel `hfk`
// puede venir de otra fuente (Arsenal 2024: Arsenal/adidas).
function crestLine(c: CrestRef, t: Texts): AttributionLine | null {
  const s = c.source;
  if (c.kind === 'none' || !s) return null;
  if (s.kind === 'hfk') {
    return { id: 'crest:hfk', text: `${t.hfkCrests}: ${HFK_PERMISSION}`, licence: t.hfkLicence, url: HFK_URL };
  }
  if ((s.kind === 'wikipedia' || s.kind === 'commons') && s.title) {
    return {
      id: `crest:hd:${s.title}`,
      text: t.crestFile(s.kind === 'commons' ? 'Wikimedia Commons' : 'Wikipedia', s.title),
      licence: s.licence, url: s.url ?? null,
    };
  }
  if (s.url || s.note) {
    return { id: `crest:src:${s.url ?? s.note}`, text: t.crestOther(s.note), licence: s.licence, url: s.url ?? null };
  }
  return null;
}

/** Líneas de créditos en el idioma pedido; por defecto español, como antes de TP221. */
export function attributionsFor(input: AttributionInput, locale: Locale = 'es'): AttributionLine[] {
  const t = TEXTS[locale];
  const out = new Map<string, AttributionLine>();
  const add = (l: AttributionLine | null) => { if (l && !out.has(l.id)) out.set(l.id, l); };

  if (input.source === 'historical') {
    add({ id: 'statsbomb', text: t.statsbomb, licence: t.statsbombLicence, url: 'https://github.com/hudl/open-data' });
  }
  for (const c of input.crests) add(crestLine(c, t));
  const { home, away, homeKeeper, awayKeeper } = input.kits;
  for (const k of [home, away, homeKeeper, awayKeeper]) add(wikipediaLine(k.source, t.kit, t));
  for (const e of input.cast?.players.values() ?? []) {
    if (!e.record) continue;
    add({ id: 'wikidata', text: t.wikidata, licence: 'CC0', url: 'https://www.wikidata.org/' });
    for (const s of Object.values(e.record.fields)) add(wikipediaLine(s, t.playerFields, t));
  }
  if (input.engine === 'grf') {
    add({ id: 'engine:grf', text: t.grf, licence: 'Apache-2.0 / The Unlicense', url: 'https://github.com/google-research/football' });
  } else if (input.engine === 'touchlines') {
    add({ id: 'engine:touchlines', text: t.touchlines, licence: 'AGPL-3.0-or-later', url: TIMEPITCH_SOURCE_URL });
  } else if (input.engine === 'open-football') {
    add({ id: 'engine:open-football', text: t.openFootball, licence: 'Apache-2.0', url: 'https://github.com/ZOXEXIVO/open-football' });
  }
  add({ id: 'threejs', text: t.three, licence: 'MIT', url: '/licenses/three.txt' });
  add({ id: 'quaternius', text: t.quaternius, licence: 'CC0-1.0', url: '/licenses/quaternius.txt' });
  add({ id: 'trademarks', text: t.trademarks, licence: t.trademarksLicence, url: null });
  add({ id: 'own-art', text: t.ownArt, licence: t.ownArtLicence, url: null });
  add({ id: 'own-art-retro16', text: t.retro16Art, licence: t.ownArtLicence, url: null });
  return [...out.values()];
}
