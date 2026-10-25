// G16 · Construcción del MatchCast: identidad visual del partido a partir de los registros revisados.
// Equipaciones (choque resuelto), enlace fila de fuente → QID, ficha por QID y apariencia asignada a mano.
// Nunca se une por nombre ni por dorsal; un enlace solo vale para el equipo de su lado. Sin registro: genérico.
import { appearanceFor } from '../catalog/appearance';
import { chooseMatchKits, type MatchKitChoice } from '../catalog/kits';
import { linkFor, recordFor, type ReviewedLink } from '../catalog/player-registry';
import type { MatchSource, PlayerView, ViewProvenance } from '../match-centre/session';
import type { AssetSource, CastEntry, MatchCast, PlayerRecord } from './types';

/** De dónde sale un dato visible del jugador. */
export type CastFieldOrigin =
  | Readonly<{ origin: 'match_source'; provenance: ViewProvenance }>
  | Readonly<{ origin: 'player_card'; source: AssetSource | null }>
  | Readonly<{ origin: 'none' }>;

export type CastProvenance = Readonly<{
  number: CastFieldOrigin;
  displayName: CastFieldOrigin;
  appearance: CastEntry['appearanceSource'];
  /** Enlace revisado aplicado (método aprobado); `null` si la fila no está enlazada o es de otro equipo. */
  link: Pick<ReviewedLink, 'source' | 'sourceKey' | 'qid' | 'method' | 'confidence'> | null;
}>;

export type ProvenancedCastEntry = CastEntry & Readonly<{ provenance: CastProvenance }>;

export type BuiltMatchCast = Omit<MatchCast, 'kits' | 'players'> & Readonly<{
  source: MatchSource;
  kits: MatchKitChoice;
  players: ReadonlyMap<string, ProvenancedCastEntry>;
}>;

export type BuildMatchCastInput = Readonly<{
  source: MatchSource;
  homeKey: string;
  awayKey: string;
  players: readonly PlayerView[];
  squads: Readonly<{ home: readonly PlayerRecord[]; away: readonly PlayerRecord[] }>;
}>;

const NONE: CastFieldOrigin = Object.freeze({ origin: 'none' });

function sourceKeyOf(player: PlayerView): string | null {
  const key = player.details?.sourceKey;
  return typeof key === 'string' && key.length > 0 ? key : null;
}

/** Enlace revisado de la fila, solo si pertenece al equipo de ese lado. */
function sideLink(player: PlayerView, teamKey: string | null): ReviewedLink | null {
  const sourceKey = sourceKeyOf(player);
  if (!sourceKey || !teamKey) return null;
  const colon = sourceKey.indexOf(':');
  if (colon <= 0) return null;
  const link = linkFor(sourceKey.slice(0, colon), sourceKey);
  return link && link.teamKey === teamKey ? link : null;
}

function text(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function entryFor(player: PlayerView, teamKey: string | null, squad: readonly PlayerRecord[]): ProvenancedCastEntry {
  const link = sideLink(player, teamKey);
  const record = recordFor(squad, link);
  const appearance = appearanceFor(link?.qid ?? null, record);

  // Dorsal: el del partido (fuente) manda; si falta, el de la ficha de la temporada.
  const sourceNumber = text(player.jersey.value);
  const cardNumber = text(record?.number);
  const [number, numberOrigin]: [string | null, CastFieldOrigin] = sourceNumber !== null
    ? [sourceNumber, { origin: 'match_source', provenance: player.jersey.provenance }]
    : cardNumber !== null ? [cardNumber, { origin: 'player_card', source: record?.fields.number ?? null }] : [null, NONE];

  // Nombre: el de la ficha (identidad confirmada por QID); si no hay ficha, el de la fuente.
  const cardName = text(record?.display);
  const sourceName = text(player.name);
  const [displayName, nameOrigin]: [string | null, CastFieldOrigin] = cardName !== null
    ? [cardName, { origin: 'player_card', source: record?.fields.display ?? null }]
    : sourceName !== null ? [sourceName, { origin: 'match_source', provenance: 'source_recorded' }] : [null, NONE];

  return Object.freeze({
    number, displayName,
    appearance: appearance.params, appearanceSource: appearance.source,
    record,
    provenance: Object.freeze({
      number: numberOrigin, displayName: nameOrigin, appearance: appearance.source,
      link: link ? { source: link.source, sourceKey: link.sourceKey, qid: link.qid, method: link.method, confidence: link.confidence } : null,
    }),
  });
}

export function buildMatchCast(input: BuildMatchCastInput): BuiltMatchCast {
  const kits = chooseMatchKits(input.homeKey, input.awayKey);
  const players = new Map<string, ProvenancedCastEntry>();
  for (const player of input.players) {
    const teamKey = player.side === 'home' ? input.homeKey : player.side === 'away' ? input.awayKey : null;
    const squad = player.side === 'home' ? input.squads.home : player.side === 'away' ? input.squads.away : [];
    players.set(player.id, entryFor(player, teamKey, squad));
  }
  return Object.freeze({ source: input.source, kits, players });
}

/** Firma de los campos que determinan el cast; permite conservar el mismo objeto entre fotogramas. */
export function castSignature(players: readonly PlayerView[]): string {
  return JSON.stringify(players.map(p => [p.id, p.side, sourceKeyOf(p), p.name, p.jersey.value, p.jersey.provenance]));
}
