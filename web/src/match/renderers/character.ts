import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  HAIR_COLOURS, HAIR_STYLES as PALETTE_HAIR_STYLES, HEX_COLOUR, SKIN_TONES, mixHex,
} from '../../presentation/avatar/palette';
import type { AppearanceParams, HairStyle } from '../../presentation/types';
import type { KitMaterials, NumberAtlas } from './kit-texture';
import { applyPlayerPose, derivePlayerPose, type PlayerPose } from './poses';
import type { PlayerArt } from './three-art';
import type { DetailLevel, PitchRenderInput } from './types';

// Personaje paramétrico 3D (G07), portado de `buildPlayerModel` de la maqueta aprobada (.local/mockup/stadium3d.js).
// Avatar estilizado, no un retrato: el aspecto llega asignado a mano (equipos de la demo) o es el genérico idéntico
// para todos; aquí no se sortea nada por nombre ni por hash. Las poses son ilustrativas a partir de las posiciones
// del motor (movimiento sintético, no tracking) y son función pura del fotograma, así que la búsqueda es segura.
//
// Rendimiento: las piezas rígidas se fusionan por material en un `SkinnedMesh` con esqueleto rígido (peso 1 por
// vértice), así que el coste por personaje es una llamada por material (≤ 7 en `standard`, ≤ 6 en `low`) en lugar
// de una por pieza. `buildCharacterGeometries` acepta un desplazamiento de hueso para poder fusionar a todo un
// equipo en una malla por material si el presupuesto global lo exige (ver informe de G07).

/* ------------------------------------------------------------------ apariencia */

/** Las diez peinados de la maqueta (`quiff` ya está en `HairStyle` desde TP194; el alias se conserva). */
export type CharacterHairStyle = HairStyle | 'quiff';
export const HAIR_STYLES: readonly CharacterHairStyle[] = PALETTE_HAIR_STYLES;
export type CharacterAppearance = Omit<AppearanceParams, 'hairStyle'> & Readonly<{ hairStyle: CharacterHairStyle }>;

// Paletas de la maqueta (demo-data.js l.53–54), compartidas con el retrato SVG (G05).
export { HAIR_COLOURS, SKIN_TONES };
const DARK = '#140e0b', GLOVE = '#f2f2f2', DEFAULT_BOOTS = '#111111';

/** Escala de altura: 1 a 183 cm, lineal, acotada a [0,9; 1,1]. Se aplica en `root.scale` (no deforma el rig). */
export function characterScale(heightCm: number | null | undefined): number {
  if (heightCm === null || heightCm === undefined || !Number.isFinite(heightCm)) return 1;
  return Math.min(1.1, Math.max(.9, heightCm / 183));
}

const own = <T extends object>(table: T, key: unknown): key is keyof T => typeof key === 'string' && Object.hasOwn(table, key);
const HEX = HEX_COLOUR;
const mix = mixHex;

/* ------------------------------------------------------------------ rig */

export const BONE_NAMES = ['body', 'spine', 'leftArm', 'leftElbow', 'rightArm', 'rightElbow',
  'leftLeg', 'leftKnee', 'leftAnkle', 'rightLeg', 'rightKnee', 'rightAnkle'] as const;
export type BoneName = typeof BONE_NAMES[number];
type Vec3 = readonly [number, number, number];

const HIP_Y = .91, LEG = .43; // = PLAYER_LEG_LENGTH: la IK de `poses.ts` asume estas longitudes.
const BONE_LABEL: Record<BoneName, string> = {
  body: 'body', spine: 'spine', leftArm: 'left-arm', leftElbow: 'left-elbow', rightArm: 'right-arm', rightElbow: 'right-elbow',
  leftLeg: 'left-leg', leftKnee: 'left-knee', leftAnkle: 'left-ankle', rightLeg: 'right-leg', rightKnee: 'right-knee', rightAnkle: 'right-ankle',
};

