// Retratos generados de Capitán Hane (TP235). Puro: del manifiesto (`public/assets/hane/manifest.json`) y del
// acontecimiento a las imágenes que usa cada fase de la escena. Las imágenes las generó FLUX.2-pro (Azure AI Foundry)
// con prompts hechos SOLO de los rasgos del avatar (piel, pelo, barba, ojos, complexión, equipación, dorsal y
// posición; nunca nombres, clubes ni fotos) y se revisaron una a una. Si no hay imagen para el jugador y la
// situación, o no ha cargado, la escena usa el primer plano SVG de siempre.
import type { CutInKind } from './cutins';

export type HaneSituation = 'charge' | 'celebration' | 'lament' | 'dive' | 'beaten';
export const HANE_SITUATIONS: readonly HaneSituation[] = ['charge', 'celebration', 'lament', 'dive', 'beaten'];

export type HaneImage = Readonly<{
  /** Clave de fuente del catálogo (`details.sourceKey` del jugador), la misma en los tres motores grabados. */
  sourceKey: string;
  qid: string | null;
  situation: HaneSituation;
  /** Ruta relativa a `assets/hane/` (`<equipo-temporada>/<jugador>-<situación>.webp`). */
  file: string;
  prompt: string; seed: number | null; requestId: string | null;
  sha256Png: string; sha256Webp: string;
  /** PNG original fuera de git, relativo a `.local/hane-originals/`. */
  original?: string;
  /** Veredicto de la revisión (`accepted: …`) y descartes previos del mismo objetivo con su motivo. */
  verdict: string;
  rejected?: readonly Readonly<{ candidate: string; reason: string }>[];
}>;
export type HaneManifest = Readonly<{
  schema: 'hane-portraits-1'; model: string; deployment: string; provider: string; generated: string;
  images: readonly HaneImage[];
}>;

/** Imágenes de una escena: `charge` = fase de carga; `outcome` = desenlace a pantalla completa; `inset` = viñeta. */
export type SceneArt = Readonly<{ charge: string | null; outcome: string | null; inset: string | null }>;
export const NO_ART: SceneArt = Object.freeze({ charge: null, outcome: null, inset: null });

const FILE = /^[a-z0-9-]+\/[a-z0-9-]+\.webp$/;
export const haneUrl = (base: string, file: string) => `${base.endsWith('/') ? base : `${base}/`}assets/hane/${file}`;

/** Índice `sourceKey|situación` → fichero. Descarta entradas mal formadas (ruta o situación desconocida). */
export function artIndex(manifest: HaneManifest | null | undefined): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  if (!manifest || manifest.schema !== 'hane-portraits-1' || !Array.isArray(manifest.images)) return out;
  for (const img of manifest.images)
    if (img && typeof img.sourceKey === 'string' && HANE_SITUATIONS.includes(img.situation) && typeof img.file === 'string' && FILE.test(img.file))
      out.set(`${img.sourceKey}|${img.situation}`, img.file);
  return out;
}

/** Qué retrato pide cada fase según el resultado GRABADO (nunca otro):
 *  carga → `charge` del protagonista (tiros y entradas); gol → celebración del goleador + portero batido en viñeta;
 *  parada → estirada del portero + lamento del tirador en viñeta; fuera → lamento del tirador; robo → la misma carga
 *  (no hay retrato propio de robo; así la escena no salta del retrato generado al SVG a mitad). */
export function situationsFor(kind: CutInKind): Readonly<{ charge: 'actor' | null; outcome: readonly ['actor' | 'keeper', HaneSituation] | null; inset: readonly ['actor' | 'keeper', HaneSituation] | null }> {
  switch (kind) {
    case 'goal': return { charge: 'actor', outcome: ['actor', 'celebration'], inset: ['keeper', 'beaten'] };
    case 'save': return { charge: 'actor', outcome: ['keeper', 'dive'], inset: ['actor', 'lament'] };
    case 'miss': return { charge: 'actor', outcome: ['actor', 'lament'], inset: null };
    case 'tackle': return { charge: 'actor', outcome: ['actor', 'charge'], inset: null };
  }
}

/** Busca la imagen de un jugador (por clave de fuente) y situación; `null` → retrato SVG. */
export type ArtLookup = (playerId: string | null, situation: HaneSituation) => string | null;

/** Imágenes de la escena. Sin imagen de desenlace no hay viñeta (la viñeta va sobre la imagen, no sobre el SVG). */
export function sceneArt(kind: CutInKind, actorId: string | null, keeperId: string | null, lookup: ArtLookup | null | undefined): SceneArt {
  if (!lookup) return NO_ART;
  const who = (role: 'actor' | 'keeper') => role === 'actor' ? actorId : keeperId;
  const s = situationsFor(kind);
  const charge = s.charge ? lookup(who(s.charge), 'charge') : null;
  const outcome = s.outcome ? lookup(who(s.outcome[0]), s.outcome[1]) : null;
  const inset = outcome && s.inset ? lookup(who(s.inset[0]), s.inset[1]) : null;
  return charge || outcome ? { charge, outcome, inset } : NO_ART;
}

/** URLs de las imágenes de los jugadores de este partido (para cargarlas a demanda, solo las suyas). */
export function matchArtFiles(index: ReadonlyMap<string, string>, sourceKeys: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const key of sourceKeys) for (const s of HANE_SITUATIONS) { const f = index.get(`${key}|${s}`); if (f) out.add(f); }
  return [...out].sort();
}
