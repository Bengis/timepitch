// Equipación y aspecto de cada jugador para el estilo «Clásico 16 bits» (TP220). Las equipaciones del reparto ya
// vienen resueltas contra choques de color (`chooseMatchKits`); sin reparto se usan colores genéricos por lado.
import { GENERIC_APPEARANCE, type MatchCast } from '../../../presentation/types';
import { mixHex } from '../../../presentation/avatar/palette';
import { CARD_HEX, HAIR_FEATURE, HAIR_HEX, SKIN_HEX, asBeard, asHeadStyle, refereeKitFor, type HairFeature, type SensibleKit, type SensibleLook } from './palette';

const plain = (shirt: string, shorts: string, socks: string, trim: string): SensibleKit =>
  ({ shirt, sleeves: { left: shirt, right: shirt }, shorts, socks, trim, pattern: { body: 'plain' } });
/** Colores genéricos (sin reparto): no imitan a ningún club. */
export const GENERIC_KITS = Object.freeze({
  home: plain('#c8102e', '#f4f4f4', '#c8102e', '#f4f4f4'),
  away: plain('#1d4fd6', '#f4f4f4', '#1d4fd6', '#f4f4f4'),
  homeKeeper: plain('#2fae5a', '#14141c', '#2fae5a', '#14141c'),
  awayKeeper: plain('#f5c400', '#14141c', '#f5c400', '#14141c'),
});

/** `feature`: capa de pelo que sobresale del cráneo (`hair.<feature>.<sprite>` en el atlas), si el peinado la tiene. */
export type PlayerLook = Readonly<{ key: string; kit: SensibleKit; look: SensibleLook; feature: HairFeature | null }>;
type Who = Readonly<{ key: string; side: 'home' | 'away'; role: string }>;

const hex = (value: string | undefined, fallback: string) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;

/** Equipación (por lado y portero) y aspecto (piel, pelo, botas) de un jugador; aspecto genérico si no hay registro. */
export function playerLook(player: Who, cast: MatchCast | null | undefined): PlayerLook {
  const keeper = player.role === 'GK';
  const slot = player.side === 'home' ? (keeper ? 'homeKeeper' : 'home') : (keeper ? 'awayKeeper' : 'away');
  const kit: SensibleKit = cast?.kits?.[slot] ?? GENERIC_KITS[slot];
  const appearance = cast?.players?.get(player.key)?.appearance ?? GENERIC_APPEARANCE;
  const skin = SKIN_HEX[appearance.skin] ?? SKIN_HEX[GENERIC_APPEARANCE.skin];
  const hairBase = HAIR_HEX[appearance.hairColour] ?? HAIR_HEX[GENERIC_APPEARANCE.hairColour];
  // Rapado: el pelo se funde con la piel; al uno, a medias.
  const hair = appearance.hairStyle === 'shaved' ? mixHex(hairBase, skin, .7) : appearance.hairStyle === 'buzz' ? mixHex(hairBase, skin, .4) : hairBase;
  const boots = hex(appearance.boots, '#111111');
  const hairStyle = asHeadStyle(appearance.hairStyle), beard = asBeard(appearance.beard);
  return { key: `${slot}|${skin}|${hair}|${boots}|${hairStyle}|${beard}`, kit, look: { skin, hair, boots, hairStyle, beard }, feature: HAIR_FEATURE[hairStyle] ?? null };
}

/**
 * Árbitro y asistentes: aspecto fijo propio (no son personas del registro) y la equipación de árbitro que más se
 * separa de las camisetas del partido (los dos equipos y los dos porteros).
 */
export const OFFICIAL_LOOKS: readonly SensibleLook[] = Object.freeze([
  { skin: SKIN_HEX.s3, hair: HAIR_HEX.dkbrown, boots: '#111111', hairStyle: 'crop', beard: 'none', card: CARD_HEX.yellow },
  { skin: SKIN_HEX.s6, hair: mixHex(HAIR_HEX.black, SKIN_HEX.s6, .4), boots: '#111111', hairStyle: 'buzz', beard: 'stubble' },
  { skin: SKIN_HEX.s2, hair: HAIR_HEX.ltbrown, boots: '#111111', hairStyle: 'short', beard: 'none' },
]);
export function officialKit(cast: MatchCast | null | undefined): SensibleKit {
  const k = cast?.kits;
  // También contra los porteros: un árbitro negro junto a un portero negro se confunde en el área.
  return refereeKitFor(k?.home ?? GENERIC_KITS.home, k?.away ?? GENERIC_KITS.away, k?.homeKeeper ?? GENERIC_KITS.homeKeeper, k?.awayKeeper ?? GENERIC_KITS.awayKeeper);
}