/** Jerarquía y posición de reposo de cada articulación (izquierda = −x, como `createPlayerArt`). */
export function characterRig(build: number): Readonly<Record<BoneName, { parent: BoneName | null; offset: Vec3 }>> {
  const b = build;
  return {
    body: { parent: null, offset: [0, 0, 0] },
    spine: { parent: 'body', offset: [0, HIP_Y + .08, 0] },
    leftArm: { parent: 'spine', offset: [-.25 * b, .47, 0] }, leftElbow: { parent: 'leftArm', offset: [0, -.29, 0] },
    rightArm: { parent: 'spine', offset: [.25 * b, .47, 0] }, rightElbow: { parent: 'rightArm', offset: [0, -.29, 0] },
    leftLeg: { parent: 'body', offset: [-.095 * b, HIP_Y, 0] }, leftKnee: { parent: 'leftLeg', offset: [0, -LEG, 0] },
    leftAnkle: { parent: 'leftKnee', offset: [0, -LEG, 0] },
    rightLeg: { parent: 'body', offset: [.095 * b, HIP_Y, 0] }, rightKnee: { parent: 'rightLeg', offset: [0, -LEG, 0] },
    rightAnkle: { parent: 'rightKnee', offset: [0, -LEG, 0] },
  };
}

/* ------------------------------------------------------------------ piezas (puro) */

export type MaterialSlot = 'look' | 'shirt' | 'sleeves' | 'shorts' | 'socks' | 'trim' | 'number';
export type UvRect = Readonly<{ u: number; v: number; w: number; h: number }>;
export type PartShape = Readonly<
  | { kind: 'sphere'; r: number; seg: readonly [number, number]; phi?: readonly [number, number]; theta?: readonly [number, number] }
  | { kind: 'capsule'; r: number; l: number; seg: readonly [number, number] }
  | { kind: 'cylinder'; rt: number; rb: number; h: number; seg: number }
  | { kind: 'box'; w: number; h: number; d: number }
  | { kind: 'torus'; r: number; tube: number; seg: readonly [number, number] }
  | { kind: 'cone'; r: number; h: number; seg: number }
  | { kind: 'plane'; w: number; h: number; uv: UvRect }>;
export type CharacterPart = Readonly<{
  name: string; bone: BoneName; slot: MaterialSlot; shape: PartShape;
  /** Solo en `look` (color por vértice: piel, pelo, barba, ojos, botas, guantes). */
  colour?: string;
  position: Vec3; scale?: Vec3; rotation?: Vec3;
}>;
export type CharacterSpec = Readonly<{
  keeper: boolean; appearance: CharacterAppearance | AppearanceParams; numberUv: UvRect | null; detail: DetailLevel;
}>;

const SEGMENTS = {
  standard: { sphere: [12, 9], small: [8, 6], tiny: [6, 4], curl: [6, 4], cap: [3, 8], cyl: 10 },
  low: { sphere: [8, 6], small: [6, 4], tiny: [5, 3], curl: [5, 3], cap: [2, 6], cyl: 6 },
} as const;

