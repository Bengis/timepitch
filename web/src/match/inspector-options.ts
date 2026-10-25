// TP205 · Opciones del selector «Consultar jugador». Con reparto del partido (MatchCast) se usan su dorsal real y su
// nombre (los mismos que la cronología y las alineaciones); sin reparto, el número es el puesto en el once.
import type { MatchCast } from '../presentation/types';

type InspectablePlayer = Readonly<{ key: string; side: 'home' | 'away'; name: string }>;
export type InspectorOption = Readonly<{ key: string; side: 'home' | 'away'; name: string; label: string }>;

export function inspectorOptions(players: readonly InspectablePlayer[], cast: MatchCast | null | undefined): { options: InspectorOption[]; realNumbers: boolean } {
  const realNumbers = !!cast && players.some(p => cast.players.get(p.key)?.number);
  const slots = { home: 0, away: 0 };
  const options = players.map(p => {
    const slot = ++slots[p.side];
    if (!realNumbers) return { key: p.key, side: p.side, name: p.name, label: `${slot} · ${p.name}` };
    const entry = cast!.players.get(p.key), name = entry?.displayName ?? p.name;
    return { key: p.key, side: p.side, name, label: `${entry?.number ?? '—'} ${name}` };
  });
  return { options, realNumbers };
}
