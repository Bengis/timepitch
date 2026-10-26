// Lógica pura del estilo «Clásico 16 bits» (TP220): geometría del estadio vertical, cámara, dirección del sprite y
// elección de animación. Solo INTERPRETA visualmente el `SceneFrame` y el evento grabado que llega como `VisualCue`:
// nunca crea eventos, no mueve a nadie de su posición grabada y no deduce la altura del balón.
import type { VisualCue } from '../../retroScene';
import atlasJson from './atlas.json';
import { fictionalAbbr } from '../../../catalog/fictional';
import pitchJson from './pitch.json';

export const DIRECTIONS = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'] as const;
export type Direction = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export const PX_PER_M = pitchJson.pxPerMetre;
export const STADIUM = Object.freeze({ width: pitchJson.width, height: pitchJson.height, field: pitchJson.field });
export const FIELD_LENGTH = 105, FIELD_WIDTH = 68;

type Point = Readonly<{ x: number; y: number }>;
const finite = (p: Point | null | undefined): p is Point => !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Campo (x = largo 0..105, y = ancho 0..68) → píxel del estadio vertical. Es el giro de 90° de la vista del 3D (no un
 * espejo): x = 105 arriba (portería norte), y = 68 a la derecha.
 */
export function fieldToStadium(x: number, y: number): Point {
  return { x: STADIUM.field.x + y * PX_PER_M, y: STADIUM.field.y + (FIELD_LENGTH - x) * PX_PER_M };
}
/** Velocidad del campo (m/s) → velocidad en pantalla (px/s, y hacia abajo). */
export function screenVelocity(vx: number, vy: number): Point { return { x: vy * PX_PER_M, y: -vx * PX_PER_M }; }

/** Dirección de 8 vías (E, SE, S… en pantalla) más cercana a un vector de pantalla. */
export function directionOf(sx: number, sy: number): Direction {
  if (!Number.isFinite(sx) || !Number.isFinite(sy) || (sx === 0 && sy === 0)) return 2;
  return (((Math.round(Math.atan2(sy, sx) / (Math.PI / 4)) % 8) + 8) % 8) as Direction;
}

// ---------- Cámara ----------

export type CameraView = Readonly<{
  /** Esquina superior izquierda de la vista en píxeles del estadio (enteros en seguimiento: scroll de píxel exacto). */
  x: number; y: number; w: number; h: number;
  /** Píxeles de dispositivo por píxel lógico. Entero en seguimiento; en campo completo puede ser < 1. */
  scale: number; offsetX: number; offsetY: number; smooth: boolean;
}>;

/** Región del plano «campo completo»: el rectángulo de juego, las redes y un margen de valla. */
export const OVERVIEW_REGION = Object.freeze({ x: STADIUM.field.x - 28, y: STADIUM.field.y - 36, w: STADIUM.field.w + 56, h: STADIUM.field.h + 72 });

/**
 * Escala entera para el seguimiento, medida en píxeles CSS (un píxel lógico nunca baja de 1 px CSS, también en pantallas
 * densas): al menos 240 píxeles lógicos de alto (≥ 30 m). Devuelve píxeles de dispositivo por píxel lógico.
 */
export function followScale(deviceW: number, deviceH: number, dpr = 1): number {
  if (!(deviceW > 0) || !(deviceH > 0)) return 1;
  const ratio = Number.isFinite(dpr) && dpr > 0 ? dpr : 1, cssW = deviceW / ratio, cssH = deviceH / ratio;
  let scale = Math.max(1, Math.floor(cssH / 240));
  while (scale > 1 && cssW / scale < 240) scale--; // en vertical estrecho, al menos ~30 m de ancho
  return Math.max(1, Math.round(scale * ratio));
}

/**
 * Vista de cámara. `follow`: centrada en el foco (balón, o el foco de la secuencia) y acotada al estadio, con scroll
 * de píxel entero. `overview`: el campo entero ajustado a la ventana. Pura: el mismo fotograma da la misma imagen.
 */
