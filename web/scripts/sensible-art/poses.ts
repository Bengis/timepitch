// Animaciones del estilo «Clásico 16 bits» (TP219): poses clave escritas a mano, en grados, por fotograma.
// Convenciones: flex > 0 adelanta el miembro; bend dobla rodilla (atrás) o codo (adelante); abd lo separa del cuerpo.
import type { Limb, Outfit, Pose } from './body.ts';

export type Anim = Readonly<{
  name: string; fps: number; loop: boolean; outfit?: Outfit;
  /** false = un solo sentido (no hay 8 direcciones). */
  directional?: boolean;
  frames: readonly Pose[];
  note: string;
}>;

const L = (flex: number, bend: number, abd = 0, twist = 0): Limb => ({ flex, bend, abd, twist });
const TAU = Math.PI * 2;

function gait(n: number, o: { legA: number; knee: number; armA: number; elbow: number; lean: number; bob: number }): Pose[] {
  const out: Pose[] = [];
  for (let f = 0; f < n; f++) {
    const p = f / n * TAU;
    const leg = (ph: number) => L(o.legA * Math.sin(ph), 12 + o.knee * Math.max(0, Math.cos(ph)) ** 1.3, 2);
    const arm = (ph: number) => L(-o.armA * Math.sin(ph), o.elbow, 7);
    out.push({
      root: [0, 0, -o.bob + o.bob * 1.4 * Math.abs(Math.sin(p))], pitch: o.lean, twist: 7 * Math.sin(p),
      legR: leg(p), legL: leg(p + Math.PI), armR: arm(p), armL: arm(p + Math.PI),
    });
  }
  return out;
}

const stand: Pose = { legL: L(2, 6, 4), legR: L(-2, 6, 4), armL: L(4, 14, 6), armR: L(-4, 14, 6) };

