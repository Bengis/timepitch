import * as THREE from 'three';

// G09: el campo y el estadio son `stadium.ts` y los jugadores, `character.ts` + `squad.ts`. Aquí quedan el balón y el
// esqueleto de referencia `PlayerArt` (con su arte simple), que `poses.ts` y sus pruebas siguen usando.
export const PLAYER_VISUAL_SCALE = 1.35;
export const PLAYER_LEG_LENGTH = .43;

export type PlayerArt = {
  root: THREE.Group; body: THREE.Group;
  leftArm: THREE.Group; rightArm: THREE.Group; leftLeg: THREE.Group; rightLeg: THREE.Group;
  leftElbow: THREE.Group; rightElbow: THREE.Group; leftKnee: THREE.Group; rightKnee: THREE.Group;
  leftAnkle: THREE.Group; rightAnkle: THREE.Group;
  selection: THREE.Mesh; dispose(): void;
};

// Each art instance owns its resources. Meshes may share them within that instance.
function ownedArt(root: THREE.Group) {
  let disposed = false;
  return { root, dispose() {
    if (disposed) return; disposed = true;
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
    root.traverse(object => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
        geometries.add(object.geometry);
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
      }
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) {
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
      material.dispose();
    }
    for (const texture of textures) texture.dispose();
    root.removeFromParent(); root.clear();
  } };
}

function mesh(parent: THREE.Object3D, name: string, geometry: THREE.BufferGeometry, material: THREE.Material,
  x: number, y: number, z: number) {
  const object = new THREE.Mesh(geometry, material); object.name = name; object.position.set(x, y, z);
  object.castShadow = true; object.receiveShadow = true; parent.add(object); return object;
}

