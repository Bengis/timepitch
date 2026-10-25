import { createRetroRenderer } from './retro';
import type { RendererFactory, RendererId } from './types';

let threeFactory: RendererFactory | null = null, failedImport = false, retrySerial = 0;
async function loadThree(): Promise<RendererFactory> {
  if (threeFactory) return threeFactory;
  if (!failedImport) {
    try { return threeFactory = (await import('./three')).createThreeRenderer; }
    catch (error) { failedImport = true; throw error; }
  }
  // Browsers retain failed module URLs. Only a later explicit loader call reaches this path.
  // The build manifest supplies our fixed entry, never an operator/user-provided module URL.
  const base = new URL(import.meta.env.BASE_URL, window.location.origin + '/');
  const response = await fetch(new URL('assets/pitch-renderer-manifest.json', base), { credentials: 'omit', redirect: 'error', cache: 'no-cache' });
  if (!response.ok) throw new Error('Graphics build manifest unavailable');
  const manifest = await response.json(), file: unknown = manifest?.['src/match/renderers/three.ts']?.file;
  if (typeof file !== 'string' || !/^assets\/three-[a-zA-Z0-9_-]+\.js$/.test(file)) throw new Error('Unsafe graphics chunk');
  const url = new URL(file, base);
  if (url.origin !== window.location.origin) throw new Error('Unsafe graphics chunk');
  url.searchParams.set('pitch-retry', String(++retrySerial));
  const module = await import(/* @vite-ignore */ url.href);
  if (typeof module.createThreeRenderer !== 'function') throw new Error('Graphics entry unavailable');
  return threeFactory = module.createThreeRenderer;
}

export async function loadRenderer(id: RendererId): Promise<RendererFactory> {
  switch (id) {
    case 'retro-1': return createRetroRenderer;
    case 'stylized-3d-1': return loadThree();
    default: throw new Error('Unknown pitch renderer');
  }
}