export const OUTFIELD: readonly Anim[] = [
  { name: 'idle', fps: 3, loop: true, note: 'Reposo con respiración de 1 px.',
    frames: [stand, { ...stand, root: [0, 0, -.45], legL: L(3, 14, 4), legR: L(-1, 14, 4), armL: L(6, 20, 8), armR: L(-2, 20, 8) }] },
  { name: 'run', fps: 12, loop: true, note: 'Carrera, 6 fotogramas; avanzar 1 fotograma cada ~0,6 m.',
    frames: gait(6, { legA: 40, knee: 82, armA: 42, elbow: 85, lean: 10, bob: .45 }) },
  { name: 'sprint', fps: 15, loop: true, note: 'Esprint: zancada larga, más inclinado y brazos amplios.',
    frames: gait(6, { legA: 55, knee: 105, armA: 62, elbow: 92, lean: 20, bob: .6 }) },
  { name: 'pass', fps: 12, loop: false, note: 'Pase: armado, contacto (fotograma 1) y acompañamiento.',
    frames: [
      { pitch: 6, twist: -12, legR: L(-38, 68), legL: L(6, 22, 3), armL: L(28, 30, 38), armR: L(-24, 30, 26) },
      { pitch: 2, twist: 6, legR: L(28, 14, -4), legL: L(4, 24, 3), armL: L(10, 20, 46), armR: L(-10, 20, 34) },
      { pitch: -4, twist: 12, legR: L(52, 8, -6), legL: L(2, 18, 3), armL: L(-12, 20, 34), armR: L(18, 24, 30) },
    ] },
  { name: 'shot', fps: 12, loop: false, note: 'Disparo: apoyo, carga, golpeo (fotograma 2) y remate alto.',
    frames: [
      { pitch: 12, legR: L(-20, 52), legL: L(20, 26, 3), armL: L(30, 40, 20), armR: L(-30, 40, 16) },
      { pitch: 8, twist: -18, legR: L(-62, 108), legL: L(6, 26, 4), armL: L(20, 25, 72), armR: L(-40, 30, 36) },
      { pitch: 4, twist: 10, legR: L(24, 12, -6), legL: L(4, 22, 4), armL: L(-10, 20, 62), armR: L(10, 24, 44) },
      { root: [0, 0, .7], pitch: -10, twist: 16, legR: L(88, 6, -8), legL: L(-4, 14, 3), armL: L(40, 30, 50), armR: L(-30, 30, 60) },
    ] },
  { name: 'slide', fps: 10, loop: false, note: 'Entrada en plancha: caída, deslizamiento (fotograma 1, el que roba) y final.',
    frames: [
      { root: [0, .4, -2.0], pitch: -24, legR: L(46, 10), legL: L(-14, 76), armL: L(-16, 20, 52), armR: L(24, 30, 46) },
      { root: [0, 1.4, -4.9], pitch: -64, legR: L(24, 0, -4), legL: L(-30, 96, 10), armL: L(-40, 10, 62), armR: L(30, 40, 56) },
      { root: [0, 2.2, -5.3], pitch: -74, head: { nod: 18 }, legR: L(16, 0, -4), legL: L(-24, 104, 10), armL: L(-50, 10, 66), armR: L(14, 30, 60) },
    ] },
  { name: 'header', fps: 10, loop: false, note: 'Cabezazo: impulso, salto y contacto (fotograma 2, +4 px de altura).',
    frames: [
      { root: [0, 0, -1.3], pitch: 16, legR: L(34, 62, 4), legL: L(34, 62, 4), armL: L(-30, 30, 20), armR: L(-30, 30, 20) },
      { root: [0, 0, 3.2], pitch: -10, head: { nod: -22 }, legR: L(14, 52, 6), legL: L(4, 40, 6), armL: L(20, 40, 70), armR: L(20, 40, 70) },
      { root: [0, 0, 4.0], pitch: 16, head: { nod: 30 }, legR: L(-12, 70, 6), legL: L(-4, 56, 6), armL: L(-10, 30, 80), armR: L(-10, 30, 80) },
    ] },
  { name: 'throw', fps: 8, loop: false, note: 'Saque de banda: balón tras la cabeza, impulso y suelta (fotograma 2).',
    frames: [
      { pitch: -14, spine: -10, head: { nod: -10 }, legR: L(-16, 10, 3), legL: L(20, 10, 3), armL: L(172, 62, 18), armR: L(172, 62, 18) },
      { pitch: -2, legR: L(-16, 12, 3), legL: L(20, 14, 3), armL: L(176, 14, 14), armR: L(176, 14, 14) },
      { pitch: 16, spine: 10, head: { nod: 12 }, legR: L(-18, 18, 3), legL: L(22, 20, 3), armL: L(112, 4, 10), armR: L(112, 4, 10) },
    ] },
  { name: 'celebrate', fps: 6, loop: true, note: 'Celebración con los brazos arriba y saltito.',
    frames: [
      { head: { nod: -12 }, legR: L(2, 8, 6), legL: L(-2, 8, 6), armL: L(12, 20, 150), armR: L(12, 20, 150) },
      { root: [0, 0, 1.8], head: { nod: -18 }, legR: L(10, 36, 8), legL: L(4, 30, 8), armL: L(14, 10, 168), armR: L(14, 10, 168) },
    ] },
  { name: 'kneeslide', fps: 6, loop: true, note: 'Celebración de rodillas, deslizando (desplazar el sprite al reproducirla).',
    frames: [
      { root: [0, 0, -2.8], pitch: -24, head: { nod: -24 }, legR: L(4, 92, 10), legL: L(4, 92, 10), armL: L(24, 26, 118), armR: L(24, 26, 118) },
      { root: [0, 0, -2.8], pitch: -34, head: { nod: -30 }, legR: L(8, 98, 12), legL: L(8, 98, 12), armL: L(40, 14, 142), armR: L(40, 14, 142) },
    ] },
  { name: 'fall', fps: 8, loop: false, note: 'Caída: tropiezo, caída y tendido boca abajo (último fotograma se mantiene).',
    frames: [
      { root: [0, .8, -.5], pitch: 30, head: { nod: -10 }, legR: L(-30, 64), legL: L(20, 22, 4), armL: L(62, 20, 22), armR: L(62, 20, 22) },
      { root: [0, 2.8, -2.8], pitch: 64, head: { nod: -28 }, legR: L(-24, 36, 4), legL: L(-8, 30, 4), armL: L(120, 10, 30), armR: L(120, 10, 30) },
      { root: [0, 4.8, -5.3], pitch: 88, head: { nod: -38 }, legR: L(-6, 14, 6), legL: L(-2, 8, 6), armL: L(160, 20, 36), armR: L(160, 20, 36) },
    ] },
];