export function cameraView(mode: 'follow' | 'overview', focus: Point | null, deviceW: number, deviceH: number, dpr = 1, centrePx?: Point | null): CameraView {
  const W = Math.max(1, Math.round(deviceW)), H = Math.max(1, Math.round(deviceH));
  if (mode === 'overview') {
    const r = OVERVIEW_REGION, fit = Math.min(W / r.w, H / r.h);
    const scale = fit >= 1 ? Math.floor(fit) : fit;
    const w = Math.ceil(W / scale), h = Math.ceil(H / scale);
    const x = Math.round(r.x + (r.w - w) / 2), y = Math.round(r.y + (r.h - h) / 2);
    return { x, y, w, h, scale, offsetX: 0, offsetY: 0, smooth: scale < 1 };
  }
  const scale = followScale(W, H, dpr), vw = W / scale, vh = H / scale;
  const centre = finite(centrePx) ? centrePx : followCentre(focus);
  // TP220 pulido: el scroll va por píxel de DISPOSITIVO (no por píxel lógico). La rejilla del arte no se rompe porque todo
  // el búfer (campo + sprites) se desplaza junto; a escala 2–3 el campo se mueve 2–3 veces más fino, sin saltos.
  const axis = (c: number, view: number, size: number) => {
    if (view >= size) { const v = Math.round((size - view) / 2); return { start: v, offset: 0 }; }
    const device = Math.round(clamp(c - view / 2, 0, size - view) * scale), start = Math.floor(device / scale);
    return { start, offset: -(device - start * scale) };
  };
  const ax = axis(centre.x, vw, STADIUM.width), ay = axis(centre.y, vh, STADIUM.height);
  const w = Math.ceil(vw) + (ax.offset ? 1 : 0), h = Math.ceil(vh) + (ay.offset ? 1 : 0);
  return { x: ax.start, y: ay.start, w, h, scale, offsetX: ax.offset, offsetY: ay.offset, smooth: false };
}

/** Centro (px del estadio) que pide el foco, sin suavizar. */
export function followCentre(focus: Point | null): Point {
  return finite(focus) ? fieldToStadium(clamp(focus.x, -5, 110), clamp(focus.y, -5, 73)) : fieldToStadium(52.5, 34);
}

export type CameraState = Readonly<{ x: number; y: number; clockMs: number }>;
/** Constante de tiempo (ms de partido) del retardo de cámara y desfase máximo (px lógicos) respecto al foco. */
export const CAMERA_LAG = Object.freeze({ tauMs: 260, maxPx: 56, snapAfterMs: 1500 });

/**
 * Cámara con inercia, como en los cenitales clásicos: persigue el foco con un retardo exponencial medido en tiempo de
 * PARTIDO (no de pared), así que a 1× desliza suave y a velocidades altas o al buscar salta al foco. Nunca se queda a
 * más de `maxPx` del foco. Corte (reanudación, cambio de parte), pausa (mismo reloj), rebobinado o salto → al foco.
 */
export function smoothCamera(prev: CameraState | null, target: Point, clockMs: number, cut: boolean): CameraState {
  const dt = prev ? clockMs - prev.clockMs : NaN;
  if (!prev || cut || !(dt > 0) || dt > CAMERA_LAG.snapAfterMs || !finite(prev)) return { x: target.x, y: target.y, clockMs };
  const k = 1 - Math.exp(-dt / CAMERA_LAG.tauMs);
  let x = prev.x + (target.x - prev.x) * k, y = prev.y + (target.y - prev.y) * k;
  const dx = x - target.x, dy = y - target.y, d = Math.hypot(dx, dy);
  if (d > CAMERA_LAG.maxPx) { x = target.x + dx * CAMERA_LAG.maxPx / d; y = target.y + dy * CAMERA_LAG.maxPx / d; }
  return { x, y, clockMs };
}

/** Píxel del estadio → píxel de dispositivo del lienzo. */
export function stadiumToDevice(view: CameraView, sx: number, sy: number): Point {
  return { x: (sx - view.x) * view.scale + view.offsetX, y: (sy - view.y) * view.scale + view.offsetY };
}

