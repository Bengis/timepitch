import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Beard, HairStyle } from '../../presentation/types';
import type { PitchRenderInput } from './types';

// TP244 («que se muevan como en FIFA»): jugadores con esqueleto. El cuerpo, los ojos, las cejas, tres peinados
// y la barba salen de Universal Base Characters (Quaternius, CC0; `public/assets/players/player.glb`), y las animaciones
// capturadas de Universal Animation Library (mismo autor y licencia; `animations.glb`, 7 clips, solo giros de hueso y
// posición de la pelvis): los dos comparten esqueleto. La zancada se elige y mezcla por la velocidad que da el motor
// (quieto → andar → trotar → esprintar). La biblioteca gratuita no trae chut, cabezazo ni estirada, así que esos gestos
// se hacen girando huesos sobre la pose capturada; los ejes se midieron sobre el esqueleto en reposo (muslo y pantorrilla:
// +X lleva el pie atrás; brazo: +X lo adelanta, −Z sube el derecho y +Z el izquierdo; columna y cuello: +X inclina
// adelante). Los gestos salen del reloj del fotograma y del aviso de jugada; zancada y giro conservan continuidad entre
// dibujos nuevos, sin avanzar al redibujar el mismo instante. Un corte reinicia esa continuidad, sin prometer la misma
// pose desde cualquier historial de búsqueda. Movimiento ilustrativo: las posiciones son las de la fuente.

export const PLAYER_URL = '/assets/players/player.glb';
export const ANIMATIONS_URL = '/assets/players/animations.glb';
const HEIGHT_M = 1.83 * 1.12, BODY_HEIGHT_M = 1.81;
/** Altura de la pelvis en reposo: maniquí de las animaciones y cuerpo del jugador. */
const PELVIS_SCALE = .949 / .917;
/**
 * Zancadas: velocidad (m/s) a la que cada clip queda «puro» y metros que avanza por ciclo, medidos en la versión con
 * desplazamiento de la biblioteca (`UAL1_Standard_RM.glb`). Entre dos se mezclan, y el ciclo avanza según la distancia
 * recorrida, para que los pies no patinen.
 */
const GAITS: readonly (readonly [clip: string, speed: number, stride: number])[] = [['Idle_Loop', 0, 1.3], ['Walk_Loop', .97, 1.3],
  ['Jog_Fwd_Loop', 5.36, 5], ['Sprint_Loop', 8.25, 5.5]];
const GAIT_CLIPS = new Set(GAITS.slice(1).map(([clip]) => clip));
/** Talla del cuerpo dibujado frente al actor de la captura (1,83 m): sus zancadas crecen en la misma proporción. */
const STRIDE_SCALE = 1.83 * 1.12 / 1.83;
/** Duración de cada gesto desde el aviso de jugada. */
export const GESTURE_MS = { kick: 460, header: 520, dive: 1300, catch: 700, slide: 900, celebrate: 4200, airplane: 2200 } as const;
/** Giro máximo del cuerpo (rad/s) cuando no hay corte. */
const TURN_RATE = 9;
const HAIR_MESH: Readonly<Record<HairStyle, string | null>> = { buzz: 'Hair_Buzzed', crop: 'Hair_Buzzed', shaved: null,
  short: 'Hair_SimpleParted', side: 'Hair_SimpleParted', slick: 'Hair_SimpleParted', quiff: 'Hair_SimpleParted', curly: 'Hair_SimpleParted',
  long: 'Hair_Long', tied: 'Hair_Long' };
const HAIR_MESHES = ['Hair_Buzzed', 'Hair_SimpleParted', 'Hair_Long'];
const BONES = ['thigh_l', 'thigh_r', 'calf_l', 'calf_r', 'upperarm_l', 'upperarm_r', 'lowerarm_l', 'lowerarm_r', 'spine_01', 'spine_03', 'neck_01'] as const;
type BoneName = typeof BONES[number];
const AXIS_X = new THREE.Vector3(1, 0, 0), AXIS_Z = new THREE.Vector3(0, 0, 1), AXIS_Y = new THREE.Vector3(0, 1, 0);