/** Descripción pura de las piezas del personaje: aspecto → geometría, sin tocar three. */
export function characterParts(spec: CharacterSpec): CharacterPart[] {
  const look = spec.appearance, low = spec.detail === 'low', seg = SEGMENTS[spec.detail];
  const b = Number.isFinite(look.build) ? Math.min(1.15, Math.max(.85, look.build)) : 1;
  const skin = own(SKIN_TONES, look.skin) ? SKIN_TONES[look.skin] : SKIN_TONES.s4;
  const hc = own(HAIR_COLOURS, look.hairColour) ? HAIR_COLOURS[look.hairColour] : HAIR_COLOURS.dkbrown;
  const style: CharacterHairStyle = HAIR_STYLES.includes(look.hairStyle) ? look.hairStyle : 'crop';
  const boots = typeof look.boots === 'string' && HEX.test(look.boots) ? look.boots.toLowerCase() : DEFAULT_BOOTS;
  const parts: CharacterPart[] = [];
  const add = (part: CharacterPart) => { parts.push(part); };
  const sphere = (r: number, s: readonly [number, number] = seg.sphere): PartShape => ({ kind: 'sphere', r, seg: s });
  const capsule = (r: number, l: number): PartShape => ({ kind: 'capsule', r, l, seg: seg.cap });
  const cylinder = (rt: number, rb: number, h: number): PartShape => ({ kind: 'cylinder', rt, rb, h, seg: seg.cyl });
  // Cabeza: la maqueta la agrupa en (0, .74, .01) con escala 1,12 sobre la columna.
  const HEAD = 1.12, HEAD_AT: Vec3 = [0, .74, .01];
  const head = (name: string, shape: PartShape, colour: string, position: Vec3, scale: Vec3 = [1, 1, 1], rotation?: Vec3,
    slot: MaterialSlot = 'look') => add({
    name, bone: 'spine', slot, shape, colour: slot === 'look' ? colour : undefined, rotation,
    position: [HEAD_AT[0] + position[0] * HEAD, HEAD_AT[1] + position[1] * HEAD, HEAD_AT[2] + position[2] * HEAD],
    scale: [scale[0] * HEAD, scale[1] * HEAD, scale[2] * HEAD],
  });

  // Tronco y cadera.
  add({ name: 'pelvis', bone: 'body', slot: 'shorts', shape: cylinder(.165, .185, .2), position: [0, HIP_Y + .03, 0], scale: [b, 1, .8 * b] });
  add({ name: 'torso', bone: 'spine', slot: 'shirt', shape: capsule(.175, .27), position: [0, .27, 0], scale: [1.22 * b, 1, .74 * b] });
  if (!low) add({ name: 'collar', bone: 'spine', slot: 'trim', shape: { kind: 'torus', r: .07, tube: .018, seg: [5, 14] },
    position: [0, .55, 0], rotation: [Math.PI / 2, 0, 0] });
  add({ name: 'neck', bone: 'spine', slot: 'look', colour: skin, shape: cylinder(.055, .065, .12), position: [0, .6, 0], scale: [b, 1, b] });
  if (spec.numberUv) {
    add({ name: 'number-back', bone: 'spine', slot: 'number', shape: { kind: 'plane', w: .27, h: .27, uv: spec.numberUv },
      position: [0, .31, -.137 * b], rotation: [0, Math.PI, 0] });
    if (!low) add({ name: 'number-front', bone: 'spine', slot: 'number', shape: { kind: 'plane', w: .1, h: .1, uv: spec.numberUv },
      position: [-.08 * b, .42, .133 * b] });
  }

  // Cabeza (sin rasgos sorteados: mandíbula, cejas y orejas neutras para todos).
  head('skull', sphere(.112), skin, [0, 0, 0], [.92, 1.06, 1]);
  head('jaw', sphere(.085, seg.small), skin, [0, -.055, .025], [1, .82, .95]);
  if (!low) {
    head('nose', { kind: 'cone', r: .018, h: .05, seg: 6 }, skin, [0, -.012, .108], undefined, [Math.PI / 2.3, 0, 0]);
    for (const [side, s] of [['left', -1], ['right', 1]] as const) {
      head(`ear-${side}`, sphere(.026, seg.tiny), skin, [s * .102, -.005, 0], [.6, 1.1, .9]);
      head(`eye-${side}`, sphere(.013, seg.tiny), DARK, [s * .038, .012, .097]);
      head(`brow-${side}`, { kind: 'box', w: .04, h: .011, d: .012 }, hc, [s * .039, .043, .099], undefined, [0, 0, s * .12]);
    }
  }
  if (look.beard === 'light' || look.beard === 'stubble' || look.beard === 'full') {
    const beard = look.beard === 'full' ? hc : mix(hc, skin, look.beard === 'light' ? .38 : .68);
    head('beard', { kind: 'sphere', r: .104, seg: seg.sphere, phi: [.3, Math.PI - .6], theta: [1.6, 1.05] }, beard, [0, -.012, .012], [.97, 1.1, 1.02]);
  }
  hair(style, hc, skin, low, seg, sphere, head);

  // Brazos: hombro en la camiseta, manga, brazo; el portero lleva manga larga y guantes.
  // En `low` las mangas van con la camiseta (≤ 6 mallas): se pierde el color de manga distinto (p. ej. blanco).
  const sleeves: MaterialSlot = low ? 'shirt' : 'sleeves';
  for (const side of ['left', 'right'] as const) {
    const arm = side === 'left' ? 'leftArm' : 'rightArm', elbow = side === 'left' ? 'leftElbow' : 'rightElbow';
    add({ name: `shoulder-${side}`, bone: arm, slot: 'shirt', shape: sphere(.075, seg.small), position: [0, 0, 0], scale: [b, .9 * b, b] });
    add({ name: `sleeve-${side}`, bone: arm, slot: sleeves, shape: capsule(.066 * b, .1), position: [0, -.08, 0] });
    const limb = (slot: MaterialSlot) => spec.keeper ? sleeves : slot;
    add({ name: `upper-arm-${side}`, bone: arm, slot: limb('look'), colour: spec.keeper ? undefined : skin, shape: capsule(.05 * b, .14), position: [0, -.19, 0] });
    add({ name: `forearm-${side}`, bone: elbow, slot: limb('look'), colour: spec.keeper ? undefined : skin, shape: capsule(.045 * b, .17), position: [0, -.12, 0] });
    if (spec.keeper) add({ name: `glove-${side}`, bone: elbow, slot: 'look', colour: GLOVE, shape: sphere(.062, seg.small), position: [0, -.27, 0], scale: [1, 1.2, .8] });
    else add({ name: `hand-${side}`, bone: elbow, slot: 'look', colour: skin, shape: sphere(.047, seg.small), position: [0, -.27, 0] });
  }

  // Piernas: muslo, pernera, media con ribete, bota.
  for (const side of ['left', 'right'] as const) {
    const leg = side === 'left' ? 'leftLeg' : 'rightLeg', knee = side === 'left' ? 'leftKnee' : 'rightKnee';
    const ankle = side === 'left' ? 'leftAnkle' : 'rightAnkle';
    add({ name: `thigh-${side}`, bone: leg, slot: 'look', colour: skin, shape: capsule(.072 * b, .3), position: [0, -.2, 0] });
    add({ name: `shorts-${side}`, bone: leg, slot: 'shorts', shape: capsule(.094 * b, .1), position: [0, -.07, 0] });
    add({ name: `sock-${side}`, bone: knee, slot: 'socks', shape: capsule(.062 * b, .3), position: [0, -.2, 0] });
    if (!low) add({ name: `sock-band-${side}`, bone: knee, slot: 'trim', shape: cylinder(.068, .068, .045), position: [0, -.03, 0], scale: [b, 1, b] });
    add({ name: `boot-${side}`, bone: ankle, slot: 'look', colour: boots, shape: { kind: 'box', w: .1, h: .075, d: .26 }, position: [0, -.0125, .045] });
  }
  return parts;
}

