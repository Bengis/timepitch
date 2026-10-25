import { expect, type Locator, type Page } from '@playwright/test';

// Browser-only observability. No source frames, auth, model hooks or production globals.
export async function graphicsProbe(page: Page) {
  await page.addInitScript(() => {
    const counters = { observers: 0, listeners: 0, contexts: 0, buffers: 0, textures: 0, programs: 0, draws: 0, lost: 0 };
    const frameTimes: number[] = [], contexts = new WeakSet<object>();
    const originalAdd = EventTarget.prototype.addEventListener, originalRemove = EventTarget.prototype.removeEventListener;
    const listeners = new WeakMap<object, Map<string, Set<unknown>>>();
    const watched = (target: unknown, type: string) => target === window && type === 'resize' || target instanceof HTMLCanvasElement && type.startsWith('webglcontext');
    EventTarget.prototype.addEventListener = function(type, callback, options) {
      if (callback && watched(this, type)) {
        let map = listeners.get(this); if (!map) listeners.set(this, map = new Map());
        const key = `${type}:${typeof options === 'boolean' ? options : options?.capture ?? false}`;
        let set = map.get(key); if (!set) map.set(key, set = new Set());
        if (!set.has(callback)) { set.add(callback); counters.listeners++; }
      }
      return originalAdd.call(this, type, callback, options);
    };
    EventTarget.prototype.removeEventListener = function(type, callback, options) {
      if (watched(this, type)) {
        const key = `${type}:${typeof options === 'boolean' ? options : options?.capture ?? false}`;
        if (listeners.get(this)?.get(key)?.delete(callback)) counters.listeners--;
      }
      return originalRemove.call(this, type, callback, options);
    };
    const NativeObserver = window.ResizeObserver;
    window.ResizeObserver = class extends NativeObserver {
      private counted = false;
      observe(target: Element, options?: ResizeObserverOptions) { if (!this.counted) { this.counted = true; counters.observers++; } super.observe(target, options); }
      disconnect() { if (this.counted) { this.counted = false; counters.observers--; } super.disconnect(); }
    };
    const originalContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(this: HTMLCanvasElement, ...args: unknown[]) {
      const context = Reflect.apply(originalContext, this, args);
      if (!context || !String(args[0]).startsWith('webgl') || contexts.has(context)) return context;
      contexts.add(context); counters.contexts++;
      const gl = context as WebGL2RenderingContext;
      const resources = { buffers: new Set<object>(), textures: new Set<object>(), programs: new Set<object>() };
      for (const [kind, create, remove] of [['buffers', 'createBuffer', 'deleteBuffer'], ['textures', 'createTexture', 'deleteTexture'], ['programs', 'createProgram', 'deleteProgram']] as const) {
        const nativeCreate = gl[create].bind(gl), nativeDelete = gl[remove].bind(gl);
        Object.defineProperty(gl, create, { value: () => { const result = nativeCreate(); if (result) { resources[kind].add(result); counters[kind]++; } return result; } });
        Object.defineProperty(gl, remove, { value: (resource: object) => { if (resources[kind].delete(resource)) counters[kind]--; return Reflect.apply(nativeDelete, gl, [resource]); } });
      }
      const clear = gl.clear.bind(gl);
      gl.clear = mask => { if (mask & gl.COLOR_BUFFER_BIT) { frameTimes.push(performance.now()); if (frameTimes.length > 2000) frameTimes.shift(); } return clear(mask); };
      for (const method of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced'] as const) {
        const native = gl[method].bind(gl); Object.defineProperty(gl, method, { value: (...values: number[]) => { counters.draws++; return Reflect.apply(native, gl, values); } });
      }
      originalAdd.call(this, 'webglcontextlost', () => {
        counters.contexts--; counters.lost++;
        for (const kind of ['buffers', 'textures', 'programs'] as const) { counters[kind] -= resources[kind].size; resources[kind].clear(); }
      }, { once: true });
      return context;
    } as typeof originalContext;
    Object.defineProperty(window, '__pitchGraphicsProbe', { value: { snapshot: () => ({ ...counters }), times: () => [...frameTimes] } });
  });
}

export async function readProbe(page: Page) {
  return page.evaluate(() => (window as unknown as { __pitchGraphicsProbe: { snapshot(): Record<string, number> } }).__pitchGraphicsProbe.snapshot());
}
/**
 * TP223: Retro 16-bit is the default; 3D (and its hidden 2D WebGL fallback) is an explicit choice. The 3D specs start
 * with that saved choice, as a viewer who picked 3D in «Graphics» would have it. Only when nothing is stored yet, so a
 * choice made during the test survives reloads.
 */