export function createPlayerArt(side: 'home' | 'away', keeper: boolean): PlayerArt {
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const kit = new THREE.MeshStandardMaterial({ color: keeper ? (side === 'home' ? 0xd8b438 : 0x6ab88b) : (side === 'home' ? 0xd96f58 : 0x68acd0), roughness: .85 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc99a77, roughness: 1 });
  const shorts = new THREE.MeshStandardMaterial({ color: side === 'home' ? 0xeee9da : 0x263b55, roughness: 1 });
  const boots = new THREE.MeshStandardMaterial({ color: 0x1f2730, roughness: 1 });
  const trim = new THREE.MeshStandardMaterial({ color: 0xf4f2e9, roughness: .85 });
  const hair = new THREE.MeshStandardMaterial({ color: 0x302a25, roughness: 1 });
  const sphere = new THREE.SphereGeometry(1, 12, 8);
  function rounded(parent: THREE.Object3D, name: string, material: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number) {
    const part = mesh(parent, name, sphere, material, x, y, z); part.scale.set(sx, sy, sz); return part;
  }
  const torso = mesh(body, 'torso', new THREE.CylinderGeometry(.27, .21, .54, 12), kit, 0, 1.28, 0); torso.scale.z = .64;
  rounded(body, 'shoulders', kit, 0, 1.49, 0, .32, .13, .18);
  rounded(body, 'shorts', shorts, 0, .99, 0, .25, .18, .18);
  mesh(body, 'neck', new THREE.CylinderGeometry(.075, .085, .13, 10), skin, 0, 1.64, 0);
  rounded(body, 'head', skin, 0, 1.83, .01, .16, .21, .165);
  rounded(body, 'hair', hair, 0, 1.945, -.02, .162, .105, .16);
  const collar = mesh(body, 'collar', new THREE.TorusGeometry(.09, .02, 6, 16), trim, 0, 1.59, 0); collar.rotation.x = Math.PI / 2;
  function limb(name: string, x: number, y: number, arm: boolean) {
    const joint = new THREE.Group(); joint.name = name; joint.position.set(x, y, 0); body.add(joint);
    const upperLength = arm ? .27 : PLAYER_LEG_LENGTH, lowerLength = arm ? .25 : PLAYER_LEG_LENGTH;
    const radius = arm ? .075 : .105;
    mesh(joint, `${name}-segment`, new THREE.CapsuleGeometry(radius, upperLength - radius * 2, 3, 10), arm ? skin : shorts, 0, -upperLength / 2, 0);
    if (arm) mesh(joint, 'sleeve', new THREE.CapsuleGeometry(.095, .075, 3, 10), kit, 0, -.055, 0);
    const distal = new THREE.Group(); distal.name = name.replace(arm ? 'arm' : 'leg', arm ? 'elbow' : 'knee'); distal.position.y = -upperLength; joint.add(distal);
    const ankle = new THREE.Group(); ankle.name = name.replace('leg', 'ankle'); ankle.position.y = -lowerLength;
    mesh(distal, `${name}-lower`, new THREE.CapsuleGeometry(radius * .85, lowerLength - radius * 1.7, 3, 10), arm ? skin : kit, 0, -lowerLength / 2, 0);
    if (arm) rounded(distal, 'hand', skin, 0, -lowerLength, 0, .06, .085, .055);
    else {
      distal.add(ankle);
      rounded(ankle, 'boot', boots, 0, .015, .06, .105, .065, .18);
      const sock = mesh(distal, 'sock-cuff', new THREE.CylinderGeometry(.095, .095, .035, 10), trim, 0, -.09, 0); sock.castShadow = false;
    }
    return { joint, distal, ankle };
  }
  const la = limb('left-arm', -.31, 1.48, true), ra = limb('right-arm', .31, 1.48, true);
  const ll = limb('left-leg', -.13, .91, false), rl = limb('right-leg', .13, .91, false);
  const selection = mesh(root, 'selection', new THREE.RingGeometry(.65, .82, 24),
    new THREE.MeshBasicMaterial({ color: 0xffe5a2, side: THREE.DoubleSide }), 0, .035, 0);
  selection.rotation.x = -Math.PI / 2; selection.visible = false; selection.castShadow = false;
  // An undrawn, bounded hit volume keeps feet selectable at overview scale.
  const hit = mesh(root, 'pick-volume', new THREE.CylinderGeometry(.65, .65, 2.1, 8), new THREE.MeshBasicMaterial({ visible: false }), 0, 1.05, 0);
  hit.castShadow = false; hit.receiveShadow = false;
  const contact = mesh(root, 'contact-shadow', new THREE.CircleGeometry(.32, 20),
    new THREE.MeshBasicMaterial({ color: 0x08180f, transparent: true, opacity: .18, depthWrite: false }), 0, .014, 0);
  contact.rotation.x = -Math.PI / 2; contact.scale.y = .65; contact.castShadow = false;
  return { ...ownedArt(root), body, leftArm: la.joint, rightArm: ra.joint, leftLeg: ll.joint, rightLeg: rl.joint,
    leftElbow: la.distal, rightElbow: ra.distal, leftKnee: ll.distal, rightKnee: rl.distal,
    leftAnkle: ll.ankle, rightAnkle: rl.ankle, selection };
}

export function createBallArt(radius: number) {
  const root = new THREE.Group(); root.name = 'ball';
  const geometry = new THREE.IcosahedronGeometry(radius, 3), positions = geometry.getAttribute('position');
  const directions = new THREE.IcosahedronGeometry(1, 0), corners: THREE.Vector3[] = [];
  for (let i = 0; i < directions.getAttribute('position').count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(directions.getAttribute('position'), i).normalize();
    if (!corners.some(p => p.distanceToSquared(v) < 1e-6)) corners.push(v);
  }
  directions.dispose();
  const colors: number[] = [], normal = new THREE.Vector3();
  for (let i = 0; i < positions.count; i++) {
    normal.fromBufferAttribute(positions, i).normalize();
    const patch = Math.max(...corners.map(p => p.dot(normal))) > .946;
    const color = new THREE.Color(patch ? 0x17212b : 0xf8faf6); colors.push(color.r, color.g, color.b);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const surface = mesh(root, 'ball-surface', geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .72 }), 0, 0, 0);
  const shadow = mesh(root, 'ball-contact', new THREE.CircleGeometry(radius * 1.3, 24),
    new THREE.MeshBasicMaterial({ color: 0x06120b, transparent: true, opacity: .3, depthWrite: false }), 0, -radius + .018, 0);
  shadow.rotation.x = -Math.PI / 2; shadow.castShadow = false;
  return { ...ownedArt(root), surface };
}
