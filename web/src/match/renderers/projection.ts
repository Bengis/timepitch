import type { ScreenPoint, Viewport } from './types';

/** Pointer coordinates are CSS pixels; the backing-store DPR is irrelevant here. */
export function pointerToProjection(clientX: number, clientY: number,
  rect: Readonly<{ left: number; top: number; width: number; height: number }>, viewport: Viewport): ScreenPoint | null {
  if (![clientX, clientY, rect.left, rect.top, rect.width, rect.height, viewport.width, viewport.height].every(Number.isFinite)
    || rect.width <= 0 || rect.height <= 0 || viewport.width <= 0 || viewport.height <= 0) return null;
  const x = (clientX - rect.left) * viewport.width / rect.width;
  const y = (clientY - rect.top) * viewport.height / rect.height;
  return x >= 0 && x < viewport.width && y >= 0 && y < viewport.height ? { x, y } : null;
}