type HeadFn = (name: string, shape: PartShape, colour: string, position: Vec3, scale?: Vec3, rotation?: Vec3, slot?: MaterialSlot) => void;
function hair(style: CharacterHairStyle, hc: string, skin: string, low: boolean, seg: typeof SEGMENTS[DetailLevel],
  sphere: (r: number, s?: readonly [number, number]) => PartShape, head: HeadFn) {
  const colour = style === 'shaved' ? mix(hc, skin, .55) : style === 'buzz' ? mix(hc, skin, .22) : hc;
  const cap = (r: number, tl: number, rx: number) => head('hair-cap',
    { kind: 'sphere', r, seg: seg.sphere, phi: [0, Math.PI * 2], theta: [0, tl] }, colour, [0, .008, -.004], [.95, 1.06, 1.02], [rx, 0, 0]);
  switch (style) {
    case 'shaved': cap(.116, 1.45, -.35); break;
    case 'buzz': cap(.118, 1.5, -.35); break;
    case 'crop': cap(.122, 1.52, -.32); break;
    case 'short': cap(.123, 1.6, -.18); break;
    case 'side': cap(.123, 1.55, -.3); head('hair-side', sphere(.07, seg.small), hc, [.03, .085, .02], [1.35, .55, 1.3]); break;
    case 'slick': cap(.124, 1.5, -.42); head('hair-slick', sphere(.08, seg.small), hc, [0, .085, -.01], [1.15, .62, 1.45]); break;
    case 'quiff': cap(.123, 1.5, -.3); head('hair-quiff', sphere(.07, seg.small), hc, [0, .1, .05], [1.2, .85, 1.05]); break;
    case 'curly': {
      cap(.126, 1.55, -.25);
      const n = low ? 7 : 14;
      for (let i = 0; i < n; i++) {
        const a = i / n * Math.PI * 2, th = i % 2 ? .55 : 1.0;
        head(`hair-curl-${i}`, sphere(.046, seg.curl), hc, [Math.sin(th) * Math.cos(a) * .118, .02 + Math.cos(th) * .118, Math.sin(th) * Math.sin(a) * .118 - .01]);
      }
      head('hair-curl-top', sphere(.046, seg.curl), hc, [0, .135, 0]);
      break;
    }
    case 'tied': cap(.121, 1.55, -.5); head('hair-bun', sphere(.048, seg.small), hc, [0, .075, -.125]); break;
    case 'long':
      cap(.124, 1.6, -.3);
      head('hair-long-back', { kind: 'capsule', r: .1, l: .1, seg: seg.cap }, hc, [0, -.07, -.065], [1.12, 1, .55]);
      for (const s of [-1, 1]) head(`hair-long-${s < 0 ? 'left' : 'right'}`, { kind: 'capsule', r: .03, l: .1, seg: seg.cap }, hc, [s * .1, -.05, -.01]);
      if (!low) head('hair-band', { kind: 'cylinder', rt: .068, rb: .068, h: .045, seg: seg.cyl }, hc, [0, .06, 0], [1.72, .5, 1.72], undefined, 'trim');
      break;
  }
}