// ---------- Animación ----------

type AnimationMeta = Readonly<{ frames: number; fps: number; loop: boolean; keeper: boolean }>;
export const ANIMATIONS = atlasJson.animations as unknown as Readonly<Record<string, AnimationMeta>>;
export type SpriteChoice = Readonly<{ anim: string; dir: Direction; frame: number }>;
export const spriteKey = (c: SpriteChoice) => `player.${c.anim}.${DIRECTIONS[c.dir]}.${c.frame}`;

/** Ventanas (ms desde `t1_ms` del evento) durante las que se ve la acción; después, vuelta a correr/reposo. */
export const ACTION_WINDOW_MS = Object.freeze({ pass: 300, shot: 400, header: 450, slide: 600, dive: 800, catch: 600, throw: 650, celebrate: 3000, kneeslide: 1400 });
/** Umbrales de velocidad (m/s) y zancada (m por fotograma) de la carrera. */
export const MOTION = Object.freeze({ idleBelow: .5, sprintFrom: 5.5, runStride: .6, sprintStride: .8, shuffleBelow: 3 });
/** Altura (m) desde la que un pase o disparo se lee como cabezazo, si la fuente trae altura. */
export const HEADER_HEIGHT_M = 1.3;

export type SpriteInput = Readonly<{
  key: string; role: string; side: 'home' | 'away';
  x: number; y: number;
  /** Velocidad en m/s del campo; 0 en un corte (salto, cambio de parte). */
  vx: number; vy: number;
  clockMs: number; cut: boolean;
  cue?: VisualCue | null;
  /** Balón en el campo; `z` solo si la fuente la trae. */
  ball: Readonly<{ x: number; y: number; z: number }> | null;
  /** Metros recorridos acumulados por este jugador (fase de la carrera). */
  runDistance: number;
  /** Portero que encaja el gol del `cue` (para la estirada batida). */
  concedingKeeper?: boolean;
  /** Velocidad grabada del balón (m/s del campo, entre el fotograma anterior y este; `z` si la fuente trae altura);
   *  null en un corte o sin balón. */
  ballVelocity?: Readonly<{ x: number; y: number; z?: number }> | null;
}>;

function hashPhase(key: string) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) >>> 0;
  return h % 997;
}
const timed = (anim: string, ageMs: number) => {
  const meta = ANIMATIONS[anim];
  const f = Math.floor(Math.max(0, ageMs) / 1000 * meta.fps);
  return meta.loop ? f % meta.frames : Math.min(meta.frames - 1, f);
};
const looped = (anim: string, clockMs: number, key: string) => {
  const meta = ANIMATIONS[anim];
  return (Math.floor(clockMs / 1000 * meta.fps) + hashPhase(key)) % meta.frames;
};

/** Hacia dónde mira: hacia donde corre; parado, hacia el balón (como en los juegos cenitales clásicos). */
export function facing(input: SpriteInput, moving: boolean): Direction {
  if (moving) { const v = screenVelocity(input.vx, input.vy); return directionOf(v.x, v.y); }
  if (input.ball && Number.isFinite(input.ball.x)) {
    const me = fieldToStadium(input.x, input.y), ball = fieldToStadium(input.ball.x, input.ball.y);
    if (Math.hypot(ball.x - me.x, ball.y - me.y) > 1) return directionOf(ball.x - me.x, ball.y - me.y);
  }
  return input.side === 'home' ? 6 : 2;
}

/** Lado de la estirada respecto al portero (su izquierda o su derecha) según dónde queda el balón. */
export function diveSide(dir: Direction, keeper: Point, ball: Point): 'left' | 'right' {
  const angle = dir * Math.PI / 4, fx = Math.cos(angle), fy = Math.sin(angle);
  const me = fieldToStadium(keeper.x, keeper.y), b = fieldToStadium(ball.x, ball.y);
  const cross = fx * (b.y - me.y) - fy * (b.x - me.x);
  return cross < 0 ? 'left' : 'right';
}

