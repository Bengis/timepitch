// TP247 (25-oct: «en FIFA tiene varios apartados»): salida de los equipos al estadio antes del saque inicial.
// Fotogramas sintéticos, solo de presentación: los dos equipos salen del túnel (banda de la cámara, y = 68) en dos
// filas, forman junto a la línea de medio campo y, al terminar, la emisión corta al saque inicial grabado.
import type { SceneFrame } from '../match/retroScene';

type Player = SceneFrame['players'][number];

export const WALKOUT_STEP_MS = 100;
const TUNNEL = { x: 52.5, y: 71 };
const LINE_Y = 57, GAP = 1.5, WALK_MS = 6000, STAGGER_MS = 250, HOLD_MS = 2500;
const ROLE_ORDER: Record<Player['role'], number> = { GK: 0, DEF: 1, MID: 2, FWD: 3 };

const ordered = (players: readonly Player[], side: Player['side']) =>
  players.filter(p => p.side === side).map((p, i) => ({ p, i })).sort((a, b) => ROLE_ORDER[a.p.role] - ROLE_ORDER[b.p.role] || a.i - b.i).map(x => x.p);

/** Duración total de la salida para esa alineación: la última pareja llega y todos esperan formados. */
export function walkoutDuration(kickoff: SceneFrame): number {
  const files = Math.max(ordered(kickoff.players, 'home').length, ordered(kickoff.players, 'away').length);
  return files ? (files - 1) * STAGGER_MS + WALK_MS + HOLD_MS : 0;
}

/** Fotograma de la salida en `tMs`: cada pareja sale del túnel con un pequeño desfase y anda hasta su sitio en la fila. */
export function walkoutFrame(kickoff: SceneFrame, tMs: number): SceneFrame {
  const place = (list: Player[], dir: -1 | 1) => list.map((p, i) => {
    const target = { x: TUNNEL.x + dir * (2 + i * GAP), y: LINE_Y };
    const k = Math.max(0, Math.min(1, (tMs - i * STAGGER_MS) / WALK_MS)), e = k * k * (3 - 2 * k);
    return { ...p, x: TUNNEL.x + (target.x - TUNNEL.x) * e, y: TUNNEL.y + (target.y - TUNNEL.y) * e };
  });
  return { ...kickoff, clock_ms: Math.max(0, tMs), ball: null, carrier: null, possession: null,
    players: [...place(ordered(kickoff.players, 'home'), -1), ...place(ordered(kickoff.players, 'away'), 1)] };
}

/** Foco de cámara de la salida: la fila que se va formando, delante del túnel. */
export const WALKOUT_FOCUS = { x: TUNNEL.x, y: LINE_Y + 2 };