/** Equipación y aspecto de un jugador (colores CSS `#rrggbb`; dorsal `null` = sin número). */
export type SkeletonLook = Readonly<{ shirt: string; sleeves: string; shorts: string; socks: string; numberColour: string;
  skin: string; hair: string; boots: string; number: string | null; keeper: boolean; hairStyle: HairStyle; beard: Beard;
  /** Estatura relativa (1 = 1,83 m) y complexión (1 = media), de la ficha del jugador. */
  height: number; build: number }>;
type Body = { root: THREE.Object3D; mixer: THREE.AnimationMixer; actions: Map<string, THREE.AnimationAction>;
  bones: Map<BoneName, THREE.Object3D>; clean: Map<THREE.Object3D, THREE.Quaternion>; kit: Kit; look: string; facing: number; phase: number;
  /** Fase del ciclo de zancada (0–1), velocidad y giro del fotograma anterior (inclinaciones). */
  stride: number; speed: number; turn: number; motionSpeed: number;
  /** Último dibujo del actor: separado de previous, que puede repetirse al pausar o interpolar. */
  drawn: { clock: number; x: number; y: number; period: number; presentation: PitchRenderInput['presentation']; restarting: boolean } | null };

/** Gesto de un jugador en este fotograma, derivado del aviso de jugada (puro: sirve para probarlo sin WebGL). */
export type Gesture =
  | { kind: 'run' }
  | { kind: 'kick'; t: number; foot: 'left' | 'right'; power: number }
  | { kind: 'header'; t: number }
  | { kind: 'dive'; t: number; side: 1 | -1 }
  | { kind: 'catch'; t: number }
  | { kind: 'slide'; t: number }
  | { kind: 'ready' }
  | { kind: 'airplane'; t: number }
  | { kind: 'cheer'; t: number }
  | { kind: 'dejected'; t: number };

type GesturePlayer = Readonly<{ key: string; side: 'home' | 'away'; x: number; y: number }>;
export function gestureFor(input: PitchRenderInput, player: GesturePlayer, keeper: boolean, facing: number, speed: number): Gesture {
  const cue = input.cue, age = cue ? input.frame.clock_ms - cue.t1_ms : -1, actor = cue?.participants[0];
  // La celebración sigue aunque el motor recoloque a todos para el saque de centro; los demás gestos no cruzan un corte.
  if (cue && age >= 0 && cue.type === 'goal' && age < GESTURE_MS.celebrate) {
    const t = age / GESTURE_MS.celebrate;
    if (actor === player.key) return age < GESTURE_MS.airplane ? { kind: 'airplane', t: age / GESTURE_MS.airplane } : { kind: 'cheer', t };
    return cue.side === player.side ? { kind: 'cheer', t } : { kind: 'dejected', t };
  }
  if (cue && age >= 0 && !input.restarting) {
    if ((cue.type === 'pass' || cue.type === 'shot') && actor === player.key) {
      if (cue.bodyPart === 'head' && age < GESTURE_MS.header) return { kind: 'header', t: age / GESTURE_MS.header };
      if (cue.bodyPart !== 'head' && age < GESTURE_MS.kick)
        return { kind: 'kick', t: age / GESTURE_MS.kick, foot: cue.bodyPart === 'left_foot' ? 'left' : 'right', power: cue.type === 'shot' ? 1.2 : .85 };
    }
    if (cue.type === 'tackle' && actor === player.key && age < GESTURE_MS.slide) return { kind: 'slide', t: age / GESTURE_MS.slide };
    if (cue.type === 'save' && actor === player.key) {
      const ball = cue.at ?? input.frame.ball;
      // Lado del balón respecto al portero (+X local = cos f, −sin f en el campo): lejos del cuerpo, estirada; cerca, blocaje.
      const lateral = ball ? (ball.x - player.x) * Math.cos(facing) - (ball.y - player.y) * Math.sin(facing) : 0;
      if (Math.abs(lateral) > .8 && age < GESTURE_MS.dive) return { kind: 'dive', t: age / GESTURE_MS.dive, side: lateral > 0 ? 1 : -1 };
      if (age < GESTURE_MS.catch) return { kind: 'catch', t: age / GESTURE_MS.catch };
    }
  }
  return keeper && speed < 2 ? { kind: 'ready' } : { kind: 'run' };
}

export type SkeletonPlayers = {
  readonly ready: boolean;
  update(input: PitchRenderInput, lookOf: (key: string) => SkeletonLook | null): void;
  dispose(): void;
};

