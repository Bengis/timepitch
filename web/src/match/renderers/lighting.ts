import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { QUALITY_TIERS } from './quality';
import type { Appearance, DetailLevel } from './types';

// Iluminación de retransmisión portada de la maqueta aprobada (`.local/mockup/stadium3d.js`, luces y tono):
// cielo + luz principal con la única sombra + contraluz + relleno, tone mapping ACES, niebla y entorno
// RoomEnvironment solo en `standard`. Coordenadas del campo de la app: x 0..105, z 0..68.

const CENTRE = new THREE.Vector3(52.5, 0, 34);

type Look = Readonly<{
  background: string; fog: string; fogDensity: number; exposure: number; environmentIntensity: number;
  sky: string; ground: string; hemisphere: number;
  key: string; keyIntensity: number; keyPosition: readonly [number, number, number];
  rim: string; rimIntensity: number; fill: string; fillIntensity: number;
}>;

const LOOKS: Readonly<Record<Appearance, Look>> = {
  // Valores de la maqueta (noche con focos).
  floodlights: { background: '#070b14', fog: '#0b1424', fogDensity: .0052, exposure: .95, environmentIntensity: .28,
    sky: '#d4e2ff', ground: '#21391b', hemisphere: .75, key: '#fff3e2', keyIntensity: 2.1, keyPosition: [-38, 70, 34],
    rim: '#e6efff', rimIntensity: 1, fill: '#cfdcff', fillIntensity: .55 },
  // Tarde de día: cielo claro, sol cálido más alto y menos contraluz.
  daylight: { background: '#8fb2d6', fog: '#a7c0da', fogDensity: .0032, exposure: 1, environmentIntensity: .45,
    sky: '#e9f1ff', ground: '#34502a', hemisphere: 1.05, key: '#fff0d4', keyIntensity: 2.6, keyPosition: [-30, 85, 40],
    rim: '#f1f5ff', rimIntensity: .55, fill: '#dbe6ff', fillIntensity: .4 },
};

export type Lighting = Readonly<{ apply(appearance: Appearance, detail: DetailLevel): void; dispose(): void }>;

export function createLighting(scene: THREE.Scene, device: THREE.WebGLRenderer): Lighting {
  const rig = new THREE.Group(); rig.name = 'lighting'; scene.add(rig);
  const hemisphere = new THREE.HemisphereLight(); hemisphere.name = 'sky-light';
  const aim = (light: THREE.DirectionalLight, name: string) => {
    light.name = name; light.target.position.copy(CENTRE); rig.add(light, light.target); return light;
  };
  const key = aim(new THREE.DirectionalLight(), 'key-light');
  const rim = aim(new THREE.DirectionalLight(), 'rim-light'); rim.position.set(CENTRE.x + 42, 64, CENTRE.z - 30);
  const fill = aim(new THREE.DirectionalLight(), 'fill-light'); fill.position.set(CENTRE.x, 25, CENTRE.z + 80);
  rig.add(hemisphere);
  // Una sola sombra (spec §7). Cubre campo, porterías, banderines y vallas LED.
  key.castShadow = true;
  Object.assign(key.shadow.camera, { left: -72, right: 72, top: 56, bottom: -56, near: 20, far: 220 });
  key.shadow.camera.updateProjectionMatrix();
  key.shadow.bias = -.0005; key.shadow.normalBias = .03;

  let pmrem: THREE.PMREMGenerator | null = null, environment: THREE.Texture | null = null, environmentFailed = false;
  const fog = new THREE.FogExp2(0x000000, 0), background = new THREE.Color();
  let disposed = false;

  function environmentMap(): THREE.Texture | null {
    if (environment || environmentFailed) return environment;
    try {
      pmrem = new THREE.PMREMGenerator(device);
      const room = new RoomEnvironment();
      try { environment = pmrem.fromScene(room, .04).texture; } finally { room.dispose(); }
    } catch {
      // Sin contexto WebGL completo (pruebas, contexto degradado): el entorno es un extra y se omite.
      environmentFailed = true; pmrem?.dispose(); pmrem = null; environment = null;
    }
    return environment;
  }

  function apply(appearance: Appearance, detail: DetailLevel) {
    if (disposed) return;
    const look = LOOKS[appearance], tier = QUALITY_TIERS[detail];
    device.toneMapping = THREE.ACESFilmicToneMapping; device.toneMappingExposure = look.exposure;
    device.outputColorSpace = THREE.SRGBColorSpace;
    device.shadowMap.enabled = true; device.shadowMap.type = THREE.PCFShadowMap;
    scene.background = background.set(look.background); // un solo Color reutilizado: sin asignaciones por fotograma
    fog.color.set(look.fog); fog.density = look.fogDensity; scene.fog = fog;
    hemisphere.color.set(look.sky); hemisphere.groundColor.set(look.ground); hemisphere.intensity = look.hemisphere;
    key.color.set(look.key); key.intensity = look.keyIntensity;
    key.position.set(CENTRE.x + look.keyPosition[0], look.keyPosition[1], CENTRE.z + look.keyPosition[2]);
    rim.color.set(look.rim); rim.intensity = look.rimIntensity;
    fill.color.set(look.fill); fill.intensity = look.fillIntensity;
    if (key.shadow.mapSize.x !== tier.shadowMapSize) {
      key.shadow.map?.dispose(); key.shadow.map = null; // se reasigna con el nuevo tamaño en el siguiente render
      key.shadow.mapSize.set(tier.shadowMapSize, tier.shadowMapSize);
    }
    scene.environment = tier.environment ? environmentMap() : null;
    scene.environmentIntensity = look.environmentIntensity;
  }

  return {
    apply,
    dispose() {
      if (disposed) return; disposed = true;
      key.shadow.dispose(); environment?.dispose(); pmrem?.dispose();
      rig.removeFromParent(); rig.clear();
      if (scene.fog === fog) scene.fog = null;
      if (environment && scene.environment === environment) scene.environment = null;
      scene.background = null;
    },
  };
}