/* ------------------------------------------------------------------ geometría */

function shapeGeometry(shape: PartShape): THREE.BufferGeometry {
  switch (shape.kind) {
    case 'sphere': {
      const [phiStart, phiLength] = shape.phi ?? [0, Math.PI * 2], [thetaStart, thetaLength] = shape.theta ?? [0, Math.PI];
      return new THREE.SphereGeometry(shape.r, shape.seg[0], shape.seg[1], phiStart, phiLength, thetaStart, thetaLength);
    }
    case 'capsule': return new THREE.CapsuleGeometry(shape.r, shape.l, shape.seg[0], shape.seg[1]);
    case 'cylinder': return new THREE.CylinderGeometry(shape.rt, shape.rb, shape.h, shape.seg);
    case 'box': return new THREE.BoxGeometry(shape.w, shape.h, shape.d);
    case 'torus': return new THREE.TorusGeometry(shape.r, shape.tube, shape.seg[0], shape.seg[1]);
    case 'cone': return new THREE.ConeGeometry(shape.r, shape.h, shape.seg);
    case 'plane': {
      const geometry = new THREE.PlaneGeometry(shape.w, shape.h), uv = geometry.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) uv.setXY(i, shape.uv.u + uv.getX(i) * shape.uv.w, shape.uv.v + uv.getY(i) * shape.uv.h);
      return geometry;
    }
  }
}

export function restPositions(rig: ReturnType<typeof characterRig>): Record<BoneName, THREE.Vector3> {
  const out = {} as Record<BoneName, THREE.Vector3>;
  for (const name of BONE_NAMES) { // BONE_NAMES está en orden padre → hijo.
    const { parent, offset } = rig[name];
    out[name] = new THREE.Vector3(...offset).add(parent ? out[parent] : new THREE.Vector3());
  }
  return out;
}

/**
 * Geometrías fusionadas por material, en el espacio de `root` en reposo, con `skinIndex` = índice del hueso en
 * `BONE_NAMES` + `boneOffset` (para fusionar varios personajes sobre un esqueleto común) y peso 1.
 */