export async function prefer3D(page: Page) {
  await page.addInitScript(() => {
    if (localStorage.getItem('timepitch.pitch.v1') === null)
      localStorage.setItem('timepitch.pitch.v1', JSON.stringify({ version: 2, renderer: 'stylized-3d-1', rendererChosen: true, appearance: 'daylight', camera: 'follow', detail: 'standard' }));
  });
}
/** Read-only API gate for the 3D specs; it also starts them on the explicit 3D choice (`prefer3D`) unless told not to. */
export async function graphicsGate(page: Page, baseURL: string, { graphics = '3d' }: { graphics?: '3d' | 'default' } = {}) {
  if (graphics === '3d') await prefer3D(page);
  const forbidden: string[] = [], external: string[] = [], api: string[] = [], errors: string[] = [];
  const origin = new URL(baseURL).origin;
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { const url = new URL(request.url()); if (url.origin === origin && url.pathname.startsWith('/api/')) api.push(url.pathname + url.search); });
  await page.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) { external.push(url.origin); return route.abort(); }
    if (url.pathname.startsWith('/api/')) {
      if (request.method() !== 'GET') { forbidden.push(`${request.method()} ${url.pathname}`); return route.abort(); }
    }
    return route.fallback();
  });
  return { forbidden, external, api, errors };
}

// TP206: the simplified 2D view is only the automatic WebGL fallback, never a choice. The two choices are «Retro 16-bit»
// (`retro16-1`, default since TP223) and 3D; in the 3D specs (see `prefer3D`) a graphics picker must be on 3D.
export async function expectGraphicsChoice3D(scope: Locator) {
  for (const picker of await scope.getByRole('combobox', { name: /^(Graphics|Gráficos)$/, includeHidden: true }).all()) {
    await expect(picker).toHaveValue('stylized-3d-1');
    await expect(picker.locator('option')).toHaveCount(2);
  }
}
export async function expect3D(centre: Locator) {
  const pitch = centre.locator('.pitch-section');
  await expect(pitch).toHaveAttribute('data-renderer-status', 'ready');
  await expect(pitch).toHaveAttribute('data-effective-renderer', 'stylized-3d-1');
  await expect(centre.locator('canvas')).toHaveAttribute('data-renderer', 'stylized-3d-1');
  await expect(centre.locator('canvas')).not.toHaveAttribute('data-sprite-status');
  await expectGraphicsChoice3D(centre);
}
export async function expectFallback(centre: Locator) {
  const pitch = centre.locator('.pitch-section');
  await expect(pitch).toHaveAttribute('data-renderer-status', 'fallback');
  await expect(pitch).toHaveAttribute('data-effective-renderer', 'retro-1');
  await expect(pitch).toHaveAttribute('data-requested-renderer', 'stylized-3d-1');
  await expect(centre.locator('canvas')).toHaveAttribute('data-sprite-status', /^(ready|fallback)$/);
  await expect(centre.getByRole('button', { name: /^(Retry 3D|Reintentar 3D)$/ })).toBeVisible();
  await expectGraphicsChoice3D(centre);
}
/** Test-only: WebGL contexts are refused, as on a device without WebGL. 2D canvas is untouched. */
export async function refuseWebGL(page: Page) {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(this: HTMLCanvasElement, ...args: unknown[]) {
      return /webgl/i.test(String(args[0])) ? null : Reflect.apply(original, this, args);
    } as typeof original;
  });
}

export async function gpuIdentity(centre: Locator) {
  return centre.locator('canvas').evaluate(canvas => {
    const c = canvas as HTMLCanvasElement, gl = c.getContext('webgl2');
    if (!gl) throw new Error('Actual WebGL2 required; fallback is not acceptance');
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return { renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      vendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR), version: gl.getParameter(gl.VERSION),
      width: c.width, height: c.height, cssWidth: c.getBoundingClientRect().width, cssHeight: c.getBoundingClientRect().height, dpr: devicePixelRatio };
  });
}

// Independent pinhole projection, in CSS pixels, for the documented fixed overview camera.
export async function overviewPoint(centre: Locator, x: number, y: number) {
  return fieldPoint(centre, x, y, 'overview', { x: 52.5, y: 34 });
}
export async function fieldPoint(centre: Locator, x: number, y: number, camera: 'overview' | 'follow', focus: { x: number; y: number }) {
  await centre.locator('canvas').scrollIntoViewIfNeeded();
  const box = (await centre.locator('.pitch-canvas-container').boundingBox())!;
  const tangent = Math.tan(Math.PI / 9), aspect = box.width / box.height, sine = Math.sin(Math.PI / 3), cosine = .5;
  const distance = camera === 'overview' ? Math.max(56 / (tangent * aspect) + 36 * cosine, 36 * sine / tangent + 36 * cosine) : Math.max(42, 20 / (tangent * aspect));
  const depth = distance - cosine * (y - focus.y);
  return { x: box.x + box.width / 2 + (x - focus.x) / (depth * tangent * aspect) * box.width / 2,
    y: box.y + box.height / 2 + sine * (y - focus.y) / (depth * tangent) * box.height / 2 };
}