/**
 * Estirada medida con el balón grabado (TP222). El portero empieza a estirarse `leadMs` antes de que el balón cruce su
 * altura (no en el gol, que se registra cuando el balón ya ha pasado). Solo cuenta un balón que va hacia la boca de su
 * portería a `minSpeed` o más y a menos de `maxDistance` de ella; se usa solo con un tiro, una parada o un gol grabados.
 */
export const DIVE = Object.freeze({ leadMs: 150, minSpeed: 8, maxDistance: 35, mouthMargin: 3, highFrom: .9, netHighFrom: .45, catchWithin: 1, windowMs: 1100, goalHoldMs: 200 });
/** `at`: dónde cruza el balón la altura del portero; `mouth`: dónde cruza la línea de meta (decide el lado, estable
 *  aunque el balón vaya centrado); `height`: altura del balón al cruzar al portero, si la fuente trae altura. */
export type DiveTiming = Readonly<{ ageMs: number; lateral: number; at: Point; mouth: Point; height: number | null }>;

/** Edad de la estirada (ms; negativa si aún no empieza), desvío lateral y punto en que el balón cruza la altura del
 *  portero. null si el balón grabado no va hacia su portería. Pura: sale del fotograma y del anterior. */
export function keeperDiveTiming(keeper: Point, ball: Point & { z?: number }, velocity: (Point & { z?: number }) | null | undefined): DiveTiming | null {
  if (!finite(keeper) || !finite(ball) || !finite(velocity)) return null;
  const high = keeper.x > FIELD_LENGTH / 2, sign = high ? 1 : -1, goalX = high ? FIELD_LENGTH : 0;
  const speed = velocity.x * sign;
  if (!(speed >= DIVE.minSpeed) || (goalX - ball.x) * sign > DIVE.maxDistance) return null;
  const toLine = (goalX - ball.x) * sign / speed, mouth = ball.y + velocity.y * toLine;
  if (Math.abs(mouth - FIELD_WIDTH / 2) > 3.66 + DIVE.mouthMargin) return null;
  const toPlane = (keeper.x - ball.x) * sign / speed, at = { x: keeper.x, y: ball.y + velocity.y * toPlane };
  const height = Number.isFinite(ball.z) && Number.isFinite(velocity.z) ? Math.max(0, ball.z! + velocity.z! * toPlane) : null;
  return { ageMs: DIVE.leadMs - toPlane * 1000, lateral: Math.abs(at.y - keeper.y), at, mouth: { x: goalX, y: mouth }, height };
}

/**
 * Sprite de un jugador en este instante. Las acciones salen SOLO del evento grabado (`cue`) y de su protagonista:
 * pase/disparo → golpeo (cabezazo si el evento dice cabeza o el balón va alto), entrada → plancha, parada → estirada o
 * blocaje del portero que para, gol → celebración del equipo que marca y estirada del portero batido, saque → saque de
 * banda si el balón está en la banda. Sin evento, corre, esprinta o reposa según su velocidad.
 */
