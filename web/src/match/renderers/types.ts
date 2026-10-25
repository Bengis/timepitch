import type { CameraMode, SceneFrame, VisualCue } from '../retroScene';
import type { MatchCast } from '../../presentation/types';
import type { CameraFraming } from './camera';

/**
 * Gráficos elegibles: `retro16-1` («Retro 16 bits», TP220; de serie desde TP223) y `stylized-3d-1` (3D, de serie en
 * TP205–TP222). `retro-1` no se elige: solo es el respaldo automático si el 3D no arranca (TP205).
 */
export type RendererId = 'retro-1' | 'stylized-3d-1' | 'retro16-1';
/** `anime-1` = «Capitán Hane» (TP234): el juego se dibuja con Retro 16 bits (con `style: 'hane'`, TP238) y las
 *  escenas van en una capa aparte. */
export type SelectableRendererId = Exclude<RendererId, 'retro-1'> | 'anime-1';
/** Gráfico que dibuja el campo para cada elección: Capitán Hane reutiliza Retro 16 bits. */
export const drawingRendererFor = (id: SelectableRendererId): Exclude<RendererId, 'retro-1'> => id === 'anime-1' ? 'retro16-1' : id;
export type Appearance = 'daylight' | 'floodlights';
export type DetailLevel = 'standard' | 'low';
export type Viewport = Readonly<{ width: number; height: number }>;
export type ScreenPoint = Readonly<{ x: number; y: number }>;
export type PitchProjection = Readonly<{
  viewport: Viewport;
  projectFieldPoint(x: number, y: number): ScreenPoint | null;
}>;
export type PitchRenderInput = Readonly<{
  frame: SceneFrame; previous: SceneFrame; cue?: VisualCue; restarting: boolean;
  selectedPlayerKey: string | null; camera: CameraMode; appearance: Appearance; detail: DetailLevel;
  fieldFocus?: Readonly<{x:number;y:number}> | null;
  labels: Readonly<{ home: string; away: string; clock: string; goal: string }>;
  /** Identidad visual opcional (equipación, dorsal, aspecto por clave de jugador). Sin ella, colores por lado. */
  cast?: MatchCast | null;
  /** Plano del 3D (Emisión / Táctica / Cerca). Sin él: `follow` = Emisión, `overview` = Táctica. Los 2D lo ignoran. */
  framing?: CameraFraming | null;
  /** TP238: «Capitán Hane» dibuja el campo de Retro 16 bits con estilo propio (césped vivo, contorno grueso, dorsales
   *  grandes y líneas de velocidad del que lleva el balón). Solo cambia el dibujo; posiciones y eventos, los grabados. */
  style?: 'hane' | null;
}>;
export type RendererFailure = 'initialization' | 'context_lost' | 'assets';
export interface PitchRenderer {
  update(input: PitchRenderInput): PitchProjection;
  resize(viewport: Viewport, devicePixelRatio: number): void;
  pickPlayer(point: ScreenPoint): string | null;
  dispose(): void;
}
export type RendererFactory = (canvas: HTMLCanvasElement, input: PitchRenderInput,
  onFailure: (reason: RendererFailure) => void) => PitchRenderer;
