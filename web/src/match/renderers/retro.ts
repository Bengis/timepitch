import { atlasUrl, drawRetro } from '../retroCanvas';
import { hitPlayer, RETRO, sceneFor } from '../retroScene';
import type { PitchProjection, RendererFactory } from './types';

/** Owns drawing resources only. No replay clock, source access or player state. */
export const createRetroRenderer: RendererFactory = (canvas, initial, onFailure) => {
  canvas.width = RETRO.width; canvas.height = RETRO.height;
  canvas.dataset.renderer = 'retro-1'; canvas.dataset.spriteStatus = 'loading';
  const ctx = canvas.getContext('2d');
  let disposed = false, input = initial, atlas: HTMLImageElement | null = null;
  let scene = sceneFor(input.frame, input.previous, input.camera, input.selectedPlayerKey ?? '', input.cue, input.restarting,input.fieldFocus);
  function paint() {
    if (!disposed && ctx) drawRetro(ctx, input.frame, scene, atlas, input.selectedPlayerKey ?? '', input.labels);
  }
  function projection(): PitchProjection {
    const { sx, sy, ox, oy } = scene.transform;
    return { viewport: { width: RETRO.width, height: RETRO.height }, projectFieldPoint(x, y) {
      const px = x * sx + ox, py = y * sy + oy;
      return Number.isFinite(px) && Number.isFinite(py) && px >= 0 && px < RETRO.width && py >= RETRO.top && py < RETRO.bottom
        ? { x: px, y: py } : null;
    } };
  }
  const image = new Image();
  image.onload = () => {
    if (disposed) return;
    atlas = image; canvas.dataset.spriteStatus = 'ready'; paint();
  };
  image.onerror = () => {
    if (disposed) return;
    atlas = null; canvas.dataset.spriteStatus = 'fallback'; paint(); onFailure('assets');
  };
  image.src = atlasUrl;
  paint();
  return {
    update(next) {
      if (!disposed) {
        input = next;
        scene = sceneFor(input.frame, input.previous, input.camera, input.selectedPlayerKey ?? '', input.cue, input.restarting,input.fieldFocus);
        paint();
      }
      return projection();
    },
    resize() {
      // Fixed logical Retro resolution. CSS scales it; resize/DPR never alters hit coordinates.
      if (disposed) return;
      if (canvas.width !== RETRO.width) canvas.width = RETRO.width;
      if (canvas.height !== RETRO.height) canvas.height = RETRO.height;
      paint();
    },
    pickPlayer(point) { return disposed ? null : hitPlayer(scene, point.x, point.y); },
    dispose() {
      if (disposed) return;
      disposed = true; image.onload = null; image.onerror = null; atlas = null;
    },
  };
};
