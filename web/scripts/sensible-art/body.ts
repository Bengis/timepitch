// Esqueleto del futbolista y conversión de una pose a primitivas (TP219). Proporciones de «cabezón» de 16 px:
// cabeza 4 px, torso 5 px, piernas 7 px. Todas las medidas en píxeles del sprite.
import { INDEX, headIndex, headSignature, zoneOf, type HairFeature } from '../../src/match/renderers/sensible/palette.ts';
import {
  type M3, type Mat, type Prim, type V3, I3, SHIRT_BITS, add, ap, capsule, ellipsoid, fixed, mul, rad, ramp, rotX, rotY, rotZ, shirt, sphere,
} from './rig.ts';

export type Limb = Readonly<{ flex: number; abd?: number; bend: number; twist?: number }>;
export type Pose = Readonly<{
  /** Desplazamiento de la pelvis en el marco del cuerpo (x derecha, y delante, z arriba), sobre la altura normal. */
  root?: V3;
  /** Inclinación hacia delante de todo el cuerpo (grados; negativo = hacia atrás). */
  pitch?: number;
  /** Alabeo lateral (grados; positivo = cae hacia su derecha). */
  roll?: number;
  /** Giro extra del cuerpo respecto a la dirección del sprite (grados, positivo = hacia su izquierda). */
  yaw?: number;
  spine?: number; twist?: number;
  head?: Readonly<{ nod?: number; turn?: number }>;
  legL: Limb; legR: Limb; armL: Limb; armR: Limb;
}>;
/** `prop`: lo que lleva en la mano derecha (árbitro: tarjeta; asistente: banderín). */
export type Outfit = Readonly<{ keeper?: boolean; official?: 'referee' | 'assistant'; prop?: 'card' | 'flag' }>;

/** Marca de píxel para el dorsal: dorso o pecho de la camiseta visibles. */
export const TAG = Object.freeze({ back: 1, front: 2 });

const HIP_Z = 6.7, THIGH = 2.85, SHIN = 3.05, UPPER = 2.2, FORE = 2.0;

/** Rumbo de brújula de cada dirección de pantalla (N = hacia el fondo, S = hacia la cámara). */
export const DIRECTIONS = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'] as const;
export type Direction = typeof DIRECTIONS[number];
export const BEARING: Record<Direction, number> = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };

/** Marco de un miembro: abd separa del cuerpo (lado ±1), flex lo adelanta. */
function limbFrame(parent: M3, side: number, l: Limb): M3 {
  return mul(mul(mul(parent, rotY(-side * rad(l.abd ?? 0))), rotZ(side * rad(l.twist ?? 0))), rotX(rad(l.flex)));
}

/** Celda de pantalla de 1 px (rayas en columnas, aros en filas), igual en camiseta y mangas. */
const gridBits = (p: V3, col0: number, row0: number) =>
  (((Math.floor(p[0]) - col0) % 2 + 2) % 2 === 1 ? SHIRT_BITS.stripe : 0) | (((Math.floor(p[2] + .5 * p[1]) - row0) % 2 + 2) % 2 === 1 ? SHIRT_BITS.hoop : 0);