export function buildCharacterGeometries(parts: readonly CharacterPart[], build: number, boneOffset = 0): Map<MaterialSlot, THREE.BufferGeometry> {
  const rest = restPositions(characterRig(Number.isFinite(build) ? Math.min(1.15, Math.max(.85, build)) : 1));
  const bySlot = new Map<MaterialSlot, THREE.BufferGeometry[]>();
  const matrix = new THREE.Matrix4(), quaternion = new THREE.Quaternion(), euler = new THREE.Euler(), colour = new THREE.Color();
  for (const part of parts) {
    const geometry = shapeGeometry(part.shape);
    euler.set(...(part.rotation ?? [0, 0, 0]));
    matrix.compose(new THREE.Vector3(...part.position).add(rest[part.bone]), quaternion.setFromEuler(euler), new THREE.Vector3(...(part.scale ?? [1, 1, 1])));
    geometry.applyMatrix4(matrix);
    const count = geometry.getAttribute('position').count, bone = BONE_NAMES.indexOf(part.bone) + boneOffset;
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(count * 4).map((_, i) => i % 4 ? 0 : bone), 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Float32Array(count * 4).map((_, i) => i % 4 ? 0 : 1), 4));
    if (part.slot === 'look') {
      colour.setStyle(part.colour ?? DARK, THREE.SRGBColorSpace);
      const colours = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) colours.set([colour.r, colour.g, colour.b], i * 3);
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
    }
    const list = bySlot.get(part.slot) ?? []; list.push(geometry); bySlot.set(part.slot, list);
  }
  const out = new Map<MaterialSlot, THREE.BufferGeometry>();
  for (const [slot, list] of bySlot) {
    const merged = mergeGeometries(list, false);
    for (const geometry of list) geometry.dispose();
    if (!merged) throw new Error(`character: could not merge ${slot}`);
    out.set(slot, merged);
  }
  return out;
}

/* ------------------------------------------------------------------ arte */

export type CharacterArt = PlayerArt & Readonly<{
  spine: THREE.Group; skeleton: THREE.Skeleton; meshes: readonly THREE.SkinnedMesh[];
}>;
export type CharacterInput = Readonly<{
  side: 'home' | 'away'; keeper: boolean; appearance: CharacterAppearance | AppearanceParams;
  /** Materiales del equipo (G06): compartidos, el personaje no los libera. */
  kit: KitMaterials;
  /** Atlas de dorsales del equipo: compartido, el personaje no lo libera. */
  atlas: NumberAtlas | null; number: string | null; detail: DetailLevel;
}>;

/** Presupuesto por personaje: mallas dibujadas (incluida la sombra de contacto) y triángulos, peor caso. */
export const CHARACTER_BUDGET = Object.freeze({
  standard: Object.freeze({ meshes: 8, triangles: 4000 }),
  low: Object.freeze({ meshes: 6, triangles: 1600 }),
});

const PICK_SPHERE = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 1.35); // cubre poses y celebración (brazos arriba)

/** Huesos de un personaje sin mallas visibles (las pone `createCharacterArt` o un lote de equipo, ver `squad.ts`). */
export type CharacterRig = PlayerArt & Readonly<{ spine: THREE.Group; bones: readonly THREE.Group[] }>;

/** Inversas de reposo de los huesos (en `BONE_NAMES`), en el espacio de `root`: el rig en reposo solo tiene traslaciones. */
export function restBoneInverses(build: number): THREE.Matrix4[] {
  const rest = restPositions(characterRig(Number.isFinite(build) ? Math.min(1.15, Math.max(.85, build)) : 1));
  return BONE_NAMES.map(name => new THREE.Matrix4().makeTranslation(-rest[name].x, -rest[name].y, -rest[name].z));
}

/**
 * Esqueleto con selección, volumen de selección (invisible) y, si `contactShadow`, sombra de contacto propia.
 * `extra` libera recursos añadidos después por quien lo use.
 */
