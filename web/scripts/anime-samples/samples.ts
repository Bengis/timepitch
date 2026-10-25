// Escenas de muestra de Capitán Hane (TP234) para cuatro jugadores de la demo. Lo carga render.ts a través de Vite
// (`runnerImport`) porque los módulos de la app importan sin extensión. Usa EXACTAMENTE el mismo código que la app:
// rasgos del avatar (appearance-demo.json), ficha pública (nacionalidad deportiva, posición, dorsal), equipaciones
// del resolutor y el generador de nombres y habilidades.
import appearanceJson from '../../src/catalog/appearance-demo.json';
import arsenal from '../../public/data/players/arsenal-2003.json';
import city from '../../public/data/players/mancity-2024.json';
import { chooseMatchKits } from '../../src/catalog/kits';
import { GENERIC_APPEARANCE, type AppearanceParams, type KitSpec } from '../../src/presentation/types';
import { moveNameFor, roleFor } from '../../src/match/anime/moves';
import { abilityFor, abilitySourceText, ABILITY_NAMES, type AbilityInput } from '../../src/match/anime/abilities';
import { cutInSvg, type SceneMode } from '../../src/match/anime/scene';
import type { CutInKind } from '../../src/match/anime/cutins';
import type { Figure } from '../../src/match/anime/portrait';

type Card = { qid: string; display: string; number: string | null; position: string | null; nation: string | null };
const list = (file: unknown) => Object.values((file as { players: Record<string, Card> | Card[] }).players) as Card[];
const cards = [...list(arsenal), ...list(city)];
const looks = (appearanceJson as unknown as { players: Record<string, AppearanceParams> }).players;
const kits = chooseMatchKits('arsenal:2003', 'mancity:2024');

/**
 * Temporada de cada uno en el catálogo (consulta `get_team` sobre research/data-audit/2026-10-16/derived/
 * coverage.sqlite, 24-oct-2026): Arsenal 2003/04 = epldata (sin paradas ni recuperaciones), máximo goleador 30;
 * City 2024/25 = FPL, máximo goleador 22. En la app estos valores llegan del catálogo en vivo.
 */
const SEASON: Record<string, NonNullable<AbilityInput['season']>> = {
  Q45901: { goals: { value: 30, status: 'measured' }, assists: { value: 18, status: 'measured' }, teamTopGoals: 30 },
  Q190142: { goals: { value: 4, status: 'measured' }, assists: { value: 3, status: 'measured' }, teamTopGoals: 30 },
  Q28967995: { goals: { value: 22, status: 'measured' }, assistsFpl: { value: 3, status: 'measured' }, saves: { value: 0, status: 'measured' }, teamTopGoals: 22 },
  Q17074511: { goals: { value: 0, status: 'measured' }, assistsFpl: { value: 4, status: 'measured' }, saves: { value: 54, status: 'measured' }, teamTopGoals: 22 },
};

function figure(qid: string, kit: KitSpec) {
  const card = cards.find(c => c.qid === qid)!;
  const fig: Figure = { appearance: looks[qid] ?? GENERIC_APPEARANCE, kit, number: card.number, name: card.display };
  const ability = abilityFor({ role: roleFor(card.position), season: SEASON[qid] ?? null });
  const identity = { seedKey: card.qid, nation: card.nation, position: card.position };
  return { card, fig, ability, identity };
}

export type Sample = Readonly<{ file: string; svg: string; width?: number; height?: number }>;

export function build() {
  const henry = figure('Q45901', kits.home), gilberto = figure('Q190142', kits.home);
  const haaland = figure('Q28967995', kits.away), ederson = figure('Q17074511', kits.awayKeeper);
  const summary = [henry, gilberto, haaland, ederson].map(({ card, ability, identity }) => ({
    player: card.display, nation: card.nation, position: card.position,
    moveEn: moveNameFor(identity, 'en'), moveEs: moveNameFor(identity, 'es'),
    ability: ability ? `${ABILITY_NAMES.en[ability.id]} / ${ABILITY_NAMES.es[ability.id]}` : 'none / ninguna',
    source: ability ? `${abilitySourceText(ability, 'en')} | ${abilitySourceText(ability, 'es')}` : 'no threshold met / ningún umbral',
  }));
  // Escenas de ejemplo (no son acontecimientos de un partido): en la app solo salen de acontecimientos grabados.
  type F = ReturnType<typeof figure>;
  const LANG = (process.env.SAMPLES_LANG === 'en' ? 'en' : 'es') as 'en' | 'es';
  const T = LANG === 'en' ? { goal: 'GOAL!!', save: 'SAVE!', miss: 'WIDE!', tackle: 'BALL WON!' } : { goal: '¡GOL!', save: '¡PARADA!', miss: '¡FUERA!', tackle: '¡ROBO!' };
  const scenes: [string, CutInKind, F, F | null, string][] = [
    ['henry-goal', 'goal', henry, null, T.goal],
    ['haaland-save-ederson', 'save', haaland, ederson, T.save],
    ['gilberto-tackle', 'tackle', gilberto, null, T.tackle],
    ['haaland-miss', 'miss', haaland, null, T.miss],
    ['ederson-closeup', 'save', ederson, null, T.save],
  ];
  const samples: Sample[] = [];
  for (const [name, kind, actor, keeper, outcomeText] of scenes) {
    const spec = { kind, actor: actor.fig, keeper: keeper?.fig ?? null, ability: actor.ability?.id ?? null, keeperAbility: keeper?.ability?.id ?? null,
      moveName: moveNameFor(actor.identity, LANG), skyPassFrom: null, outcomeText };
    for (const mode of ['charge', 'outcome', 'card'] as SceneMode[]) samples.push({ file: `${name}-${mode}.png`, svg: cutInSvg(spec, `s-${name}-${mode}`, mode) });
    // Teléfono (vertical): el fotograma de carga y el del desenlace.
    for (const mode of ['charge', 'outcome'] as SceneMode[])
      samples.push({ file: `${name}-${mode}-phone.png`, svg: cutInSvg(spec, `s-${name}-${mode}-p`, mode, 'portrait'), width: 450, height: 800 });
  }
  return { samples, summary };
}
