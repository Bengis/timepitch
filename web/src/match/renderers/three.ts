import * as THREE from 'three';
import { GENERIC_APPEARANCE, type AppearanceParams, type KitSpec, type MatchKits } from '../../presentation/types';
import { ballHeight, ballVelocity, cameraShot, framingFor, isMassReposition,walkoutShot } from './camera';
import { applyCharacterPose, characterParts, createCharacterRig, deriveCharacterPose, type CharacterRig } from './character';
import { createKitMaterials, createNumberAtlas, type KitMaterials, type NumberAtlas } from './kit-texture';
import { createLighting } from './lighting';
import { createFrameTimeMonitor, QUALITY_TIERS } from './quality';
import { createSquadArt, type SquadArt } from './squad';
import { createStadiumArt, type StadiumArt } from './stadium';
import { createBallArt } from './three-art';
import { createSkeletonPlayers, GESTURE_MS } from './skeleton-players';
import { HAIR_COLOURS, SKIN_TONES } from '../../presentation/avatar/palette';
import type { DetailLevel, PitchProjection, PitchRenderInput, RendererFactory, Viewport } from './types';

// Renderizador 3D «stylized-3d-1», con el aspecto de retransmisión aprobado (maqueta .local/mockup/replay.html,
// 22-oct): estadio e iluminación (G08), personaje paramétrico (G07) dibujado por lotes de equipo, equipaciones y dorsales
// (G06) desde `input.cast`. Sin `cast`, colores por lado y avatar genérico. Solo consume `SceneFrame`: no avanza ningún
// motor ni modifica posiciones; las raíces de jugador y balón quedan en las coordenadas de la fuente. Las poses y el
// rodar del balón son ilustrativos (movimiento sintético), deterministas por fotograma y seguros al buscar.

const BALL_RADIUS = .11;
/** Escala visual de los personajes (1 = tamaño real, como la maqueta); la altura del cast la matiza (±10 %). */
export const CHARACTER_VISUAL_SCALE = 1.15;
const MAX_CONTACTS = 64;
type KitSlot = keyof Omit<MatchKits, 'choice'>;
const KIT_SLOTS: readonly KitSlot[] = ['home', 'away', 'homeKeeper', 'awayKeeper'];

const sideKit = (shirt: string, shorts: string): KitSpec => ({ shirt, sleeves: { left: shirt, right: shirt }, shorts, socks: shirt,
  trim: '#f4f2e9', number: '#ffffff', collar: 'unknown', pattern: { body: 'plain', sleeves: 'plain', shorts: 'plain', socks: 'plain' },
  source: { kind: 'generic', licence: 'n/a', note: 'Colores por lado: sin equipación registrada' } });
/** Sin `cast`: los colores por lado de siempre (no es la equipación del club). */
export const SIDE_KITS: Readonly<Record<KitSlot, KitSpec>> = Object.freeze({
  home: sideKit('#d96f58', '#eee9da'), away: sideKit('#68acd0', '#263b55'),
  homeKeeper: sideKit('#d8b438', '#eee9da'), awayKeeper: sideKit('#6ab88b', '#263b55'),
});

type Budget = { calls: number; triangles: number; textures: number };
const NO_BUDGET: Readonly<Budget> = Object.freeze({ calls: 0, triangles: 0, textures: 0 });
// Cada instancia guarda su propio coste; el módulo solo apunta a la última que dibujó, y su `dispose` lo limpia.
let latest: { owner: object; budget: Budget } | null = null;
/** Coste del último fotograma dibujado (`renderer.info`, incluye pasadas de sombra) para las pruebas de rendimiento (G19). */
export function renderBudget(): Budget { return { ...(latest?.budget ?? NO_BUDGET) }; }

// Firmas por identidad: el mismo objeto del cast no se vuelve a serializar en cada fotograma.
const signatures = new WeakMap<object, string>();
function signatureOf(value: object): string {
  let text = signatures.get(value);
  if (text === undefined) { text = JSON.stringify(value); signatures.set(value, text); }
  return text;
}