/** Solo los giros de cada hueso y la posición de la pelvis (escalada a la del cuerpo): sin estirar huesos ajenos. */
function retarget(clip: THREE.AnimationClip): THREE.AnimationClip {
  const tracks = clip.tracks.flatMap(track => {
    if (track.name.endsWith('.quaternion')) return [track];
    if (track.name === 'pelvis.position') { const copy = track.clone(); copy.values = copy.values.map(v => v * PELVIS_SCALE); return [copy]; }
    return [];
  });
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

const smooth = (a: number, b: number, t: number) => { const x = Math.max(0, Math.min(1, (t - a) / (b - a))); return x * x * (3 - 2 * x); };
/** Interpola por tramos: `keys` = [t, valor] ordenados por t, con suavizado en cada tramo. */
function curve(t: number, keys: readonly (readonly [number, number])[]): number {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) if (t <= keys[i][0]) return keys[i - 1][1] + (keys[i][1] - keys[i - 1][1]) * smooth(keys[i - 1][0], keys[i][0], t);
  return keys[keys.length - 1][1];
}
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export function createSkeletonPlayers(scene: THREE.Scene): SkeletonPlayers {
  let template: { scene: THREE.Object3D; clips: THREE.AnimationClip[]; scale: number; skinMap: THREE.Texture | null; hairMap: THREE.Texture | null } | null = null;
  let disposed = false;
  const bodies = new Map<string, Body>(), loader = new GLTFLoader(), turn = new THREE.Quaternion(), yaw = new THREE.Quaternion(), roll = new THREE.Quaternion(), tilt = new THREE.Quaternion();
  Promise.all([loader.loadAsync(PLAYER_URL), loader.loadAsync(ANIMATIONS_URL)]).then(([player, animations]) => {
    if (disposed) return;
    let skinMap: THREE.Texture | null = null, hairMap: THREE.Texture | null = null;
    player.scene.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const material = mesh.material as THREE.MeshStandardMaterial;
      if (material.name === 'M_Body') skinMap = material.map;
      if (material.name === 'M_Hair') hairMap = material.map;
    });
    template = { scene: player.scene, clips: animations.animations.map(retarget), scale: HEIGHT_M / BODY_HEIGHT_M, skinMap, hairMap };
  }).catch(() => { /* sin modelo: el renderizador sigue con los muñecos paramétricos */ });

  function create(key: string): Body {
    const root = cloneSkinned(template!.scene);
    root.scale.setScalar(template!.scale); root.name = `skeleton:${key}`;
    const kit = createKit(template!.skinMap, template!.hairMap);
    root.traverse(o => {
      const mesh = o as THREE.SkinnedMesh;
      if (!mesh.isMesh) return;
      mesh.frustumCulled = false; mesh.castShadow = true;
      const name = (mesh.material as THREE.Material).name;
      if (name === 'M_Body') mesh.material = kit.body;
      else if (name === 'M_Hair') mesh.material = kit.hair;
    });
    kit.meshes = new Map([...HAIR_MESHES, 'Hair_Beard'].map(name => [name, root.getObjectByName(name) ?? null]));
    const mixer = new THREE.AnimationMixer(root), actions = new Map<string, THREE.AnimationAction>();
    for (const clip of template!.clips) { const action = mixer.clipAction(clip); action.play(); action.setEffectiveWeight(0); actions.set(clip.name, action); }
    const bones = new Map<BoneName, THREE.Object3D>();
    for (const name of BONES) { const bone = root.getObjectByName(name); if (bone) bones.set(name, bone); }
    let hash = 0; for (let i = 0; i < key.length; i++) hash = (Math.imul(hash, 31) + key.charCodeAt(i)) >>> 0;
    scene.add(root);
    const phase = (hash % 1000) / 1000;
    return { root, mixer, actions, bones, clean: new Map(), kit, look: '', facing: Number.NaN, phase, stride: phase,
      speed: 0, turn: 0, motionSpeed: 0, drawn: null };
  }

  /** Ciclos de zancada por segundo a una velocidad: la distancia por ciclo se interpola entre los clips vecinos. */
  function cadence(speed: number): number {
    let stride = GAITS[GAITS.length - 1][2];
    for (let i = 0; i < GAITS.length - 1; i++) {
      const [, sa, la] = GAITS[i], [, sb, lb] = GAITS[i + 1];
      if (speed <= sb) { stride = la + (lb - la) * Math.max(0, (speed - sa) / (sb - sa)); break; }
    }
    return speed / (stride * STRIDE_SCALE);
  }

  /** Pesos de zancada para una velocidad: los dos clips vecinos, en proporción. */
  function gaitWeights(speed: number): Map<string, number> {
    const w = new Map<string, number>();
    if (speed >= GAITS[GAITS.length - 1][1]) { w.set(GAITS[GAITS.length - 1][0], 1); return w; }
    for (let i = 0; i < GAITS.length - 1; i++) {
      const [a, sa] = GAITS[i], [b, sb] = GAITS[i + 1];
      if (speed <= sb) { const t = Math.max(0, (speed - sa) / (sb - sa)); w.set(a, 1 - t); w.set(b, t); return w; }
    }
    return w;
  }

  /** Gira un hueso sobre su propio eje (después de la pose capturada), guardando antes la pose limpia. */
  function bend(body: Body, name: BoneName, axis: THREE.Vector3, angle: number) {
    const bone = body.bones.get(name);
    if (!angle || !bone) return;
    if (!body.clean.has(bone)) body.clean.set(bone, bone.quaternion.clone());
    bone.quaternion.multiply(turn.setFromAxisAngle(axis, angle));
  }
  /** Brazos: `raise` sube hacia el lado (0 = colgando, ~1,3 = en cruz, ~2,6 = arriba); `forward` los adelanta. */
  function arms(body: Body, left: number, right: number, forward = 0) {
    bend(body, 'upperarm_l', AXIS_Z, left); bend(body, 'upperarm_r', AXIS_Z, -right);
    bend(body, 'upperarm_l', AXIS_X, forward); bend(body, 'upperarm_r', AXIS_X, forward);
  }

  /** Pesos de clip según el gesto; la zancada manda salvo en los gestos parados. */
  function weightsFor(gesture: Gesture, speed: number): Map<string, number> {
    switch (gesture.kind) {
      case 'kick': case 'catch': case 'dive': case 'dejected': case 'slide': return new Map([['Idle_Loop', 1]]);
      case 'header': return new Map([['Jump_Loop', 1]]);
      case 'cheer': return speed > 2.5 ? gaitWeights(speed) : new Map([['Jump_Loop', 1]]);
      case 'ready': { const w = gaitWeights(speed); const crouch = Math.max(0, 1 - speed / 2) * .6;
        for (const [k, v] of w) w.set(k, v * (1 - crouch)); w.set('Crouch_Idle_Loop', crouch); return w; }
      default: return gaitWeights(speed);
    }
  }

  /**
   * Gestos hechos a mano sobre la pose capturada. Devuelve la elevación, la inclinación lateral (`roll`, + lleva la
   * cabeza a −X) y hacia atrás (`pitch`, − la echa atrás) del cuerpo, y su desplazamiento lateral y hacia delante.
   */
  function pose(body: Body, gesture: Gesture, clockS: number): { lift: number; roll: number; shift: number; pitch?: number; advance?: number } {
    switch (gesture.kind) {
      case 'run': {
        // Inclinación hacia delante con la velocidad y la aceleración, y hacia dentro en las curvas (como un corredor).
        bend(body, 'spine_01', AXIS_X, Math.min(.2, .14 * body.speed / 8));
        return { lift: 0, roll: Math.max(-.35, Math.min(.35, -Math.atan(body.turn * body.speed / 9.8))), shift: 0 };
      }
      case 'slide': {
        // Entrada deslizando: se echa atrás, estira la pierna derecha hacia el balón, dobla la otra y se apoya en las manos.
        const down = curve(gesture.t, [[0, 0], [.22, 1], [.75, 1], [1, 0]]);
        bend(body, 'thigh_r', AXIS_X, -.35 * down); bend(body, 'thigh_l', AXIS_X, .2 * down); bend(body, 'calf_l', AXIS_X, 1.5 * down);
        arms(body, .5 * down, .5 * down, -.7 * down);
        return { lift: .05 * down, roll: 0, shift: 0, pitch: -1.3 * down, advance: 1.4 * curve(gesture.t, [[0, 0], [.7, 1], [1, 1]]) };
      }
      case 'kick': {
        // Armado (pie atrás, rodilla doblada), golpeo (el muslo barre adelante y la pierna se estira) y acompañamiento.
        const { t, power } = gesture, side = gesture.foot === 'left' ? 'l' : 'r';
        bend(body, `thigh_${side}`, AXIS_X, curve(t, [[0, 0], [.28, .65], [.5, -1.05 * power], [.68, -1.2 * power], [1, 0]]));
        bend(body, `calf_${side}`, AXIS_X, curve(t, [[0, 0], [.28, 1.55], [.48, .1], [1, 0]]));
        // El brazo contrario se abre para equilibrar y el tronco se echa algo atrás al golpear.
        const balance = curve(t, [[0, 0], [.3, 1], [.7, 1], [1, 0]]);
        if (side === 'r') arms(body, 1.1 * balance, .25 * balance); else arms(body, .25 * balance, 1.1 * balance);
        bend(body, 'spine_01', AXIS_X, -.18 * balance * power);
        return { lift: 0, roll: 0, shift: 0 };
      }
      case 'header': {
        const { t } = gesture;
        bend(body, 'neck_01', AXIS_X, curve(t, [[0, -.35], [.45, -.45], [.6, .55], [1, 0]]));
        bend(body, 'spine_01', AXIS_X, curve(t, [[0, -.15], [.45, -.2], [.6, .3], [1, 0]]));
        arms(body, .7, .7, .35);
        return { lift: .55 * Math.sin(Math.PI * Math.min(1, t / .85)), roll: 0, shift: 0 };
      }
      case 'dive': {
        // Impulso, vuelo con los brazos estirados hacia el balón, caída de costado y se queda en el suelo un momento.
        const { t, side } = gesture, flight = curve(t, [[0, 0], [.32, 1], [1, 1]]);
        arms(body, 2.5 * flight, 2.5 * flight);
        bend(body, 'spine_01', AXIS_Z, -.25 * side * flight);
        bend(body, 'thigh_l', AXIS_X, -.25 * flight); bend(body, 'thigh_r', AXIS_X, .15 * flight);
        const lift = t < .55 ? .55 * Math.sin(Math.PI * t / .55) + .12 * flight : .12;
        return { lift, roll: -side * 1.35 * flight, shift: side * .9 * flight };
      }
      case 'catch': {
        const grab = curve(gesture.t, [[0, 0], [.3, 1], [.8, 1], [1, .6]]);
        arms(body, 0, 0, 1.25 * grab); bend(body, 'lowerarm_l', AXIS_X, .6 * grab); bend(body, 'lowerarm_r', AXIS_X, .6 * grab);
        bend(body, 'spine_01', AXIS_X, .3 * grab);
        return { lift: 0, roll: 0, shift: 0 };
      }
      case 'ready':
        // Portero atento: brazos algo abiertos y adelantados.
        arms(body, .45, .45, .35);
        return { lift: 0, roll: 0, shift: 0 };
      case 'airplane': {
        // El goleador corre con los brazos en cruz, balanceándose.
        const open = curve(gesture.t, [[0, 0], [.15, 1], [1, 1]]);
        arms(body, 1.3 * open, 1.3 * open);
        return { lift: 0, roll: .22 * open * Math.sin(clockS * 2.4), shift: 0 };
      }
      case 'cheer': {
        // Puños arriba, al ritmo del salto.
        const pump = .25 * Math.sin(clockS * 9 + body.phase * 6);
        arms(body, 2.4 + pump, 2.4 - pump);
        bend(body, 'lowerarm_l', AXIS_X, .5); bend(body, 'lowerarm_r', AXIS_X, .5);
        return { lift: 0, roll: 0, shift: 0 };
      }
      case 'dejected': {
        const down = curve(gesture.t, [[0, 0], [.2, 1], [1, 1]]);
        bend(body, 'neck_01', AXIS_X, .55 * down); bend(body, 'spine_01', AXIS_X, .3 * down);
        return { lift: 0, roll: 0, shift: 0 };
      }
      default: return { lift: 0, roll: 0, shift: 0 };
    }
  }

  return {
    get ready() { return !!template && !disposed; },
    update(input, lookOf) {
      if (!template || disposed) return;
      const seen = new Set<string>(), clockS = input.frame.clock_ms / 1000;
      const walkout = input.presentation === 'walkout';
      const ball = input.frame.ball && Number.isFinite(input.frame.ball.x) && Number.isFinite(input.frame.ball.y) ? input.frame.ball : null;
      for (const p of input.frame.players) {
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
        const look = lookOf(p.key); if (!look) continue;
        seen.add(p.key);
        let body = bodies.get(p.key);
        if (!body) { body = create(p.key); bodies.set(p.key, body); }
        const signature = JSON.stringify(look);
        if (body.look !== signature) { body.kit.dress(look); body.look = signature; }
        const prev = body.drawn, dt = prev ? (input.frame.clock_ms - prev.clock) / 1000 : 0;
        const dx = prev ? p.x - prev.x : 0, dy = prev ? p.y - prev.y : 0, dist = Math.hypot(dx, dy);
        const redraw = !!prev && dt === 0 && dist === 0 && prev.period === input.frame.period
          && prev.presentation === input.presentation && prev.restarting === input.restarting;
        if (!redraw) {
          const cut = input.restarting || !prev || dt <= 0 || dt > .5 || dist >= 3
            || prev.period !== input.frame.period || prev.presentation !== input.presentation;
          const speed = cut ? 0 : dist / dt;
          // En presentación mira el camino incluso despacio y al formar mira la banda de cámara (+y del campo).
          // En partido, corriendo mira adonde va; despacio o parado conserva la atención al balón.
          let target = walkout ? 0 : p.side === 'home' ? Math.PI / 2 : -Math.PI / 2;
          if (walkout ? dist > .0001 && !cut : speed > 1.2) target = Math.atan2(dx, dy);
          else if (!walkout && ball && Math.hypot(ball.x - p.x, ball.y - p.y) > .3) target = Math.atan2(ball.x - p.x, ball.y - p.y);
          const before = Number.isFinite(body.facing) ? body.facing : target;
          if (cut || walkout || !Number.isFinite(body.facing)) body.facing = target;
          else { const delta = wrapAngle(target - body.facing), step = TURN_RATE * dt; body.facing = wrapAngle(body.facing + Math.max(-step, Math.min(step, delta))); }
          // Suavizado por tiempo nuevo (los factores previos .3/.4 correspondían al paso habitual de 100 ms).
          body.turn = cut ? 0 : body.turn + (wrapAngle(body.facing - before) / dt - body.turn) * (1 - Math.pow(.7, dt / .1));
          body.speed = cut ? 0 : body.speed + (speed - body.speed) * (1 - Math.pow(.6, dt / .1));
          body.stride = cut ? body.phase : (body.stride + (walkout ? dist / (GAITS[1][2] * STRIDE_SCALE) : cadence(speed) * dt)) % 1;
          body.motionSpeed = speed;
          body.drawn = { clock: input.frame.clock_ms, x: p.x, y: p.y, period: input.frame.period,
            presentation: input.presentation, restarting: input.restarting };
        }
        const speed = body.motionSpeed;
        const gesture: Gesture = walkout ? { kind: 'run' } : gestureFor(input, p, look.keeper, body.facing, speed);
        const weights = walkout ? new Map([[speed > .001 ? 'Walk_Loop' : 'Idle_Loop', 1]]) : weightsFor(gesture, speed);
        for (const [name, action] of body.actions) {
          action.setEffectiveWeight(weights.get(name) ?? 0);
          const clip = action.getClip();
          action.time = GAIT_CLIPS.has(name) ? body.stride * clip.duration
            : ((clockS + body.phase * clip.duration) % clip.duration + clip.duration) % clip.duration;
        }
        // El mezclador solo reescribe un hueso si su valor cambia: sin restaurar, los gestos se acumularían en pausa.
        for (const [bone, quaternion] of body.clean) bone.quaternion.copy(quaternion);
        body.clean.clear();
        body.mixer.update(0);
        const { lift, roll: lean, shift, pitch = 0, advance = 0 } = walkout
          ? { lift: 0, roll: 0, shift: 0 } : pose(body, gesture, clockS);
        // Desplazamiento lateral (estirada) en el eje +X local del cuerpo, (cos f, −sin f) en el campo, y hacia delante
        // (entrada) en su +Z local, (sin f, cos f).
        const f = body.facing;
        body.root.position.set(p.x + Math.cos(f) * shift + Math.sin(f) * advance, lift, p.y - Math.sin(f) * shift + Math.cos(f) * advance);
        body.root.quaternion.copy(yaw.setFromAxisAngle(AXIS_Y, f)).multiply(roll.setFromAxisAngle(AXIS_Z, lean)).multiply(tilt.setFromAxisAngle(AXIS_X, pitch));
        const tall = template.scale * Math.max(.9, Math.min(1.1, look.height)), wide = Math.max(.9, Math.min(1.12, 1 + (look.build - 1) * .6));
        body.root.scale.set(tall * wide, tall, tall * wide);
      }
      for (const [key, body] of bodies) if (!seen.has(key)) { scene.remove(body.root); body.mixer.stopAllAction(); body.kit.dispose(); bodies.delete(key); }
    },
    dispose() {
      disposed = true;
      for (const body of bodies.values()) { scene.remove(body.root); body.mixer.stopAllAction(); body.kit.dispose(); }
      bodies.clear();
    },
  };
}

