import * as THREE from 'three';
import type { DetailLevel } from './types';

// Niveles de calidad del 3D y presupuestos del spec §7 (game-ui-design). `bloom` indica que el nivel lo admite;
// el post-proceso (EffectComposer) es P1 y lo monta quien orquesta el render (three.ts), no este módulo.
export type QualityTier = Readonly<{
  maxDrawCalls: number; maxTriangles: number; maxTextureMiB: number;
  shadowMapSize: number; maxPixelRatio: number; environment: boolean; bloom: boolean;
}>;

export const QUALITY_TIERS: Readonly<Record<DetailLevel, QualityTier>> = Object.freeze({
  standard: Object.freeze({ maxDrawCalls: 160, maxTriangles: 350_000, maxTextureMiB: 64, shadowMapSize: 2048, maxPixelRatio: 1.5, environment: true, bloom: true }),
  low: Object.freeze({ maxDrawCalls: 70, maxTriangles: 120_000, maxTextureMiB: 24, shadowMapSize: 1024, maxPixelRatio: 1.25, environment: false, bloom: false }),
});

export type SceneCost = { calls: number; triangles: number; textureBytes: number };

function textureBytes(texture: THREE.Texture): number {
  const image = texture.image as { width?: number; height?: number } | null | undefined;
  if (!image || !Number.isFinite(image.width) || !Number.isFinite(image.height)) return 0;
  const base = image.width! * image.height! * 4;
  return texture.generateMipmaps ? Math.ceil(base * 4 / 3) : base;
}

/**
 * Coste estructural de un subárbol: llamadas de dibujo de la pasada principal (sin post-proceso), triángulos y bytes
 * de textura sin comprimir. Con `shadowPass`, suma una pasada de sombra por cada objeto que la proyecta (la única luz
 * con sombra, spec §7; sin descontar lo que la cámara de sombra recorte, así que es una cota superior). Sirve en
 * pruebas sin WebGL; en el navegador la cifra real es `renderer.info.render`.
 */
export function estimateSceneCost(root: THREE.Object3D, options: Readonly<{ shadowPass?: boolean }> = {}): SceneCost {
  let calls = 0, triangles = 0;
  const passes = (object: THREE.Object3D) => options.shadowPass && object.castShadow ? 2 : 1;
  const textures = new Set<THREE.Texture>();
  root.traverseVisible(object => {
    if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.Line)) return;
    const geometry = object.geometry as THREE.BufferGeometry;
    const materials = (Array.isArray(object.material) ? object.material : [object.material]) as THREE.Material[];
    const instances = object instanceof THREE.InstancedMesh ? object.count : 1;
    const elements = geometry.index ? geometry.index.count : geometry.getAttribute('position')?.count ?? 0;
    const groups = Array.isArray(object.material) && geometry.groups.length
      ? geometry.groups.filter(group => materials[group.materialIndex ?? 0]?.visible)
      : materials[0]?.visible ? [{ start: 0, count: elements }] : [];
    for (const group of groups) {
      calls += passes(object);
      if (object instanceof THREE.Mesh) triangles += Math.floor(Math.min(group.count, elements) / 3) * instances * passes(object);
    }
    if (!groups.length) return;
    for (const material of materials) for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
  });
  let bytes = 0; for (const texture of textures) bytes += textureBytes(texture);
  return { calls, triangles, textureBytes: bytes };
}

export function withinBudget(cost: Readonly<{ calls: number; triangles: number }>, detail: DetailLevel): boolean {
  const tier = QUALITY_TIERS[detail];
  return cost.calls <= tier.maxDrawCalls && cost.triangles <= tier.maxTriangles;
}

/**
 * Auto-degradado (spec §7). Decide sobre una ventana de 3 s de reloj y, si degrada, avisa una sola vez y queda en
 * `dropped` para siempre (sin oscilación). Dos señales, cada una con su umbral:
 * - `workMs`, lo que cuesta de verdad preparar y enviar el fotograma (sincronizar, posar, `device.render`): media
 *   > 33 ms degrada. Es el «media de 3 s supera 33 ms» del spec, medido sobre el trabajo y no sobre la cadencia.
 * - El intervalo entre fotogramas dibujados. La app solo publica cada ≥ 32 ms (`useMatchPlayback`): 33,3 ms a
 *   60/120 Hz, 34,7 ms a 144 Hz, 40 ms a 75 Hz, 41,7 ms a 48 Hz. Ese intervalo es la cadencia de publicación, no el
 *   coste, así que solo cuenta por encima de 50 ms de media (< 20 fps publicados): el navegador o la GPU no dan
 *   abasto aunque la parte medible en CPU sea barata.
 * Los huecos de más de 250 ms (pausa, pestaña oculta, búsqueda) no cuentan, y la ventana debe llenarse antes de
 * decidir, así que un tirón corto no degrada.
 */
export function createFrameTimeMonitor(options: Readonly<{ windowMs?: number; thresholdMs?: number; intervalThresholdMs?: number; gapMs?: number }> = {}) {
  const windowMs = options.windowMs ?? 3000, thresholdMs = options.thresholdMs ?? 33;
  const intervalThresholdMs = options.intervalThresholdMs ?? 50, gapMs = options.gapMs ?? 250;
  const samples: { interval: number; work: number }[] = [];
  let last: number | null = null, intervalSum = 0, workSum = 0, dropped = false;
  return {
    get dropped() { return dropped; },
    /** Registra un fotograma terminado en `nowMs` que costó `workMs`; devuelve `true` solo en el fotograma en que se decide degradar. */
    sample(nowMs: number, workMs = 0): boolean {
      if (dropped || !Number.isFinite(nowMs)) return false;
      const previous = last; last = nowMs;
      if (previous === null) return false;
      const interval = nowMs - previous, work = Number.isFinite(workMs) && workMs > 0 ? workMs : 0;
      if (interval <= 0 || interval > gapMs) return false;
      samples.push({ interval, work }); intervalSum += interval; workSum += work;
      while (samples.length > 1 && intervalSum - samples[0].interval >= windowMs) {
        const old = samples.shift()!; intervalSum -= old.interval; workSum -= old.work;
      }
      if (intervalSum < windowMs) return false;
      if (workSum / samples.length > thresholdMs || intervalSum / samples.length > intervalThresholdMs) { dropped = true; return true; }
      return false;
    },
  };
}
