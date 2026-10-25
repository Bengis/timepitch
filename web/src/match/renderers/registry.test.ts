import { afterEach, expect, it, vi } from 'vitest';
import { loadRenderer } from './registry';
import { createRetroRenderer } from './retro';
it.each(['fc-broadcast-1','sensible-1'])('no longer offers the retired 2D style %s',async id=>{
  await expect(loadRenderer(id as never)).rejects.toThrow('Unknown pitch renderer');
});
const three = vi.hoisted(() => ({ loaded: 0, factory: vi.fn() }));
vi.mock('./three', () => { three.loaded++; return { createThreeRenderer: three.factory }; });
afterEach(() => { vi.unstubAllGlobals(); });
it('only loads Three on demand and rejects arbitrary IDs or module URLs', async () => {
  expect(await loadRenderer('retro-1')).toBe(createRetroRenderer); expect(three.loaded).toBe(0);
  expect(await loadRenderer('stylized-3d-1')).toBe(three.factory); expect(three.loaded).toBe(1);
  for (const id of ['https://example.invalid/renderer.js', '../three', '__proto__'])
    await expect(loadRenderer(id as never)).rejects.toThrow();
});

it('Retro 16 bits is a separate, explicitly chosen renderer loaded on demand', async () => {
  const factory = await loadRenderer('retro16-1');
  expect(factory).toBe((await import('./retro16')).createRetro16Renderer);
  expect(factory).not.toBe(createRetroRenderer);
  expect(three.loaded).toBe(1);
});

it('explicit recovery rejects untrusted manifest paths before importing a URL', async () => {
  vi.resetModules(); vi.doMock('./three', () => { throw new Error('Initial chunk unavailable'); });
  const { loadRenderer: isolated } = await import('./registry');
  await expect(isolated('stylized-3d-1')).rejects.toThrow();
  for (const file of ['https://example.invalid/remote.js', '../remote.js', 'assets/../remote.js', 'assets/three-valid.js?evil=1']) {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ 'src/match/renderers/three.ts': { file } }) })));
    await expect(isolated('stylized-3d-1')).rejects.toThrow('Unsafe graphics chunk');
  }
  vi.doUnmock('./three');
});