const validPoint = (p: { x: number; y: number } | null | undefined): p is { x: number; y: number } =>
  !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
const emptyProjection = (viewport: Viewport): PitchProjection => ({ viewport: { ...viewport }, projectFieldPoint: () => null });
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

type Kit = { signature: string; materials: KitMaterials; atlas: NumberAtlas | null; spec: KitSpec };
type Player = { rig: CharacterRig; signature: string; slot: KitSlot; keeper: boolean; appearance: AppearanceParams; number: string | null };
type Squad = { signature: string; art: SquadArt };

export const createThreeRenderer: RendererFactory = (canvas, initial, onFailure) => {
  let device: THREE.WebGLRenderer;
  try { device = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' }); }
  catch (error) { onFailure('initialization'); throw error; }
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(40, 1, .5, 900);
  let current = initial, viewport: Viewport = { width: canvas.clientWidth || 384, height: canvas.clientHeight || 256 };
  let disposed = false, pixelRatio = 1, detail: DetailLevel | null = null;
  let stadium: StadiumArt | null = null;
  const lighting = createLighting(scene, device), monitor = createFrameTimeMonitor();
  const kits = new Map<KitSlot, Kit>(), players = new Map<string, Player>(), squads = new Map<KitSlot, Squad>();
  const raycaster = new THREE.Raycaster();
  const ballArt = createBallArt(BALL_RADIUS), ball = ballArt.root, ballShadow = ball.getObjectByName('ball-contact') as THREE.Mesh;
  const ballShadowMaterial = ballShadow.material as THREE.MeshBasicMaterial, ballShadowOpacity = ballShadowMaterial.opacity;
  // Sombras de contacto de todos los jugadores en una sola llamada.
  const contacts = new THREE.InstancedMesh(new THREE.CircleGeometry(.32, 16).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x08180f, transparent: true, opacity: .2, depthWrite: false }), MAX_CONTACTS);
  contacts.name = 'contact-shadows'; contacts.frustumCulled = false; contacts.count = 0; scene.add(contacts);
  const contactMatrix = new THREE.Matrix4(), contactScale = new THREE.Vector3(), contactAt = new THREE.Vector3(), noRotation = new THREE.Quaternion();
  canvas.dataset.renderer = 'stylized-3d-1';
  // TP244: jugadores con esqueleto animado de serie. Mientras cargan los modelos (o si fallan) se ven los muñecos
  // paramétricos; en las pruebas (sin red ni WebGL real) se quedan estos.
  const skeletons = import.meta.env.MODE !== 'test' ? createSkeletonPlayers(scene) : null;
  /** Foco suavizado del plano de televisión de los esqueletos (se reinicia en cortes y saltos). */
  let teleFocus: { x: number; y: number } | null = null;
  const budgetOwner = {};

  function setDetail(next: DetailLevel) {
    if (detail === next) return;
    detail = next;
    stadium?.dispose(); stadium = createStadiumArt(next); scene.add(stadium.root);
    const maxAnisotropy = device.capabilities?.getMaxAnisotropy?.() ?? 1;
    stadium.setAnisotropy(Math.min(maxAnisotropy, next === 'low' ? 2 : 8));
    applyPixelRatio();
    canvas.dataset.quality = monitor.dropped ? 'auto-low' : next;
  }
  function applyPixelRatio() {
    const tier = QUALITY_TIERS[detail ?? 'standard'];
    device.setPixelRatio(Math.min(pixelRatio, tier.maxPixelRatio));
    device.setSize(viewport.width, viewport.height, false);
  }
  function kitFor(slot: KitSlot, input: PitchRenderInput, needsNumbers: boolean): Kit {
    const spec = input.cast?.kits?.[slot] ?? SIDE_KITS[slot];
    const signature = `${detail}|${signatureOf(spec)}`;
    let kit = kits.get(slot);
    if (!kit || kit.signature !== signature) {
      kit?.materials.dispose(); kit?.atlas?.dispose();
      kit = { signature, spec, materials: createKitMaterials(spec, detail!), atlas: null }; kits.set(slot, kit);
    }
    if (needsNumbers && !kit.atlas) kit.atlas = createNumberAtlas(spec.number, spec.trim);
    return kit;
  }
  function syncPlayers(input: PitchRenderInput) {
    const active = new Set(input.frame.players.filter(validPoint).map(player => player.key));
    for (const [key, player] of players) if (!active.has(key)) { player.rig.dispose(); players.delete(key); }
    for (const source of input.frame.players) {
      if (!validPoint(source)) continue;
      const keeper = source.role === 'GK', slot: KitSlot = source.side === 'home' ? (keeper ? 'homeKeeper' : 'home') : (keeper ? 'awayKeeper' : 'away');
      const entry = input.cast?.players?.get(source.key) ?? null;
      // Sin registro: avatar genérico y sin dorsal; nunca el aspecto ni el número de otro jugador.
      const appearance = entry?.appearance ?? GENERIC_APPEARANCE, number = entry?.number ?? null;
      const signature = `${slot}|${detail}|${number}|${signatureOf(appearance)}`;
      let player = players.get(source.key);
      if (!player || player.signature !== signature) {
        player?.rig.dispose();
        const rig = createCharacterRig({ appearance, detail: detail!, contactShadow: false });
        rig.root.name = `player:${source.key}`; rig.root.userData.playerKey = source.key;
        rig.root.scale.setScalar(CHARACTER_VISUAL_SCALE * rig.root.userData.heightScale);
        scene.add(rig.root);
        player = { rig, signature, slot, keeper, appearance, number }; players.set(source.key, player);
      }
    }
  }
  function syncSquads(input: PitchRenderInput) {
    const members = new Map<KitSlot, [string, Player][]>(KIT_SLOTS.map(slot => [slot, []]));
    for (const entry of [...players.entries()].sort(([a], [b]) => a.localeCompare(b))) members.get(entry[1].slot)!.push(entry);
    for (const slot of KIT_SLOTS) {
      const list = members.get(slot)!;
      if (!list.length) { squads.get(slot)?.art.dispose(); squads.delete(slot); kits.get(slot)?.materials.dispose(); kits.get(slot)?.atlas?.dispose(); kits.delete(slot); continue; }
      const kit = kitFor(slot, input, list.some(([, p]) => p.number !== null));
      const signature = `${kit.signature}#${list.map(([key, p]) => `${key}=${p.signature}`).join(';')}`;
      const squad = squads.get(slot);
      if (squad?.signature === signature) continue;
      squad?.art.dispose();
      const art = createSquadArt(`squad-${slot}`, list.map(([, p]) => ({ rig: p.rig, build: p.appearance.build,
        parts: characterParts({ keeper: p.keeper, appearance: p.appearance, detail: detail!,
          numberUv: p.number !== null && kit.atlas ? kit.atlas.uvFor(p.number) : null }) })), kit.materials, kit.atlas);
      scene.add(art.root); squads.set(slot, { signature, art });
    }
  }

  function projection(): PitchProjection {
    const matrix = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const size = { ...viewport };
    return { viewport: size, projectFieldPoint(x, y) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      const clip = new THREE.Vector4(x, 0, y, 1).applyMatrix4(matrix);
      if (clip.w <= 0) return null;
      const nx = clip.x / clip.w, ny = clip.y / clip.w, nz = clip.z / clip.w;
      if (Math.abs(nx) > 1 || Math.abs(ny) > 1 || Math.abs(nz) > 1) return null;
      return { x: (nx + 1) * size.width / 2, y: (1 - ny) * size.height / 2 };
    } };
  }
  function update(input: PitchRenderInput): PitchProjection {
    if (disposed) return emptyProjection(viewport);
    const started = now();
    current = input;
    setDetail(monitor.dropped ? 'low' : input.detail);
    lighting.apply(input.appearance, detail!);
    // Recolocación masiva (saque, reanudación): corte de realización, sin carrera ni barrido de cámara.
    const cut = input.restarting || isMassReposition(input.previous, input.frame);
    const poseInput = cut && !input.restarting ? { ...input, restarting: true } : input;
    syncPlayers(input); syncSquads(input);
    let shadows = 0;
    for (const source of input.frame.players) {
      const player = validPoint(source) ? players.get(source.key) : undefined;
      if (!player) continue;
      const root = player.rig.root;
      root.position.set(source.x, 0, source.y); player.rig.selection.visible = source.key === input.selectedPlayerKey;
      const pose = deriveCharacterPose(poseInput, source.key, player.keeper);
      if (pose) applyCharacterPose(player.rig, pose);
      if (shadows < MAX_CONTACTS) {
        contactMatrix.compose(contactAt.set(source.x, .014, source.y), noRotation, contactScale.set(root.scale.x, 1, root.scale.x * .65));
        contacts.setMatrixAt(shadows++, contactMatrix);
      }
    }
    contacts.count = shadows; contacts.instanceMatrix.needsUpdate = true;
    if (skeletons?.ready) {
      // Con los modelos cargados se ocultan los muñecos paramétricos (siguen sirviendo para elegir jugador).
      for (const squad of squads.values()) squad.art.root.visible = false;
      skeletons.update(poseInput, key => {
        const player = players.get(key); if (!player) return null;
        const kit = kitFor(player.slot, input, false).spec, look = player.appearance;
        return { shirt: kit.shirt, sleeves: kit.sleeves.left, shorts: kit.shorts, socks: kit.socks, numberColour: kit.number,
          skin: SKIN_TONES[look.skin] ?? SKIN_TONES.s4, hair: HAIR_COLOURS[look.hairColour] ?? HAIR_COLOURS.dkbrown, boots: look.boots,
          number: player.number, keeper: player.keeper, hairStyle: look.hairStyle, beard: look.beard,
          height: look.heightCm ? look.heightCm / 183 : 1, build: look.build };
      });
      canvas.dataset.players = 'skeleton';
    }
    const velocity = cut ? { x: 0, y: 0 } : ballVelocity(input.frame, input.previous);
    if (validPoint(input.frame.ball)) {
      const height = ballHeight(input.frame.ball);
      ball.position.set(input.frame.ball.x, BALL_RADIUS + height, input.frame.ball.y);
      // Rodar ilustrativo derivado de la posición (seguro al buscar); la altura solo si la fuente la trae.
      ballArt.surface.rotation.set(input.frame.ball.y / BALL_RADIUS, 0, -input.frame.ball.x / BALL_RADIUS);
      ballShadow.position.y = -BALL_RADIUS + .018 - height;
      ballShadow.scale.setScalar(1 + height * .35);
      ballShadowMaterial.opacity = ballShadowOpacity * Math.max(.25, Math.min(1, 1 - height / 6));
      scene.add(ball);
    } else ball.removeFromParent();
    configureCamera(input, velocity);
    scene.updateMatrixWorld(true); device.render(scene, camera);
    const info = device.info;
    if (info?.render) latest = { owner: budgetOwner, budget: { calls: info.render.calls, triangles: info.render.triangles, textures: info.memory?.textures ?? 0 } };
    // Coste real del fotograma (sincronizar, posar, enviar a la GPU), no la cadencia de publicación de la app.
    const finished = now();
    if (monitor.sample(finished, finished - started)) { setDetail('low'); canvas.dataset.quality = 'auto-low'; }
    return projection();
  }
  function configureCamera(input: PitchRenderInput, velocity: { x: number; y: number }) {
    const framing = framingFor(input);
    if(input.presentation==='walkout'&&framing!=='tactical'){
      const shot=walkoutShot(input.frame,camera.aspect);
      camera.fov=shot.fov;camera.position.set(...shot.position);camera.lookAt(...shot.target);
      camera.updateProjectionMatrix();camera.updateMatrixWorld(true);canvas.dataset.framing='broadcast';return;
    }
    const selected = input.frame.players.find(player => player.key === input.selectedPlayerKey && validPoint(player));
    let focus = { x: 52.5, y: 34 };
    if (framing !== 'tactical') {
      if (validPoint(input.fieldFocus)) focus = input.fieldFocus;
      else if (selected) focus = selected;
      else if (validPoint(input.frame.ball)) {
        // Anticipa el juego 0,3 s, como la realización de la maqueta; acotado para no mirar fuera del campo.
        const lead = (v: number) => Math.max(-15, Math.min(15, v)) * .3;
        focus = { x: Math.max(6, Math.min(99, input.frame.ball.x + lead(velocity.x))), y: Math.max(0, Math.min(68, input.frame.ball.y + lead(velocity.y))) };
      }
    }
    let shotFraming: Parameters<typeof cameraShot>[0] = framing;
    if (skeletons?.ready && framing === 'broadcast' && input.presentation !== 'walkout') {
      // TP244: con esqueletos, plano de televisión (`tele`) que sigue el juego con suavidad; tras un gol, primer plano del
      // goleador mientras lo celebra.
      const cue = input.cue, age = cue ? input.frame.clock_ms - cue.t1_ms : -1;
      const scorer = cue?.type === 'goal' && age >= 0 && age < GESTURE_MS.celebrate
        ? input.frame.players.find(player => player.key === cue.participants[0] && validPoint(player)) : undefined;
      if (scorer) focus = scorer;
      shotFraming = scorer ? 'near' : 'tele';
      const dt = (input.frame.clock_ms - input.previous.clock_ms) / 1000;
      if (!teleFocus || input.restarting || dt <= 0 || dt > .5 || Math.hypot(focus.x - teleFocus.x, focus.y - teleFocus.y) > 25) teleFocus = { ...focus };
      else { const k = 1 - Math.exp(-dt * 4); teleFocus = { x: teleFocus.x + (focus.x - teleFocus.x) * k, y: teleFocus.y + (focus.y - teleFocus.y) * k }; }
      focus = teleFocus;
    }
    const shot = cameraShot(shotFraming, focus, camera.aspect, Math.hypot(velocity.x, velocity.y));
    camera.fov = shot.fov; camera.position.set(...shot.position); camera.lookAt(...shot.target);
    camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
    canvas.dataset.framing = framing;
  }
  function dispose() {
    if (disposed) return; disposed = true;
    if (latest?.owner === budgetOwner) latest = null;
    canvas.removeEventListener('webglcontextlost', contextLost);
    skeletons?.dispose();
    for (const squad of squads.values()) squad.art.dispose(); squads.clear();
    for (const player of players.values()) player.rig.dispose(); players.clear();
    for (const kit of kits.values()) { kit.materials.dispose(); kit.atlas?.dispose(); } kits.clear();
    stadium?.dispose(); stadium = null; ballArt.dispose();
    contacts.geometry.dispose(); (contacts.material as THREE.Material).dispose(); contacts.dispose();
    lighting.dispose(); scene.clear(); device.dispose();
    if (!device.getContext().isContextLost()) device.forceContextLoss();
  }
  function contextLost(event: Event) {
    event.preventDefault(); if (disposed) return;
    dispose(); onFailure('context_lost');
  }
  canvas.addEventListener('webglcontextlost', contextLost);
  function resize(size: Viewport, dpr: number) {
    if (disposed || !Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0 || size.height <= 0) return;
    viewport = { width: size.width, height: size.height }; camera.aspect = size.width / size.height;
    pixelRatio = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
    if (detail) applyPixelRatio();
    update(current);
  }
  try { resize(viewport, 1); }
  catch (error) { dispose(); onFailure('initialization'); throw error; }
  return { update, resize, dispose, pickPlayer(point) {
    if (disposed || !validPoint(point) || point.x < 0 || point.y < 0 || point.x > viewport.width || point.y > viewport.height) return null;
    raycaster.setFromCamera(new THREE.Vector2(point.x / viewport.width * 2 - 1, 1 - point.y / viewport.height * 2), camera);
    const roots = [...players.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, player]) => player.rig.root);
    for (const hit of raycaster.intersectObjects(roots, true)) {
      let object: THREE.Object3D | null = hit.object;
      while (object) { if (typeof object.userData.playerKey === 'string') return object.userData.playerKey; object = object.parent; }
    }
    return null;
  } };
};