export function createCharacterRig(input: Readonly<{ appearance: CharacterAppearance | AppearanceParams; detail: DetailLevel; contactShadow?: boolean }>,
  extra: () => void = () => {}): CharacterRig {
  const build = Number.isFinite(input.appearance.build) ? Math.min(1.15, Math.max(.85, input.appearance.build)) : 1;
  const rig = characterRig(build);
  const root = new THREE.Group(); root.name = 'character';
  root.userData.heightScale = characterScale(input.appearance.heightCm ?? null); // lo aplica quien coloca el personaje
  const bones = {} as Record<BoneName, THREE.Group>;
  for (const name of BONE_NAMES) {
    const bone = new THREE.Group(); bone.name = BONE_LABEL[name]; bone.position.set(...rig[name].offset);
    (rig[name].parent ? bones[rig[name].parent!] : root).add(bone); bones[name] = bone;
  }
  const ownedMaterials: THREE.Material[] = [];
  const helper = (name: string, geometry: THREE.BufferGeometry, mat: THREE.Material, y: number) => {
    const object = new THREE.Mesh(geometry, mat); object.name = name; object.position.y = y; root.add(object); ownedMaterials.push(mat); return object;
  };
  const selection = helper('selection', new THREE.RingGeometry(.65, .82, 24), new THREE.MeshBasicMaterial({ color: 0xffe5a2, side: THREE.DoubleSide }), .035);
  selection.rotation.x = -Math.PI / 2; selection.visible = false;
  helper('pick-volume', new THREE.CylinderGeometry(.65, .65, 2.1, 8), new THREE.MeshBasicMaterial({ visible: false }), 1.05);
  if (input.contactShadow !== false) {
    const contact = helper('contact-shadow', new THREE.CircleGeometry(.32, input.detail === 'low' ? 12 : 20),
      new THREE.MeshBasicMaterial({ color: 0x08180f, transparent: true, opacity: .18, depthWrite: false }), .014);
    contact.rotation.x = -Math.PI / 2; contact.scale.y = .65;
  }
  let disposed = false;
  return {
    root, body: bones.body, spine: bones.spine,
    leftArm: bones.leftArm, rightArm: bones.rightArm, leftLeg: bones.leftLeg, rightLeg: bones.rightLeg,
    leftElbow: bones.leftElbow, rightElbow: bones.rightElbow, leftKnee: bones.leftKnee, rightKnee: bones.rightKnee,
    leftAnkle: bones.leftAnkle, rightAnkle: bones.rightAnkle,
    selection, bones: BONE_NAMES.map(name => bones[name]),
    dispose() {
      if (disposed) return; disposed = true;
      extra();
      root.traverse(object => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
      for (const mat of ownedMaterials) mat.dispose();
      root.removeFromParent(); root.clear();
    },
  };
}

export function createCharacterArt(input: CharacterInput): CharacterArt {
  const numberUv = input.atlas && input.number !== null ? input.atlas.uvFor(input.number) : null;
  const parts = characterParts({ keeper: input.keeper, appearance: input.appearance, numberUv, detail: input.detail });
  const build = Number.isFinite(input.appearance.build) ? Math.min(1.15, Math.max(.85, input.appearance.build)) : 1;
  const ownedMaterials: THREE.Material[] = [];
  let skeleton: THREE.Skeleton | null = null;
  // Las geometrías de las mallas las libera el recorrido del rig; aquí solo materiales propios y el esqueleto.
  const rig = createCharacterRig(input, () => { for (const mat of ownedMaterials) mat.dispose(); skeleton?.dispose(); });
  rig.root.updateMatrixWorld(true);
  // Los huesos son `Group` para cumplir `PlayerArt`; `Skeleton` solo usa su `matrixWorld`.
  skeleton = new THREE.Skeleton(rig.bones as unknown as THREE.Bone[]);

  const lookMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .62, metalness: 0 });
  ownedMaterials.push(lookMaterial);
  let numberMaterial: THREE.Material | null = null;
  const material = (slot: MaterialSlot): THREE.Material => {
    switch (slot) {
      case 'look': return lookMaterial;
      case 'shirt': return input.kit.shirt;
      case 'sleeves': return input.kit.sleeves;
      case 'shorts': return input.kit.shorts;
      case 'socks': return input.kit.socks;
      case 'trim': return input.kit.skinTrim;
      case 'number':
        if (!numberMaterial) {
          numberMaterial = new THREE.MeshStandardMaterial({ map: input.atlas!.texture, alphaTest: .5, roughness: .6, metalness: 0 });
          ownedMaterials.push(numberMaterial);
        }
        return numberMaterial;
    }
  };
  const meshes: THREE.SkinnedMesh[] = [];
  for (const [slot, geometry] of buildCharacterGeometries(parts, build)) {
    const mesh = new THREE.SkinnedMesh(geometry, material(slot));
    mesh.name = `character-${slot}`; mesh.castShadow = slot !== 'number'; mesh.receiveShadow = true;
    mesh.boundingSphere = PICK_SPHERE.clone(); // fijo: evita recalcular con huesos y no recorta poses amplias
    mesh.raycast = () => {}; // la selección usa `pick-volume`, acotado y barato
    rig.root.add(mesh); mesh.bind(skeleton); meshes.push(mesh);
  }
  return { ...rig, skeleton, meshes };
}