export function chooseSprite(input: SpriteInput): SpriteChoice {
  const speed = Math.hypot(input.vx, input.vy), moving = !input.cut && Number.isFinite(speed) && speed >= MOTION.idleBelow;
  const dir = facing(input, moving), keeper = input.role === 'GK';
  const cue = input.cue, age = cue ? input.clockMs - cue.t1_ms : -1, actor = !!cue && cue.participants[0] === input.key;
  if (cue && !input.cut && age >= 0) {
    const highBall = (input.ball?.z ?? 0) >= HEADER_HEIGHT_M;
    if ((cue.type === 'pass' || cue.type === 'shot') && actor) {
      const header = cue.bodyPart === 'head' || highBall;
      if (header && age < ACTION_WINDOW_MS.header) return { anim: 'header', dir, frame: timed('header', age) };
      if (!header && age < ACTION_WINDOW_MS[cue.type]) return { anim: cue.type, dir, frame: timed(cue.type, age) };
    }
    if (cue.type === 'tackle' && actor && !keeper && age < ACTION_WINDOW_MS.slide) return { anim: 'slide', dir, frame: timed('slide', age) };
    if (cue.type === 'restart' && actor && !keeper && age < ACTION_WINDOW_MS.throw && input.ball && (input.ball.y <= 1.5 || input.ball.y >= FIELD_WIDTH - 1.5))
      return { anim: 'throw', dir, frame: timed('throw', age) };
    const facingShot = cue.type === 'shot' && !!cue.side && cue.side !== input.side;
    if (keeper && input.ball && ((cue.type === 'save' && actor) || (cue.type === 'goal' && input.concedingKeeper) || facingShot)) {
      // En la parada el portero mira al campo (su portería a la espalda): sur si defiende la norte, norte si la sur.
      const out: Direction = input.x > FIELD_LENGTH / 2 ? 2 : 6;
      // Primero, el balón grabado (TP222): se estira cuando le llega, con antelación. Sin trayectoria clara, el evento:
      // en la parada, el balón le llega en `t1` (sigue la misma estirada); en el gol ya pasó (se ve tendido).
      const timing = keeperDiveTiming(input, input.ball, input.ballVelocity);
      const diveAge = timing ? timing.ageMs : cue.type === 'save' ? age + DIVE.leadMs : cue.type === 'goal' ? age + DIVE.leadMs + DIVE.goalHoldMs : null;
      const lateral = timing ? timing.lateral : Math.abs(input.ball.y - input.y), aim = timing ? timing.mouth : input.ball;
      // Alta o baja por la altura del balón al llegarle; sin trayectoria en el gol, el balón aún alto en la red delata un
      // remate alto (el balón baja al frenar en la red).
      const z = input.ball.z ?? 0;
      const high = timing ? (timing.height ?? z) >= DIVE.highFrom : cue.type === 'goal' ? z >= DIVE.netHighFrom : z >= DIVE.highFrom;
      if (diveAge !== null && diveAge >= 0) {
        // Blocaje solo en una parada grabada; en tiro y gol se estira hacia el lado del balón (aunque vaya centrado).
        if (cue.type === 'save' && lateral <= DIVE.catchWithin && diveAge < ACTION_WINDOW_MS.catch + DIVE.leadMs) return { anim: 'gk-catch', dir: out, frame: timed('gk-catch', diveAge) };
        if (diveAge < DIVE.windowMs) {
          const anim = `gk-dive-${diveSide(out, input, aim)}-${high ? 'high' : 'low'}`;
          return { anim, dir: out, frame: timed(anim, diveAge) };
        }
      }
    }
    if (cue.type === 'goal' && cue.side === input.side && age < ACTION_WINDOW_MS.celebrate) {
      if (actor && age < ACTION_WINDOW_MS.kneeslide) return { anim: 'kneeslide', dir: 2, frame: looped('kneeslide', input.clockMs, input.key) };
      return { anim: 'celebrate', dir: 2, frame: looped('celebrate', input.clockMs, input.key) };
    }
  }
  if (keeper && (!moving || speed < MOTION.shuffleBelow)) {
    if (!moving) return { anim: 'gk-ready', dir, frame: looped('gk-ready', input.clockMs, input.key) };
    const toBall = facing({ ...input, vx: 0, vy: 0 }, false);
    return { anim: 'gk-shuffle', dir: toBall, frame: Math.floor(Math.max(0, input.runDistance) / .35) % ANIMATIONS['gk-shuffle'].frames };
  }
  if (!moving) return { anim: 'idle', dir, frame: looped('idle', input.clockMs, input.key) };
  const sprint = speed >= MOTION.sprintFrom, anim = sprint ? 'sprint' : 'run';
  const stride = sprint ? MOTION.sprintStride : MOTION.runStride;
  return { anim, dir, frame: Math.floor(Math.max(0, input.runDistance) / stride + hashPhase(input.key)) % ANIMATIONS[anim].frames };
}

// ---------- Árbitro y asistentes (TP222) ----------
// `SceneFrame` no trae árbitros: son figurantes que se colocan con reglas fijas a partir de lo que sí está grabado
// (balón y jugadores). No cuentan para nada, no se pueden seleccionar y nunca tapan una decisión de la fuente.