// Equipación pintada por zonas sobre la pose de reposo del cuerpo (en T, Y arriba, de frente a +Z, 1,81 m): la altura y
// la distancia al eje dicen si un punto es bota, media, rodilla, pantalón, camiseta, manga o piel, y el dorsal se dibuja
// en la espalda con siete segmentos. La piel conserva la textura del modelo (cara, manos) llevada al tono del jugador; la
// tela toma un poco de su relieve. Todos los jugadores comparten el programa; cada uno lleva sus colores.
type Kit = { body: THREE.MeshStandardMaterial; hair: THREE.MeshStandardMaterial; meshes: Map<string, THREE.Object3D | null>;
  dress(look: SkeletonLook): void; dispose(): void };
const COLOURS = ['uShirt', 'uSleeves', 'uShorts', 'uSocks', 'uNumberColour', 'uBoots', 'uSkinRatio'] as const;
/** Tono medio de la piel de la textura (sRGB 168, 118, 82): referencia para llevarla al tono de cada jugador. */
const TEXTURE_SKIN = new THREE.Color(168 / 255, 118 / 255, 82 / 255);
const TEXTURE_LUMA = .2126 * TEXTURE_SKIN.r + .7152 * TEXTURE_SKIN.g + .0722 * TEXTURE_SKIN.b;
const KIT_GLSL = /* glsl */`
varying vec3 vBind;
uniform vec3 uShirt, uSleeves, uShorts, uSocks, uNumberColour, uBoots, uSkinRatio;
uniform float uDigits, uTens, uUnits, uKeeper, uTextureLuma;
float tpSegment(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0., 1.)); }
float tpDigit(vec2 p, float d) {
  int m = d < .5 ? 63 : d < 1.5 ? 6 : d < 2.5 ? 91 : d < 3.5 ? 79 : d < 4.5 ? 102 : d < 5.5 ? 109 : d < 6.5 ? 125 : d < 7.5 ? 7 : d < 8.5 ? 127 : 111;
  float e = 9.;
  if ((m & 1) != 0) e = min(e, tpSegment(p, vec2(-1, 1), vec2(1, 1)));
  if ((m & 2) != 0) e = min(e, tpSegment(p, vec2(1, 1), vec2(1, 0)));
  if ((m & 4) != 0) e = min(e, tpSegment(p, vec2(1, 0), vec2(1, -1)));
  if ((m & 8) != 0) e = min(e, tpSegment(p, vec2(-1, -1), vec2(1, -1)));
  if ((m & 16) != 0) e = min(e, tpSegment(p, vec2(-1, -1), vec2(-1, 0)));
  if ((m & 32) != 0) e = min(e, tpSegment(p, vec2(-1, 0), vec2(-1, 1)));
  if ((m & 64) != 0) e = min(e, tpSegment(p, vec2(-1, 0), vec2(1, 0)));
  return step(e, .3);
}
// Devuelve el color de la tela, o -1 si el punto es piel.
vec3 tpKit(vec3 b) {
  float ax = abs(b.x), y = b.y;
  if (y < .11) return uBoots;
  if (y < .48) return uSocks;
  if (y < .68) return vec3(-1);
  if (y < 1.02) return uShorts;
  if (ax > .21 && y > 1.28 && y < 1.6) {
    // Brazo en T: manga corta hasta antes del codo; el portero, manga larga y guantes.
    if (uKeeper > .5) return ax > .72 ? vec3(.93) : uSleeves;
    return ax < .42 ? uSleeves : vec3(-1);
  }
  if (y < 1.56) {
    if (uDigits > 0. && b.z < -.05 && y > 1.15 && y < 1.42 && ax < .13) {
      // Visto desde detrás, la derecha del espectador es -X.
      vec2 q = vec2(-b.x, y - 1.285), s = vec2(.032, .06);
      float ink = uDigits > 1.5 ? max(tpDigit((q - vec2(-.047, 0)) / s, uTens), tpDigit((q - vec2(.047, 0)) / s, uUnits)) : tpDigit(q / s, uUnits);
      if (ink > .5) return uNumberColour;
    }
    return uShirt;
  }
  return vec3(-1);
}
`;
const KIT_MAP_FRAGMENT = /* glsl */`
#ifdef USE_MAP
  vec4 tpTexel = texture2D( map, vMapUv );
#else
  vec4 tpTexel = vec4( 1. );
#endif
  vec3 tpCloth = tpKit( vBind );
  float tpRelief = mix( 1., dot( tpTexel.rgb, vec3( .2126, .7152, .0722 ) ) / uTextureLuma, .3 );
  diffuseColor.rgb *= tpCloth.r < 0. ? tpTexel.rgb * uSkinRatio : tpCloth * clamp( tpRelief, .75, 1.15 );
`;