const KEEPER: Outfit = { keeper: true };
const ready: Pose = { root: [0, 0, -1.1], pitch: 18, legR: L(26, 48, 14), legL: L(26, 48, 14), armL: L(52, 36, 32), armR: L(52, 36, 32) };

function dive(side: -1 | 1, high: boolean): Pose[] {
  const s = side;
  return [
    { root: [s * 1.2, 0, -1.4], roll: s * 22, pitch: 8, legR: L(20, 56, s > 0 ? 6 : 22), legL: L(20, 56, s > 0 ? 22 : 6),
      armL: L(30, 30, s < 0 ? 120 : 60), armR: L(30, 30, s > 0 ? 120 : 60) },
    { root: [s * 4.8, 0, high ? 3.6 : -2.2], roll: s * (high ? 72 : 82), pitch: 4,
      legR: L(-4, 14, s > 0 ? 4 : 16), legL: L(-4, 14, s > 0 ? 16 : 4), armL: L(8, 6, 172), armR: L(8, 6, 172) },
    { root: [s * 6.2, 0, -4.9], roll: s * 90, pitch: 6, head: { nod: 10 },
      legR: L(10, 34, s > 0 ? 4 : 14), legL: L(10, 34, s > 0 ? 14 : 4), armL: L(30, 40, 160), armR: L(30, 40, 160) },
  ];
}

export const GOALKEEPER: readonly Anim[] = [
  { name: 'gk-ready', fps: 3, loop: true, outfit: KEEPER, note: 'Portero en guardia, rodillas flexionadas.',
    frames: [ready, { ...ready, root: [0, 0, -1.6], legR: L(30, 56, 14), legL: L(30, 56, 14) }] },
  { name: 'gk-shuffle', fps: 10, loop: true, outfit: KEEPER, note: 'Desplazamiento lateral en guardia (mover el sprite de lado).',
    frames: [
      { ...ready, root: [-.4, 0, -1.1], legR: L(24, 46, 24), legL: L(24, 46, 10) },
      { ...ready, root: [0, 0, -.7], legR: L(22, 40, 12), legL: L(22, 40, 12) },
      { ...ready, root: [.4, 0, -1.1], legR: L(24, 46, 10), legL: L(24, 46, 24) },
      { ...ready, root: [0, 0, -1.4], legR: L(28, 54, 16), legL: L(28, 54, 16) },
    ] },
  { name: 'gk-dive-left-high', fps: 10, loop: false, outfit: KEEPER, note: 'Estirada a su izquierda, alta (despegue, vuelo, caída).', frames: dive(-1, true) },
  { name: 'gk-dive-left-low', fps: 10, loop: false, outfit: KEEPER, note: 'Estirada a su izquierda, a ras de suelo.', frames: dive(-1, false) },
  { name: 'gk-dive-right-high', fps: 10, loop: false, outfit: KEEPER, note: 'Estirada a su derecha, alta.', frames: dive(1, true) },
  { name: 'gk-dive-right-low', fps: 10, loop: false, outfit: KEEPER, note: 'Estirada a su derecha, a ras de suelo.', frames: dive(1, false) },
  { name: 'gk-catch', fps: 8, loop: false, outfit: KEEPER, note: 'Blocaje: manos al frente y balón al pecho.',
    frames: [
      { pitch: 6, legR: L(6, 16, 8), legL: L(6, 16, 8), armL: L(82, 26, 12), armR: L(82, 26, 12) },
      { pitch: 18, root: [0, 0, -.6], head: { nod: 14 }, legR: L(14, 30, 8), legL: L(14, 30, 8), armL: L(44, 118, 6), armR: L(44, 118, 6) },
    ] },
  { name: 'gk-punt', fps: 10, loop: false, outfit: KEEPER, note: 'Despeje de volea: suelta, golpeo (fotograma 1) y remate.',
    frames: [
      { pitch: 4, legR: L(-38, 62), legL: L(8, 20, 3), armL: L(74, 12, 10), armR: L(74, 12, 10) },
      { pitch: -10, legR: L(72, 6, -4), legL: L(2, 20, 3), armL: L(20, 20, 60), armR: L(10, 20, 54) },
      { root: [0, 0, .8], pitch: -16, legR: L(98, 4, -6), legL: L(-4, 12, 3), armL: L(10, 20, 70), armR: L(-10, 20, 64) },
    ] },
];