export type OfficialRole = 'referee' | 'assistant1' | 'assistant2';
export const OFFICIAL_ROLES: readonly OfficialRole[] = ['referee', 'assistant1', 'assistant2'];
export type OfficialState = Readonly<{ x: number; y: number; vx: number; vy: number; clockMs: number; run: number }>;
export const OFFICIAL_MOTION = Object.freeze({ maxSpeed: { referee: 7.5, assistant1: 7, assistant2: 7 }, tauMs: 650, snapAfterMs: 1500 });
/** Línea por la que corre cada asistente (fuera del campo) y la mitad que cubre. */
/** Lo más cerca de una línea de meta (m) que se coloca el árbitro. */
export const REFEREE_DEPTH = 12;
export const ASSISTANT_LINE = Object.freeze({ assistant1: { y: -1.8, from: FIELD_LENGTH / 2, to: FIELD_LENGTH }, assistant2: { y: FIELD_WIDTH + 1.8, from: 0, to: FIELD_LENGTH / 2 } });

type Body = Readonly<{ side: 'home' | 'away'; role: string; x: number; y: number }>;

/**
 * Dónde quiere estar cada uno. Árbitro: en diagonal, a unos 7 m del balón hacia el centro en el largo y 9 m hacia el
 * medio en el ancho (sin saltos al cruzar el medio). Asistentes: en su banda y su mitad, a la altura del penúltimo
 * defensor del equipo que defiende esa mitad (fuera de juego) o del balón si está más allá.
 */
export function officialTargets(players: readonly Body[], ball: Point | null): Record<OfficialRole, Point> {
  const b = finite(ball) ? ball : { x: FIELD_LENGTH / 2, y: FIELD_WIDTH / 2 };
  let dx = -7 * clamp((b.x - FIELD_LENGTH / 2) / 15, -1, 1), dy = 9 * clamp((40 - b.y) / 10, -1, 1);
  // Nunca encima del balón (en el saque inicial los dos desplazamientos se anulan): al menos 6 m.
  const gap = Math.hypot(dx, dy);
  if (gap < 6) { const k = gap > 1e-6 ? 6 / gap : 0; dx = gap > 1e-6 ? dx * k : -3.6; dy = gap > 1e-6 ? dy * k : 4.8; }
  // En el largo, nunca más hondo que unos 12 m de la línea de meta (el punto de penalti): con el balón en la boca de gol
  // se quedaba dentro del área pequeña, junto al portero.
  const referee = { x: clamp(b.x + dx, REFEREE_DEPTH, FIELD_LENGTH - REFEREE_DEPTH), y: clamp(b.y + dy, 3, FIELD_WIDTH - 3) };
  const valid = players.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
  const defenders = (high: boolean) => {
    // Defiende la mitad alta (x grande) el equipo cuyo portero está en ella; sin portero, el de x media mayor.
    const mean = (side: 'home' | 'away') => { const ps = valid.filter(p => p.side === side); return ps.length ? ps.reduce((t, p) => t + p.x, 0) / ps.length : FIELD_LENGTH / 2; };
    const gk = valid.find(p => p.role === 'GK' && (high ? p.x > FIELD_LENGTH / 2 : p.x < FIELD_LENGTH / 2));
    const side = gk ? gk.side : (mean('home') > mean('away')) === high ? 'home' : 'away';
    return valid.filter(p => p.side === side).map(p => p.x).sort((x, y) => high ? y - x : x - y);
  };
  const line = (high: boolean) => {
    const xs = defenders(high), second = xs.length >= 2 ? xs[1] : FIELD_LENGTH / 2;
    const deepest = high ? Math.max(second, b.x) : Math.min(second, b.x);
    return clamp(deepest, high ? FIELD_LENGTH / 2 : 0, high ? FIELD_LENGTH : FIELD_LENGTH / 2);
  };
  return {
    referee,
    assistant1: { x: line(true), y: ASSISTANT_LINE.assistant1.y },
    assistant2: { x: line(false), y: ASSISTANT_LINE.assistant2.y },
  };
}