function createKit(skinMap: THREE.Texture | null, hairMap: THREE.Texture | null): Kit {
  const uniforms: Record<string, THREE.IUniform> = { uDigits: { value: 0 }, uTens: { value: 0 }, uUnits: { value: 0 }, uKeeper: { value: 0 },
    uTextureLuma: { value: TEXTURE_LUMA } };
  for (const name of COLOURS) uniforms[name] = { value: new THREE.Color() };
  const body = new THREE.MeshStandardMaterial({ map: skinMap, roughness: .72, metalness: 0 });
  body.customProgramCacheKey = () => 'tp-skeleton-kit-2';
  body.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = 'varying vec3 vBind;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vBind = position;');
    shader.fragmentShader = KIT_GLSL + shader.fragmentShader.replace('#include <map_fragment>', KIT_MAP_FRAGMENT);
  };
  // El pelo de la textura es gris: el color del jugador lo tiñe.
  const hair = new THREE.MeshStandardMaterial({ map: hairMap, roughness: .85, metalness: 0, side: THREE.DoubleSide });
  const kit: Kit = { body, hair, meshes: new Map(), dress(look) {
    const set = (name: typeof COLOURS[number], css: string) => (uniforms[name].value as THREE.Color).set(css);
    set('uShirt', look.shirt); set('uSleeves', look.sleeves); set('uShorts', look.shorts); set('uSocks', look.socks);
    set('uNumberColour', look.numberColour); set('uBoots', look.boots);
    const skin = new THREE.Color(look.skin);
    (uniforms.uSkinRatio.value as THREE.Color).setRGB(skin.r / TEXTURE_SKIN.r, skin.g / TEXTURE_SKIN.g, skin.b / TEXTURE_SKIN.b);
    hair.color.set(look.hair).multiplyScalar(1.6);
    const digits = look.number && /^\d{1,2}$/.test(look.number) ? look.number : '';
    uniforms.uDigits.value = digits.length;
    uniforms.uTens.value = digits.length === 2 ? Number(digits[0]) : 0;
    uniforms.uUnits.value = digits ? Number(digits[digits.length - 1]) : 0;
    uniforms.uKeeper.value = look.keeper ? 1 : 0;
    const style = look.hairStyle in HAIR_MESH ? HAIR_MESH[look.hairStyle] : 'Hair_Buzzed';
    for (const name of HAIR_MESHES) { const mesh = kit.meshes.get(name); if (mesh) mesh.visible = name === style; }
    const beard = kit.meshes.get('Hair_Beard'); if (beard) beard.visible = look.beard === 'full';
  }, dispose() { body.dispose(); hair.dispose(); } };
  return kit;
}
