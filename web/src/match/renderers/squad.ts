import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BONE_NAMES, buildCharacterGeometries, restBoneInverses, type CharacterPart, type CharacterRig, type MaterialSlot } from './character';
import type { KitMaterials, NumberAtlas } from './kit-texture';

// Lote de equipo (G09): todos los personajes que comparten equipación se dibujan con una malla por material sobre un
// esqueleto común (12 huesos por jugador). Así 22 jugadores cuestan ≈ 4 × 7 llamadas en vez de 22 × 7, dentro del
// presupuesto del spec §7 (≤ 160 / ≤ 70). Cada jugador conserva su propio rig (`CharacterRig`) para poses y selección.

export type SquadMember = Readonly<{ rig: CharacterRig; parts: readonly CharacterPart[]; build: number }>;
export type SquadArt = Readonly<{ root: THREE.Group; meshes: readonly THREE.SkinnedMesh[]; skeleton: THREE.Skeleton; dispose(): void }>;

export function createSquadArt(name: string, members: readonly SquadMember[], kit: KitMaterials, atlas: NumberAtlas | null): SquadArt {
  const root = new THREE.Group(); root.name = name;
  const bones: THREE.Object3D[] = [], inverses: THREE.Matrix4[] = [];
  const bySlot = new Map<MaterialSlot, THREE.BufferGeometry[]>();
  members.forEach((member, index) => {
    bones.push(...member.rig.bones); inverses.push(...restBoneInverses(member.build));
    for (const [slot, geometry] of buildCharacterGeometries(member.parts, member.build, index * BONE_NAMES.length)) {
      const list = bySlot.get(slot) ?? []; list.push(geometry); bySlot.set(slot, list);
    }
  });
  // Huesos `Group` (como `PlayerArt`); `Skeleton` solo usa su `matrixWorld`, que incluye la raíz del jugador.
  const skeleton = new THREE.Skeleton(bones as THREE.Bone[], inverses);
  const owned: THREE.Material[] = [];
  const look = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .62, metalness: 0 }); owned.push(look);
  let number: THREE.Material | null = null;
  const material = (slot: MaterialSlot): THREE.Material => {
    switch (slot) {
      case 'look': return look;
      case 'shirt': return kit.shirt;
      case 'sleeves': return kit.sleeves;
      case 'shorts': return kit.shorts;
      case 'socks': return kit.socks;
      case 'trim': return kit.skinTrim;
      case 'number':
        if (!number) { number = new THREE.MeshStandardMaterial({ map: atlas!.texture, alphaTest: .5, roughness: .6, metalness: 0 }); owned.push(number); }
        return number;
    }
  };
  const meshes: THREE.SkinnedMesh[] = [];
  for (const [slot, list] of bySlot) {
    const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
    if (list.length > 1) for (const geometry of list) geometry.dispose();
    if (!merged) throw new Error(`squad: could not merge ${slot}`);
    const mesh = new THREE.SkinnedMesh(merged, material(slot));
    mesh.name = `${name}-${slot}`; mesh.castShadow = slot !== 'number'; mesh.receiveShadow = true;
    mesh.frustumCulled = false; // repartido por el campo; el esqueleto mueve los vértices fuera de la caja de reposo
    mesh.raycast = () => {}; // la selección usa el `pick-volume` de cada rig
    mesh.bind(skeleton, new THREE.Matrix4());
    root.add(mesh); meshes.push(mesh);
  }
  let disposed = false;
  return { root, meshes, skeleton, dispose() {
    if (disposed) return; disposed = true;
    for (const mesh of meshes) mesh.geometry.dispose();
    for (const mat of owned) mat.dispose(); // nunca los materiales del equipo ni el atlas
    skeleton.dispose(); root.removeFromParent(); root.clear();
  } };
}