/** Avanza un árbitro hacia su sitio con retardo y velocidad máxima; en cortes, saltos de tiempo o rebobinado, salta. */
export function stepOfficial(prev: OfficialState | null, target: Point, clockMs: number, cut: boolean, maxSpeed: number): OfficialState {
  const dt = prev ? clockMs - prev.clockMs : 0;
  if (!prev || cut || !(dt >= 0) || dt > OFFICIAL_MOTION.snapAfterMs) return { x: target.x, y: target.y, vx: 0, vy: 0, clockMs, run: prev?.run ?? 0 };
  if (dt === 0) return prev;
  const k = 1 - Math.exp(-dt / OFFICIAL_MOTION.tauMs);
  let sx = (target.x - prev.x) * k, sy = (target.y - prev.y) * k;
  const len = Math.hypot(sx, sy), cap = maxSpeed * dt / 1000;
  if (len > cap) { sx *= cap / len; sy *= cap / len; }
  return { x: prev.x + sx, y: prev.y + sy, vx: sx / (dt / 1000), vy: sy / (dt / 1000), clockMs, run: prev.run + Math.hypot(sx, sy) };
}

const WHISTLE = new Set(['goal', 'kickoff', 'halftime', 'fulltime', 'foul', 'offside']);
/** Ventanas (ms desde el evento grabado) de los gestos de los árbitros. */
export const OFFICIAL_WINDOW_MS = Object.freeze({ whistle: 1600, card: 2500, flag: 1400 });
/** Mitad que cubre cada asistente (largo del campo). */
const covers = (role: Exclude<OfficialRole, 'referee'>, x: number) => x >= ASSISTANT_LINE[role].from && x <= ASSISTANT_LINE[role].to;

/**
 * Sprite del árbitro o de un asistente; solo ilustra eventos grabados. El árbitro pita (señala) en gol, saques de
 * parte, falta y fuera de juego, y enseña la tarjeta SOLO con una tarjeta grabada (`cue.type === 'card'`), mirando al
 * amonestado si está en el campo (`cardTarget`). El asistente levanta el banderín en un fuera de juego grabado en su
 * mitad y en un saque de banda por su lado y en su mitad.
 */
export function chooseOfficialSprite(role: OfficialRole, state: OfficialState, ball: Point | null, cue: VisualCue | null | undefined,
  cardTarget: Point | null = null): SpriteChoice {
  const speed = Math.hypot(state.vx, state.vy), moving = Number.isFinite(speed) && speed >= MOTION.idleBelow;
  const me = fieldToStadium(state.x, state.y), b = finite(ball) ? fieldToStadium(ball.x, ball.y) : null;
  const toBall: Direction = b && Math.hypot(b.x - me.x, b.y - me.y) > 1 ? directionOf(b.x - me.x, b.y - me.y) : 2;
  const age = cue ? state.clockMs - cue.t1_ms : -1;
  const key = role;
  if (role === 'referee') {
    if (cue && cue.type === 'card' && age >= 0 && age < OFFICIAL_WINDOW_MS.card) {
      const t = finite(cardTarget) ? fieldToStadium(cardTarget.x, cardTarget.y) : null;
      const dir = t && Math.hypot(t.x - me.x, t.y - me.y) > 1 ? directionOf(t.x - me.x, t.y - me.y) : toBall;
      return { anim: 'ref-card', dir, frame: timed('ref-card', age) };
    }
    if (cue && WHISTLE.has(cue.type) && age >= 0 && age < OFFICIAL_WINDOW_MS.whistle) return { anim: 'ref-whistle', dir: toBall, frame: looped('ref-whistle', state.clockMs, key) };
    if (!moving) return { anim: 'idle', dir: toBall, frame: looped('idle', state.clockMs, key) };
    const v = screenVelocity(state.vx, state.vy);
    return { anim: 'run', dir: directionOf(v.x, v.y), frame: Math.floor(state.run / MOTION.runStride) % ANIMATIONS.run.frames };
  }
  const lineInfo = ASSISTANT_LINE[role], field: Direction = role === 'assistant1' ? 0 : 4;
  const where = cue && finite(cue.at) ? cue.at : finite(ball) ? ball : null;
  const offside = !!cue && cue.type === 'offside' && finite(cue.at) && covers(role, cue.at.x);
  const throwIn = !!cue && cue.type === 'restart' && !!where && Math.abs(where.y - lineInfo.y) < 3.5 && covers(role, where.x);
  if (cue && (offside || throwIn) && age >= 0 && age < OFFICIAL_WINDOW_MS.flag)
    return { anim: 'ar-flag', dir: field, frame: looped('ar-flag', state.clockMs, key) };
  if (!moving) return { anim: 'ar-idle', dir: field, frame: looped('ar-idle', state.clockMs, key) };
  // Corre de lado mirando al campo cuando va despacio; a la carrera, hacia donde va.
  const v = screenVelocity(state.vx, state.vy);
  const dir = speed < 4 ? field : directionOf(v.x, v.y);
  return { anim: 'ar-run', dir, frame: Math.floor(state.run / MOTION.runStride) % ANIMATIONS['ar-run'].frames };
}