// ---------- Árbitro y asistentes (TP222) ----------
// El árbitro corre y espera con los sprites del jugador (`run`, `idle`) y su propia equipación; aquí solo lo que es
// suyo: pitar señalando, mostrar tarjeta, y el banderín de los asistentes (quieto, corriendo y levantado).
const REF: Outfit = { official: 'referee' };
const REF_CARD: Outfit = { official: 'referee', prop: 'card' };
const FLAG: Outfit = { official: 'assistant', prop: 'flag' };
const flagDown = (p: Pose): Pose => ({ ...p, armR: L(14, 8, 14) });

export const OFFICIALS: readonly Anim[] = [
  { name: 'ref-whistle', fps: 4, loop: true, outfit: REF, note: 'Árbitro: silbato a la boca y brazo señalando al frente.',
    frames: [
      { pitch: -2, head: { nod: -6 }, legL: L(4, 8, 4), legR: L(-6, 8, 4), armL: L(58, 138, 26), armR: L(88, 4, 12) },
      { pitch: -4, head: { nod: -8 }, legL: L(4, 8, 4), legR: L(-6, 8, 4), armL: L(60, 140, 26), armR: L(104, 2, 14) },
    ] },
  { name: 'ref-card', fps: 6, loop: false, outfit: REF_CARD, note: 'Árbitro: saca la tarjeta del bolsillo y la levanta (fotograma 1).',
    frames: [
      { pitch: 4, legL: L(4, 8, 4), legR: L(-4, 8, 4), armL: L(6, 16, 8), armR: L(26, 96, 18) },
      { pitch: -4, head: { nod: -10 }, legL: L(4, 8, 4), legR: L(-4, 8, 4), armL: L(4, 18, 10), armR: L(176, 2, 4) },
    ] },
  { name: 'ar-idle', fps: 3, loop: true, outfit: FLAG, note: 'Asistente parado con el banderín abajo.',
    frames: [flagDown(stand), flagDown({ ...stand, root: [0, 0, -.45], legL: L(3, 14, 4), legR: L(-1, 14, 4) })] },
  { name: 'ar-run', fps: 12, loop: true, outfit: FLAG, note: 'Asistente corriendo por la banda con el banderín abajo.',
    frames: gait(6, { legA: 36, knee: 76, armA: 30, elbow: 70, lean: 8, bob: .4 }).map(p => ({ ...p, armR: L(16, 10, 16) })) },
  { name: 'ar-flag', fps: 4, loop: true, outfit: FLAG, note: 'Asistente con el banderín levantado (dos fotogramas: ondea).',
    frames: [
      { ...stand, head: { nod: -8 }, armR: L(172, 2, 4) },
      { ...stand, head: { nod: -8 }, armR: L(166, 6, 16) },
    ] },
];
