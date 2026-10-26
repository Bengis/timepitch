// Del acontecimiento grabado a la escena dibujable de Capitán Hane (TP234). Puro. Solo lee identidad visual
// (equipación, rasgos del avatar, dorsal identificado) y la habilidad ya calculada; el resultado de la escena es el
// del acontecimiento (`cut.kind`), nunca otro.
import type { SourceLocale as Locale } from '../../i18n-catalog';
import type { EventView, PlayerView } from '../../match-centre/session';
import { GENERIC_APPEARANCE, type MatchCast } from '../../presentation/types';
import { NEUTRAL_KIT } from '../../presentation/avatar/portrait-svg';
import { ABILITY_NAMES, abilitySourceText, type Ability } from './abilities';
import type { CutIn, CutInKind } from './cutins';
import { moveNameFor } from './moves';
import type { Figure } from './portrait';
import type { CutInSpec } from './scene';
import type { AnimePlayerData } from './useAnimeAbilities';
import { NO_ART, sceneArt, type ArtLookup } from './hane-art';

const KEEPER = /^(gk|goalkeeper|portero)$/i;
export const OUTCOME_TEXT: Readonly<Record<Locale, Readonly<Record<CutInKind, string>>>> = {
  en: { goal: 'GOAL!!', save: 'SAVE!', miss: 'WIDE!', tackle: 'BALL WON!' },
  es: { goal: '¡GOL!', save: '¡PARADA!', miss: '¡FUERA!', tackle: '¡ROBO!' },
};
/** Ventana para enlazar el pase grabado que precede a un remate («Pase del cielo»). */
export const SKY_PASS_WINDOW_MS = 8000;

export type SpecContext = Readonly<{
  players: readonly PlayerView[]; cast: MatchCast | null | undefined; data: ReadonlyMap<string, AnimePlayerData>;
  events: readonly EventView[]; locale: Locale;
  /** Nombre de respaldo (p. ej. el del fotograma) si el jugador no está en la lista. */
  nameOf?: (id: string) => string | null;
  /** Retratos generados ya cargados (TP235); sin ellos, primer plano SVG. */
  art?: ArtLookup | null;
}>;

export function figureFor(id: string, side: 'home' | 'away' | null, keeper: boolean, ctx: SpecContext): Figure {
  const view = ctx.players.find(p => p.id === id), entry = ctx.cast?.players.get(id);
  const s = view?.side ?? side, isKeeper = keeper || KEEPER.test(view?.role.value ?? '') || entry?.record?.position === 'GK';
  const kit = ctx.cast && s ? ctx.cast.kits[isKeeper ? (s === 'home' ? 'homeKeeper' : 'awayKeeper') : s] : NEUTRAL_KIT;
  return { appearance: entry?.appearance ?? GENERIC_APPEARANCE, kit, number: entry?.number ?? null,
    name: entry?.displayName ?? view?.name ?? ctx.nameOf?.(id) ?? '' };
}

/** Porteros del partido (rol o ficha GK), para deducir paradas y saques de puerta donde el motor no los graba (TP238). */
export function keeperIdsFor(players: readonly PlayerView[], cast: MatchCast | null | undefined): ReadonlySet<string> {
  return new Set(players.filter(p => KEEPER.test(p.role.value ?? '') || cast?.players.get(p.id)?.record?.position === 'GK').map(p => p.id));
}

/** Portero del equipo que encaja (para la viñeta «batido» de un gol): titular del otro lado con rol de portero. */
export function concedingKeeper(cut: CutIn, ctx: SpecContext): string | null {
  if (cut.kind !== 'goal' || !cut.side) return null;
  const other = cut.side === 'home' ? 'away' : 'home';
  const keeper = ctx.players.find(p => p.side === other && (KEEPER.test(p.role.value ?? '') || ctx.cast?.players.get(p.id)?.record?.position === 'GK'));
  return keeper?.id ?? null;
}

/** Pasador con «Pase del cielo» del último pase grabado hacia el protagonista, del mismo equipo y poco antes. */
export function skyPasser(cut: CutIn, ctx: SpecContext): string | null {
  if (!cut.actorId || cut.kind === 'tackle') return null;
  let pass: EventView | null = null;
  for (const e of ctx.events) {
    if (e.elapsedMs === null || e.elapsedMs > cut.atMs || cut.atMs - e.elapsedMs > SKY_PASS_WINDOW_MS) continue;
    if (e.kind.toLowerCase() !== 'pass' || e.side !== cut.side || !e.actorId || e.actorId === cut.actorId) continue;
    if (e.participantIds[1] !== cut.actorId) continue;
    if (!pass || e.elapsedMs >= pass.elapsedMs!) pass = e;
  }
  return pass?.actorId && ctx.data.get(pass.actorId)?.ability?.id === 'sky-pass' ? pass.actorId : null;
}

export function specFor(cut: CutIn, ctx: SpecContext): CutInSpec | null {
  const actor = cut.actorId ? figureFor(cut.actorId, cut.side, false, ctx) : null;
  const keeperSide = cut.side === 'home' ? 'away' : cut.side === 'away' ? 'home' : null;
  const keeper = cut.kind === 'save' && cut.keeperId ? figureFor(cut.keeperId, keeperSide, true, ctx) : null;
  if (!actor && cut.kind !== 'goal') return null;
  const data = cut.actorId ? ctx.data.get(cut.actorId) : undefined;
  const passer = skyPasser(cut, ctx);
  return {
    kind: cut.kind, actor, keeper,
    moveName: actor && data ? moveNameFor(data.identity, ctx.locale) : actor && cut.actorId ? moveNameFor({ seedKey: cut.actorId }, ctx.locale) : null,
    ability: data?.ability?.id ?? null,
    keeperAbility: cut.keeperId ? ctx.data.get(cut.keeperId)?.ability?.id ?? null : null,
    skyPassFrom: passer ? figureFor(passer, cut.side, false, ctx) : null,
    outcomeText: OUTCOME_TEXT[ctx.locale][cut.kind],
    art: actor ? sceneArt(cut.kind, cut.actorId, cut.kind === 'goal' ? concedingKeeper(cut, ctx) : cut.keeperId, ctx.art) : NO_ART,
  };
}

export const ANIME_LABELS = {
  en: { dialog: 'Captain Hane scene', skip: 'Click or press any key to skip', abilityTitle: 'Captain Hane ability',
    abilityNote: 'Visual only: it changes how a scene looks, never the recorded result.',
    describe: (s: CutInSpec) => [s.actor?.name, s.moveName, s.outcomeText].filter(Boolean).join(' · ') },
  es: { dialog: 'Escena de Capitán Hane', skip: 'Clic o cualquier tecla para saltar', abilityTitle: 'Habilidad de Capitán Hane',
    abilityNote: 'Solo visual: cambia cómo se ve una escena, nunca el resultado grabado.',
    describe: (s: CutInSpec) => [s.actor?.name, s.moveName, s.outcomeText].filter(Boolean).join(' · ') },
} as const;

/** Bloque de la ficha: nombre de la habilidad y «Fuente: <stat> = <valor> (<procedencia>)» con su chip. */
export function cardAbility(ability: Ability | null | undefined, locale: Locale) {
  if (!ability) return null;
  return { title: ANIME_LABELS[locale].abilityTitle, name: ABILITY_NAMES[locale][ability.id], source: abilitySourceText(ability, locale),
    chip: ability.provenance === 'historical' ? 'hist' as const : ability.provenance === 'estimated' ? 'est' as const : 'sim' as const,
    note: ANIME_LABELS[locale].abilityNote };
}