/** Coste de dibujo de un personaje: mallas visibles con material visible y sus triángulos. */
export function characterRenderCost(art: Pick<PlayerArt, 'root'>): { meshes: number; triangles: number } {
  let meshes = 0, triangles = 0;
  art.root.traverseVisible(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (!materials.some(m => m.visible)) return;
    const geometry = object.geometry as THREE.BufferGeometry;
    meshes++; triangles += (geometry.index ? geometry.index.count : geometry.getAttribute('position').count) / 3;
  });
  return { meshes, triangles };
}

/* ------------------------------------------------------------------ poses */

export type CharacterStance = PlayerPose['action'] | 'keeper-ready';
export type CharacterPose = PlayerPose & Readonly<{ stance: CharacterStance; speed: number; spineLean: number }>;

function identity(key: string): number {
  let h = 0; for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) >>> 0;
  return h % 1024 / 1024 * 2 * Math.PI;
}

/** Velocidad (m/s) entre los dos fotogramas, con los mismos cortes que `derivePlayerPose`; 0 si hay corte. */
function sourceSpeed(input: PitchRenderInput, key: string): number {
  const player = input.frame.players.find(p => p.key === key), previous = input.previous.players.find(p => p.key === key);
  if (!player || !previous) return 0;
  const distance = Math.hypot(player.x - previous.x, player.y - previous.y), dt = input.frame.clock_ms - input.previous.clock_ms;
  if (input.restarting || input.frame.period !== input.previous.period || !Number.isFinite(dt) || dt <= 0 ||
    !Number.isFinite(distance) || distance >= 3) return 0;
  return distance * 1000 / dt;
}

/**
 * Pose del personaje: la de `derivePlayerPose` (carrera, chut, cabezazo, celebración) más inclinación del tronco
 * según la velocidad, reposo con respiración ligada al reloj del partido y guardia del portero (lento y con el balón
 * a menos de 30 m). Pura: el mismo fotograma da la misma pose aunque se busque hacia atrás.
 */
export function deriveCharacterPose(input: PitchRenderInput, key: string, keeper: boolean): CharacterPose | null {
  const base = derivePlayerPose(input, key);
  if (!base) return null;
  const player = input.frame.players.find(p => p.key === key)!, ball = input.frame.ball;
  const speed = base.action === 'idle' ? 0 : sourceSpeed(input, key), a = Math.min(1, speed / 7);
  const ballValid = !!ball && Number.isFinite(ball.x) && Number.isFinite(ball.y);
  const toBall = ballValid ? Math.atan2(ball!.x - player.x, ball!.y - player.y) : base.facing;
  const ballDistance = ballValid ? Math.hypot(ball!.x - player.x, ball!.y - player.y) : Infinity;
  if (keeper && (base.action === 'idle' || (base.action === 'run' && speed < 1.6)) && ballDistance < 30) {
    return { ...base, stance: 'keeper-ready', speed, facing: toBall, bodyLean: 0, bodyOffsetY: -.14, spineLean: .32,
      limbs: { leftArm: { x: -.55, z: -.55, bend: -.55 }, rightArm: { x: -.55, z: .55, bend: -.55 },
        leftLeg: { x: -.5, z: -.26, bend: .95 }, rightLeg: { x: -.5, z: .26, bend: .95 } } };
  }
  if (base.action === 'idle') {
    const breath = Math.sin(input.frame.clock_ms / 1000 * 2 + identity(key)) * .012;
    return { ...base, stance: 'idle', speed: 0, facing: toBall, spineLean: .04 + breath,
      limbs: { leftArm: { x: .05, z: -.12, bend: -.25 }, rightArm: { x: .05, z: .12, bend: -.25 },
        leftLeg: { x: 0, z: -.045, bend: .04 }, rightLeg: { x: 0, z: .045, bend: .04 } } };
  }
  return { ...base, stance: base.action, speed, spineLean: base.action === 'run' ? .06 + .2 * a : 0 };
}

export function applyCharacterPose(art: PlayerArt & Readonly<{ spine: THREE.Group }>, pose: CharacterPose): void {
  applyPlayerPose(art, pose);
  art.spine.rotation.set(pose.spineLean, 0, 0);
}