/** `feature` añade el rasgo de pelo que sobresale del cráneo (tupé, rizos, melena, moño) para su capa aparte. */
export function buildPlayer(dir: Direction, pose: Pose, outfit: Outfit = {}, feature?: HairFeature): Prim[] {
  const yaw = -rad(BEARING[dir]) + rad(pose.yaw ?? 0);
  const body = mul(mul(mul(rotZ(yaw), rotX(-rad(pose.pitch ?? 0))), rotY(rad(pose.roll ?? 0))), I3);
  const r = pose.root ?? [0, 0, 0];
  const pelvis: V3 = add([0, 0, HIP_Z], ap(rotZ(yaw), r));
  const chest = mul(mul(body, rotX(-rad(pose.spine ?? 0))), rotZ(rad(pose.twist ?? 0)));
  const at = (frame: M3, origin: V3, v: V3) => add(origin, ap(frame, v));
  const prims: Prim[] = [];
  const keeper = !!outfit.keeper;

  // Torso: camiseta con zonas de patrón (ángulo alrededor del eje para las rayas, altura para los aros).
  const torsoC = at(chest, pelvis, [0, 0, 2.55]);
  // Rayas y aros en columnas/filas de 1 px de PANTALLA, alineadas con la rejilla (como los haría un pixel artist):
  // desde cualquier dirección se leen limpias, sin el moteado que deja un patrón muestreado en 3D.
  const colBase = Math.floor(torsoC[0]), rowBase = Math.floor(torsoC[2] + .5 * torsoC[1]);
  const torsoPrim = ellipsoid(1, torsoC, [2.6, 2.0, 2.5], chest, (l) => {
    if (l[2] > .86 && Math.abs(l[0]) < .6) return ramp('trim');
    let bits = 0;
    if (l[0] < 0) bits |= SHIRT_BITS.half;
    if (Math.abs(l[0] * .9 + l[2] * 1.1) < .38) bits |= SHIRT_BITS.sash;
    // Dorso y pecho (para colocar el dorsal): la parte central, lejos de costados, cuello y cintura.
    const tag = Math.abs(l[0]) < .82 && l[2] < .84 && l[2] > -.85 ? (l[1] < -.08 ? TAG.back : l[1] > .08 ? TAG.front : 0) : 0;
    return { ...shirt(bits), tag };
  });
  prims.push({ ...torsoPrim, mat(p, n) {
    const m = torsoPrim.mat(p, n);
    if (m.stride !== 16) return m;
    return { ...shirt((m.base - shirt(0).base) | gridBits(p, colBase, rowBase)), tag: m.tag };
  } });
  // Pantalón.
  prims.push(ellipsoid(2, at(body, pelvis, [0, 0, -.25]), [2.35, 1.85, 1.3], body, () => ramp('shorts')));

  // Piernas.
  for (const side of [-1, 1]) {
    const leg = side < 0 ? pose.legL : pose.legR;
    const hip = at(body, pelvis, [side * 1.15, 0, -.4]);
    const thighF = limbFrame(body, side, leg);
    const knee = at(thighF, hip, [0, 0, -THIGH]);
    const shinF = mul(thighF, rotX(-rad(leg.bend)));
    const ankle = at(shinF, knee, [0, 0, -SHIN]);
    const footF = mul(shinF, rotX(rad(leg.bend * .45 - leg.flex * .2)));
    const p = side < 0 ? 10 : 20;
    prims.push(capsule(p, hip, knee, .86, (u) => (u < .5 ? ramp('shorts') : ramp('skin'))));
    prims.push(capsule(p + 1, knee, ankle, .72, (u) => (u < .16 ? ramp('skin') : ramp('socks'))));
    prims.push(ellipsoid(p + 2, at(footF, ankle, [0, .5, -.2]), [.62, 1.05, .5], footF, () => ramp('boots')));
  }

  // Brazos: manga corta (portero: larga) y guantes de portero.
  const hands: { side: number; hand: V3; fore: M3 }[] = [];
  for (const side of [-1, 1]) {
    const arm = side < 0 ? pose.armL : pose.armR;
    const sleeve = side < 0 ? 'sleeveL' : 'sleeveR';
    const shoulder = at(chest, pelvis, [side * 2.3, 0, 4.15]);
    const upperF = limbFrame(chest, side, { ...arm, abd: (arm.abd ?? 0) + 8 });
    const elbow = at(upperF, shoulder, [0, 0, -UPPER]);
    const foreF = mul(upperF, rotX(rad(arm.bend)));
    const hand = at(foreF, elbow, [0, 0, -FORE]);
    const p = side < 0 ? 30 : 40;
    // Manga con su propio índice de patrón (rayas/aros a rejilla de pantalla, alineadas con las del torso).
    const sleeveMat = (q: V3): Mat => ({ base: INDEX.sleeve + (side < 0 ? 0 : 12) + gridBits(q, colBase, rowBase), stride: 4 });
    const upper = capsule(p, shoulder, elbow, .74, (u) => (!keeper && u > .78 ? ramp('trim') : ramp(sleeve)));
    prims.push({ ...upper, mat(q, n) { const m = upper.mat(q, n); return m.base === ramp(sleeve).base ? sleeveMat(q) : m; } });
    const fore = capsule(p + 1, elbow, hand, .62, () => (keeper ? ramp(sleeve) : ramp('skin')));
    prims.push({ ...fore, mat(q, n) { const m = fore.mat(q, n); return m.base === ramp(sleeve).base ? sleeveMat(q) : m; } });
    hands.push({ side, hand, fore: foreF });
    prims.push(sphere(p + 2, hand, keeper ? .82 : .6, () => (keeper ? ramp('gloves') : ramp('skin'))));
  }

  // Cabeza: pelo por encima y por detrás, cara delante.
  const headF = mul(mul(chest, rotZ(rad(pose.head?.turn ?? 0))), rotX(-rad(pose.head?.nod ?? 0)));
  const neck = at(chest, pelvis, [0, 0, 4.75]);
  const headC = at(headF, neck, [0, .15, 1.75]);
  // TP222: cada píxel del cráneo guarda su zona (pelo/piel/barba según peinado, ver palette.ts → HEAD_ZONES).
  prims.push(sphere(50, headC, 2.15, (l) => ({ base: headIndex(zoneOf(headSignature(l)), 0), stride: 1 }), headF));
  const hairAt = (v: V3) => at(headF, headC, v);
  if (feature === 'quiff') prims.push(ellipsoid(51, hairAt([.2, 1.05, 1.7]), [1.45, 1.1, 1.0], headF, () => ramp('hair')));
  if (feature === 'curly') prims.push(ellipsoid(51, hairAt([0, -.5, .75]), [2.8, 2.55, 2.5], headF, (l) =>
    // Rizos: celdas de ~1 px alternando medio y sombra.
    ({ ...ramp('hair'), bias: (Math.floor(l[0] * 3.1 + 9) + Math.floor(l[1] * 3.1 + 9) + Math.floor(l[2] * 3.1 + 9)) & 1 })));
  if (feature === 'long') prims.push(ellipsoid(51, hairAt([0, -1.2, -1.35]), [2.15, 1.05, 2.05], headF, () => ramp('hair')));
  if (feature === 'tied') {
    prims.push(sphere(51, hairAt([0, -2.05, .9]), .95, () => ramp('hair')));
    prims.push(capsule(52, hairAt([0, -2.45, .55]), hairAt([0, -2.75, -1.5]), .55, () => ramp('hair')));
  }

  // Lo que lleva en la mano derecha (árbitros).
  const right = hands.find(h => h.side > 0)!;
  if (outfit.prop === 'card') {
    prims.push(ellipsoid(60, at(right.fore, right.hand, [0, 0, -1.05]), [.75, .22, 1.0], right.fore, () => fixed(INDEX.card)));
  }
  if (outfit.prop === 'flag') {
    const tip = at(right.fore, right.hand, [0, 0, -3.4]);
    prims.push(capsule(60, right.hand, tip, .3, () => fixed(INDEX.postShade)));
    prims.push(ellipsoid(61, at(right.fore, right.hand, [0, 1.15, -2.6]), [.24, 1.3, 1.0], right.fore, (l) =>
      fixed((l[1] > 0) !== (l[2] > 0) ? INDEX.flag : INDEX.flagLight)));
  }
  return prims;
}

/** Sombra de suelo: elipse plana en índice `shadow`, centrada en el ancla. */
export function shadowPrims(rx: number, ry: number): Prim[] {
  return [ellipsoid(0, [0, 0, 0], [rx, ry, .01], I3, (): Mat => ({ base: INDEX.shadow, stride: 0, flat: true }))];
}
