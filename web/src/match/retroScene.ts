import type { RenderFrame, MatchEvent } from '../api';

export type CameraMode = 'follow' | 'overview';
export type SceneFrame = Omit<RenderFrame,'ball'|'period'|'possession'|'score'> & {ball:RenderFrame['ball']|null;period:number;possession:'home'|'away'|null;score:RenderFrame['score']|null};
/**
 * Evento grabado que el gráfico puede ilustrar. Además de los tipos del motor propio, las grabaciones con sidecar
 * (TP222) traen tarjeta (`card` + `card`), fuera de juego y falta; `at` es el sitio grabado del evento (m del campo).
 */
export type VisualCue = Pick<MatchEvent, 'participants' | 't1_ms'> & { type: MatchEvent['type'] | 'card' | 'offside' | 'foul';
  side?: 'home' | 'away' | null; bodyPart?:'head'|'left_foot'|'right_foot'|null; card?: 'yellow' | 'red' | null; at?: Readonly<{ x: number; y: number }> | null };
export const RETRO = { width: 384, height: 256, top: 24, bottom: 232 };
export const SPRITE_STATES = ['idle', 'run-1', 'run-2', 'run-3', 'run-4', 'kick', 'celebrate'] as const;
export type SpriteState = typeof SPRITE_STATES[number];
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function sceneFor(frame: SceneFrame, previous: SceneFrame, camera: CameraMode, selected: string,
  cue?: VisualCue, restarting = false, fieldFocus?:Readonly<{x:number;y:number}>|null) {
  const validFocus=fieldFocus!==null&&fieldFocus!==undefined&&Number.isFinite(fieldFocus.x)&&Number.isFinite(fieldFocus.y);
  const focus = validFocus?fieldFocus:frame.players.find(p => p.key === selected) ?? frame.ball ?? {x:52.5,y:34};
  const scale = 188 / 68;
  const transform = camera === 'overview'||fieldFocus!==undefined&&!validFocus
    ? { sx: scale, sy: scale, ox: (384 - 105 * scale) / 2, oy: 34 }
    : { sx: 5, sy: 4, ox: 40 + 192 - clamp(40 + focus.x * 5, 192, 413), oy: 32 + 128 - clamp(32 + focus.y * 4, 104, 232) };
  const project = (point: { x: number; y: number }) => ({ px: Math.round(point.x * transform.sx + transform.ox), py: Math.round(point.y * transform.sy + transform.oy) });
  const age = cue ? frame.clock_ms - cue.t1_ms : Infinity;
  const goal = cue?.type === 'goal' && age >= 0 && age < 900;
  const previousPlayers = new Map(previous.players.map(p => [p.key, p]));
  const slots = { home: 0, away: 0 };
  const players = frame.players.map(p => {
    const slot = slots[p.side]++;
    const old = previousPlayers.get(p.key) ?? p;
    const dx = p.x - old.x, dy = p.y - old.y, distance = Math.hypot(dx, dy);
    const moving = !restarting && frame.period === previous.period && distance > .005 && distance < 3;
    const direction = moving ? (Math.round(Math.atan2(dy * transform.sy, dx * transform.sx) / (Math.PI / 4)) + 8) % 8 : p.side === 'home' ? 0 : 4;
    let state: SpriteState = moving ? SPRITE_STATES[1 + (Math.floor(frame.clock_ms / 140 + slot) % 4)] : 'idle';
    if (age >= 0 && age < 250 && (cue?.type === 'shot' || cue?.type === 'pass') && cue.bodyPart!=='head' && cue.participants[0] === p.key && !restarting) state = 'kick';
    if (goal && cue?.side === p.side) state = 'celebrate';
    return { ...p, ...project(p), slot, direction, state,
      palette: (p.side === 'home' ? 0 : 1) + (p.role === 'GK' ? 2 : 0), spriteScale: camera === 'overview' ? .75 : 1 };
  });
  return { transform, players, ball: frame.ball ? project(frame.ball) : null, goal };
}

export type RetroScene = ReturnType<typeof sceneFor>;
export function hitPlayer(scene: RetroScene, x: number, y: number): string | null {
  if (x < 0 || x >= RETRO.width || y < RETRO.top || y >= RETRO.bottom) return null;
  // Match painted depth order; the front sprite wins in an overlap.
  const person = [...scene.players].sort((a, b) => a.py - b.py).reverse().find(p =>
    Math.abs(p.px - x) <= 8 * p.spriteScale && y >= p.py - 16 * p.spriteScale && y <= p.py + 2);
  return person?.key ?? null;
}
