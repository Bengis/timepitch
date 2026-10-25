import type { CameraMode, SceneFrame } from '../retroScene';

// Cámaras del 3D de retransmisión (G09), portadas de `updateCamera` de la maqueta aprobada (.local/mockup/replay3d.js)
// pero sin estado: cada plano es función pura del fotograma, así que buscar hacia atrás da la misma imagen. El
// suavizado lo aporta la interpolación de `SceneFrame` que ya hace la app. Coordenadas: x 0..105, z 0..68; la
// cámara está del lado z > 68 y mira hacia z decreciente (allí no hay grada en el estadio).

export type CameraFraming = 'broadcast' | 'tactical' | 'near';
export type CameraShot = Readonly<{ position: [number, number, number]; target: [number, number, number]; fov: number }>;
type Point = Readonly<{ x: number; y: number }>;

export const BROADCAST_TILT_DEG = 22;
const TILT = BROADCAST_TILT_DEG * Math.PI / 180;
const SHOTS = {
  broadcast: { height: 18, width: 46, maxYaw: 28 * Math.PI / 180 },
  near: { height: 8.5, width: 24, maxYaw: 0 },
  // TP244: plano de televisión para los jugadores con esqueleto: más bajo y cerrado que `broadcast`, para ver la zancada.
  tele: { height: 11, width: 32, maxYaw: 24 * Math.PI / 180 },
} as const;
const TACTICAL_FOV = 40, TACTICAL_TILT = Math.PI / 3;
/** Metros de exterior que puede enseñar el borde inferior del plano más allá de la banda del lado de la cámara. */
const NEAR_APRON_M = 4;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const valid = (p: Point | null | undefined): p is Point => !!p && Number.isFinite(p.x) && Number.isFinite(p.y);

/** `follow` = Emisión (broadcast), `overview` = Táctica; `framing` explícito manda; un foco nulo o inválido = Táctica. */
export function framingFor(input: Readonly<{ camera: CameraMode; framing?: CameraFraming | null; fieldFocus?: Point | null }>): CameraFraming {
  if (input.fieldFocus !== undefined && !valid(input.fieldFocus)) return 'tactical';
  if (input.framing) return input.framing;
  return input.camera === 'overview' ? 'tactical' : 'broadcast';
}

function verticalFov(width: number, distance: number, aspect: number) {
  const half = Math.atan(width / 2 / distance);
  return clamp(2 * Math.atan(Math.tan(half) / Math.max(aspect, 1e-3)) * 180 / Math.PI, 8, 60);
}

/**
 * Plano de cámara. `broadcast`: pórtico lateral bajo (22°, 18 m) que gira hacia la portería en vez de correr por la
 * banda y abre el plano con la velocidad del balón. `near`: mismo ángulo, a 8,5 m y 24 m de ancho. `tactical`: el
 * campo entero con fondos de portería (encuadre de la vista general previa). El foco queda siempre en el centro.
 */
export function cameraShot(framing: CameraFraming | 'tele', focus: Point, aspect: number, ballSpeed: number): CameraShot {
  const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  if (framing === 'tactical') {
    const vertical = Math.tan(TACTICAL_FOV / 2 * Math.PI / 180);
    const distance = Math.max(56 / (vertical * ratio) + 36 * Math.cos(TACTICAL_TILT), 36 * Math.sin(TACTICAL_TILT) / vertical + 36 * Math.cos(TACTICAL_TILT));
    return { position: [52.5, distance * Math.sin(TACTICAL_TILT), 34 + distance * Math.cos(TACTICAL_TILT)], target: [52.5, 0, 34], fov: TACTICAL_FOV };
  }
  const shot = SHOTS[framing], fx = valid(focus) ? focus.x : 52.5, fz = valid(focus) ? focus.y : 34;
  const ground = shot.height / Math.tan(TILT), distance = Math.hypot(shot.height, ground);
  const yaw = clamp((52.5 - fx) / 52.5, -1, 1) * shot.maxYaw;
  const speed = Number.isFinite(ballSpeed) ? Math.max(0, ballSpeed) : 0;
  const width = shot.width + (framing === 'broadcast' || framing === 'tele' ? Math.min(10, speed * .5) : 0);
  const fov = verticalFov(width, distance, ratio);
  // TP205: cerca de la banda del lado de la cámara (z = 68) el borde inferior caería en el exterior oscuro. Se acerca el
  // objetivo al campo lo justo para que ese borde quede como mucho a NEAR_APRON_M de la banda; el foco sigue en plano.
  const bottom = TILT + fov / 2 * Math.PI / 180;
  const reach = bottom < Math.PI / 2 ? (ground - shot.height / Math.tan(bottom)) * Math.cos(yaw) : 0;
  const tz = Math.min(fz, 68 + NEAR_APRON_M - reach);
  return { position: [fx + Math.sin(yaw) * ground, shot.height, tz + Math.cos(yaw) * ground], target: [fx, 0, tz], fov };
}

/** Recolocación masiva (saque, reanudación, cambio de parte): ≥ 4 jugadores saltan ≥ 3 m a la vez. Se trata como corte. */
export function isMassReposition(previous: SceneFrame, frame: SceneFrame, minPlayers = 4, minDistance = 3): boolean {
  if (previous === frame) return false;
  if (previous.period !== frame.period) return true;
  const before = new Map(previous.players.map(p => [p.key, p]));
  let jumps = 0;
  for (const player of frame.players) {
    const old = before.get(player.key);
    if (old && valid(old) && valid(player) && Math.hypot(player.x - old.x, player.y - old.y) >= minDistance && ++jumps >= minPlayers) return true;
  }
  return false;
}

/** Velocidad del balón en m/s entre dos fotogramas; 0 si falta, hay corte de parte o un salto de ≥ 15 m. */
export function ballVelocity(frame: SceneFrame, previous: SceneFrame): { x: number; y: number } {
  const a = previous.ball, b = frame.ball, dt = (frame.clock_ms - previous.clock_ms) / 1000;
  if (!valid(a) || !valid(b) || frame.period !== previous.period || !Number.isFinite(dt) || dt <= 0) return { x: 0, y: 0 };
  const dx = b.x - a.x, dy = b.y - a.y;
  if (Math.hypot(dx, dy) >= 15) return { x: 0, y: 0 };
  return { x: dx / dt, y: dy / dt };
}

/** Altura del balón solo si la fuente la trae (`z` finita ≥ 0); nunca se deduce. */
export function ballHeight(ball: Point | null | undefined): number {
  const z = (ball as { z?: unknown } | null | undefined)?.z;
  return typeof z === 'number' && Number.isFinite(z) && z > 0 ? z : 0;
}