// ---------- Balón ----------

export type BallChoice = Readonly<{ key: string; shadow: string; lift: number }>;
/** Tamaño y elevación del balón: solo si la fuente trae `z`; si no, va a ras de suelo. Giro según metros rodados. */
export function chooseBall(z: number, rolled: number): BallChoice {
  const h = Number.isFinite(z) && z > 0 ? z : 0, size = h < .5 ? 's' : h < 2 ? 'm' : 'l';
  return { key: `ball.${size}.${Math.floor(Math.max(0, rolled) / .45) % 4}`, shadow: `shadow.ball-${size}`, lift: Math.round(h * PX_PER_M * .75) };
}

/** Fondo de la red tras la línea de meta (m), menos el radio del balón. */
export const NET_DEPTH = 1.8;
/**
 * Balón dentro de la red tras un gol grabado: si la grabación lo lleva más allá del fondo de la red o por encima del
 * larguero entre los postes, se pinta contra la red (no en la grada ni sobre las vallas). Solo cambia dónde se dibuja;
 * la posición grabada no se toca y fuera de los postes no se hace nada.
 */
export function ballInNet<T extends Readonly<{ x: number; y: number; z: number }>>(ball: T): T {
  if (!(Math.abs(ball.y - FIELD_WIDTH / 2) <= 3.66 + .3)) return ball;
  if (ball.x > FIELD_LENGTH) return { ...ball, x: Math.min(ball.x, FIELD_LENGTH + NET_DEPTH), z: Math.min(ball.z, 2.2) };
  if (ball.x < 0) return { ...ball, x: Math.max(ball.x, -NET_DEPTH), z: Math.min(ball.z, 2.2) };
  return ball;
}

// ---------- Marcador ----------

const PREFIXES = new Set(['MANCHESTER', 'SHEFFIELD', 'WEST', 'NOTTINGHAM', 'QUEENS']);
/** Sigla de 3 letras para el marcador (Manchester United → MUN, Arsenal → ARS). Solo letras A–Z y cifras. */
export function teamTag(name: string): string {
  const made = fictionalAbbr(name);
  if (made) return made;
  const words = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/)
    .filter(w => w && w !== 'AFC' && w !== 'FC');
  if (!words.length) return '---';
  if (words.length >= 2 && PREFIXES.has(words[0])) return (words[0][0] + words[1].slice(0, 2)).padEnd(3, '-');
  return words[0].slice(0, 3).padEnd(3, '-');
}
/** Texto que la letra del marcador puede pintar: mayúsculas sin acentos; lo desconocido pasa a espacio. */
export function hudText(text: string, glyphs: ReadonlySet<string>): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().split('').map(c => glyphs.has(c) || c === ' ' ? c : ' ').join('').trim();
}
