// Renderizador «Retro 16 bits» / «Clásico 16 bits» (TP220): cenital vertical con scroll, Canvas 2D a escala entera y
// sin suavizado, arte indexado propio (TP219) recoloreado por equipación del reparto y por aspecto de cada jugador.
// Como el 3D, solo consume `SceneFrame` + `MatchCast` + el evento grabado (`cue`); no inventa eventos ni posiciones de
// jugadores. El árbitro y los asistentes (TP222) son figurantes ILUSTRATIVOS: `SceneFrame` no los trae y se colocan con
// reglas fijas a partir del balón y los jugadores grabados (ver frames.ts → officialTargets); no se pueden seleccionar y
// sus gestos (silbato, tarjeta, banderín) solo ilustran eventos grabados. La vista Táctica (TP222) es una capa propia en
// píxel (sensible/tactical.ts) a escala entera, no el estadio reducido con suavizado.
import atlasJson from './sensible/atlas.json';
import pitchJson from './sensible/pitch.json';
import { buildPaletteLUT, applyPalette, CARD_HEX, FIXED_COLOURS, NUMBER_FONT, PREVIEW_KIT, PREVIEW_LOOK, numberStyle, type SensibleKit } from './sensible/palette';
import { browserInflate, decodeIndexedPng, indicesFromRgba, type IndexedImage } from './sensible/png';
import { OFFICIAL_LOOKS, officialKit, playerLook } from './sensible/looks';
import {
  OFFICIAL_MOTION, OFFICIAL_ROLES, STADIUM, ballInNet, cameraView, chooseBall, chooseOfficialSprite, chooseSprite, fieldToStadium, followCentre, hudText,
  officialTargets, smoothCamera, spriteKey, stadiumToDevice, stepOfficial, teamTag, type CameraState, type CameraView, type OfficialRole, type OfficialState,
} from './sensible/frames';
import { officialTokenSize, tacticalLayout, tacticalPitch, tacticalPoint, tacticalToDevice, tokenNumber, tokenPixels, tokenSize, type TacticalLayout } from './sensible/tactical';
import { ballHeight, isMassReposition } from './camera';
import type { PitchProjection, PitchRenderInput, RendererFactory, ScreenPoint, Viewport } from './types';

type Rect = Readonly<{ x: number; y: number; w: number; h: number; ax: number; ay: number }>;
const FRAMES = atlasJson.frames as unknown as Readonly<Record<string, Rect>>;
/** Zona del dorsal por fotograma: [cara 1 dorso / 2 pecho, x, y, ancho, alto] respecto al ancla (TP222). */
const NUMBERS = atlasJson.numbers as unknown as Readonly<Record<string, readonly [number, number, number, number, number]>>;
const atlasUrl = new URL('./sensible/atlas.png', import.meta.url).href;
const pitchUrl = new URL('./sensible/pitch.png', import.meta.url).href;
const OUTSIDE = '#0a0d12', GRASS = '#3b8a3a';
/** Capitán Hane (TP238): tinta del contorno, césped de dibujo animado y rotulación de los dorsales grandes. */
const HANE_INK = '#140d12', HANE_GRASS_FILTER = 'saturate(1.5) brightness(1.12) contrast(1.08)', HANE_NUMBER = '#fff27a';
const LONG_SHADOW = /^(slide|gk-dive)/;

// ---------- Letra del marcador ----------
const GLYPHS = new Set<string>();
for (const key of Object.keys(FRAMES)) if (key.startsWith('env.font.')) {
  const name = key.slice(9);
  GLYPHS.add(name.length === 5 && name[0] === 'u' ? String.fromCharCode(parseInt(name.slice(1), 16)) : name);
}
GLYPHS.add('+'); // signo propio dibujado aquí (la letra del atlas no lo trae)
const PLUS = ['..#..', '..#..', '#####', '..#..', '..#..'];
const glyphKey = (c: string) => /[A-Z0-9]/.test(c) ? `env.font.${c}` : `env.font.u${c.charCodeAt(0).toString(16).padStart(4, '0')}`;
type Hit = { key: string; x0: number; y0: number; x1: number; y1: number; depth: number };
type ShirtNumber = { key: string; depth: number; x: number; y: number; area: readonly number[]; value: string; kit: SensibleKit };
type Track = { x: number; y: number; clock: number; run: number };

export const createRetro16Renderer: RendererFactory = (canvas, initial, onFailure) => {
  canvas.dataset.renderer = 'retro16-1'; canvas.dataset.spriteStatus = 'loading';
  const ctx = canvas.getContext('2d');
  const buffer = document.createElement('canvas'), bctx = buffer.getContext('2d');
  let disposed = false, input = initial, css: Viewport = { width: canvas.clientWidth || 384, height: canvas.clientHeight || 256 }, dpr = 1;
  let atlas: IndexedImage | null = null, pitch: HTMLImageElement | null = null, fixed: HTMLCanvasElement | null = null;
  let view: CameraView = cameraView('follow', null, 384, 256), hits: Hit[] = [];
  /** Vista Táctica en curso (null en seguimiento) y su campo ya dibujado. */
  let tactical: TacticalLayout | null = null, tacticalKey = '';
  const tacticalField = document.createElement('canvas');
  /** Campo (m) → píxel de dispositivo del lienzo, según la vista del último pintado. */
  let fieldToDevice = (x: number, y: number): ScreenPoint => { const p = fieldToStadium(x, y); return stadiumToDevice(view, p.x, p.y); };
  /** Píxeles de dispositivo por píxel de arte en pantalla (1 si la escala no es entera) y escala del marcador. */
  let artScale = 1, hudScale = 1;
  /** Táctica: el marcador va arriba a la izquierda cuando el balón está en la mitad derecha (con histéresis). */
  let hudLeft = false;
  const looks = new Map<string, HTMLCanvasElement>(), tracks = new Map<string, Track>();
  const officials = new Map<OfficialRole, OfficialState>();
  let castSeen = initial.cast ?? null, ballTrack: Track | null = null, cam: CameraState | null = null;
  /** Borde CSS del lienzo (px): el búfer debe medir lo mismo que la caja de contenido o el navegador lo reescala. */
  let inset = { x: 0, y: 0 };
  if (!ctx || !bctx) { onFailure('initialization'); }

  function recolour(lut: Uint8ClampedArray): HTMLCanvasElement {
    const sheet = document.createElement('canvas'); sheet.width = atlas!.width; sheet.height = atlas!.height;
    const image = sheet.getContext('2d')!.createImageData(atlas!.width, atlas!.height);
    applyPalette(atlas!.indices, lut, image.data);
    sheet.getContext('2d')!.putImageData(image, 0, 0);
    return sheet;
  }
  function sheetFor(player: PitchRenderInput['frame']['players'][number]) {
    const look = playerLook(player, input.cast);
    let sheet = looks.get(look.key);
    if (!sheet) {
      if (looks.size > 48) looks.clear();
      sheet = recolour(buildPaletteLUT(look.kit, look.look)); looks.set(look.key, sheet);
    }
    return sheet;
  }
  function officialSheet(i: number, card: 'yellow' | 'red' = 'yellow') {
    const kit = officialKit(input.cast), key = `official|${i}|${kit.shirt}|${card}`;
    let sheet = looks.get(key);
    if (!sheet) { sheet = recolour(buildPaletteLUT(kit, { ...OFFICIAL_LOOKS[i], card: CARD_HEX[card] })); looks.set(key, sheet); }
    return sheet;
  }
  /** Ficha táctica (píxel) de una equipación, cacheada por tamaño. Árbitros: rombo con contorno. */
  function tokenSprite(cacheKey: string, kit: SensibleKit, d: number, diamond = false) {
    const key = `token|${cacheKey}|${d}|${diamond ? 1 : 0}`;
    let sheet = looks.get(key);
    if (!sheet) {
      sheet = document.createElement('canvas'); sheet.width = sheet.height = d;
      const c = sheet.getContext('2d'), pixels = tokenPixels(kit, d), r = (d - 1) / 2;
      if (c) pixels.forEach((row, y) => row.forEach((colour, x) => {
        const dist = Math.abs(x - r) + Math.abs(y - r);
        if (!colour || (diamond && dist > r)) return;
        // Rombo de árbitro: todo camiseta dentro del contorno (con pantalón, a 3 px quedaba una cruz negra).
        c.fillStyle = diamond ? (dist > r - 1 ? FIXED_COLOURS.outline : kit.shirt) : colour; c.fillRect(x, y, 1, 1);
      }));
      looks.set(key, sheet);
    }
    return sheet;
  }
  /** Capitán Hane (TP238): silueta en tinta de una hoja de sprites, para el contorno grueso de dibujo animado. */
  const inked = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();
  function inkSheet(sheet: HTMLCanvasElement) {
    let ink = inked.get(sheet);
    if (!ink) {
      ink = document.createElement('canvas'); ink.width = sheet.width; ink.height = sheet.height;
      const c = ink.getContext('2d');
      if (c) { c.drawImage(sheet, 0, 0); c.globalCompositeOperation = 'source-in'; c.fillStyle = HANE_INK; c.fillRect(0, 0, ink.width, ink.height); }
      inked.set(sheet, ink);
    }
    return ink;
  }
  /** Sprite con contorno de un píxel de arte alrededor (silueta desplazada en cruz por detrás). */
  function blitOutlined(target: CanvasRenderingContext2D, sheet: HTMLCanvasElement, key: string, x: number, y: number) {
    const ink = inkSheet(sheet);
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) blit(target, ink, key, x + dx, y + dy);
    return blit(target, sheet, key, x, y);
  }
  function blit(target: CanvasRenderingContext2D, sheet: CanvasImageSource, key: string, x: number, y: number, scale = 1) {
    const r = FRAMES[key]; if (!r) return null;
    const dx = Math.round(x - r.ax * scale), dy = Math.round(y - r.ay * scale);
    target.drawImage(sheet, r.x, r.y, r.w, r.h, dx, dy, r.w * scale, r.h * scale);
    return { x0: dx, y0: dy, x1: dx + r.w * scale, y1: dy + r.h * scale };
  }

  /** Avanza la fase de carrera de cada jugador (metros recorridos) sin contar dos veces el mismo fotograma. */
  function advance(key: string, x: number, y: number, clock: number, track: Map<string, Track>) {
    const old = track.get(key);
    if (!old) { const t = { x, y, clock, run: 0 }; track.set(key, t); return t; }
    if (clock !== old.clock) {
      const d = Math.hypot(x - old.x, y - old.y);
      if (Number.isFinite(d) && d < 3) old.run += d;
      old.x = x; old.y = y; old.clock = clock;
    }
    return old;
  }

  /**
   * `css` es la caja del contenedor; el lienzo tiene borde (1 px por lado). Si el búfer midiera la caja exterior, el
   * navegador lo encogería 2 px y, con `pixelated`, se comería una fila y una columna de píxeles del arte. El borde solo
   * se puede medir con el lienzo ya en el documento: `measured` repite la medida en el primer pintado tras montarlo.
   */
  let measured = false;
  function fitBacking() {
    let bx = 0, by = 0;
    measured = canvas.isConnected;
    if (measured) try {
      const s = getComputedStyle(canvas);
      bx = (parseFloat(s.borderLeftWidth) || 0) + (parseFloat(s.borderRightWidth) || 0);
      by = (parseFloat(s.borderTopWidth) || 0) + (parseFloat(s.borderBottomWidth) || 0);
    } catch { /* sin estilos (pruebas): sin borde */ }
    if (!(bx >= 0 && bx < css.width)) bx = 0;
    if (!(by >= 0 && by < css.height)) by = 0;
    inset = { x: bx / 2, y: by / 2 };
    const w = Math.max(1, Math.round((css.width - bx) * dpr)), h = Math.max(1, Math.round((css.height - by) * dpr));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
  }

  /** Árbitro y asistentes: avanzan hacia su sitio (reglas fijas a partir de lo grabado; ilustrativos). */
  function stepOfficials(frame: PitchRenderInput['frame'], ball: { x: number; y: number } | null, cut: boolean) {
    const targets = officialTargets(frame.players, ball);
    return OFFICIAL_ROLES.map(role => {
      const state = stepOfficial(officials.get(role) ?? null, targets[role], frame.clock_ms, cut, OFFICIAL_MOTION.maxSpeed[role]);
      officials.set(role, state);
      return { role, state };
    });
  }

  function paint() {
    if (disposed || !ctx || !bctx) return;
    if (!measured && canvas.isConnected && canvas.width > 0) fitBacking();
    if (input.cast !== castSeen) { looks.clear(); castSeen = input.cast ?? null; }
    const W = canvas.width, H = canvas.height, frame = input.frame, previous = input.previous;
    // Foco como el 3D: el de la secuencia, si no el jugador seleccionado, si no el balón.
    const chosen = frame.players.find(p => p.key === input.selectedPlayerKey && Number.isFinite(p.x) && Number.isFinite(p.y));
    const focus = input.fieldFocus !== undefined ? input.fieldFocus : chosen ?? frame.ball;
    const invalidFocus = input.fieldFocus !== undefined && !(input.fieldFocus && Number.isFinite(input.fieldFocus.x) && Number.isFinite(input.fieldFocus.y));
    const overview = input.camera === 'overview' || invalidFocus;
    if (overview && atlas && fixed) { paintTactical(W, H); return; }
    if (tactical) { tactical = null; delete canvas.dataset.tactical; }
    const cameraCut = input.restarting || isMassReposition(previous, frame) || frame.period !== previous.period;
    cam = overview ? null : smoothCamera(cam, followCentre(focus ?? null), frame.clock_ms, cameraCut);
    view = cameraView(overview ? 'overview' : 'follow', focus ?? null, W, H, dpr, cam);
    canvas.dataset.camera = input.camera;
    const bx0 = Math.max(0, view.x), by0 = Math.max(0, view.y);
    const bw = Math.max(1, Math.min(STADIUM.width, view.x + view.w) - bx0), bh = Math.max(1, Math.min(STADIUM.height, view.y + view.h) - by0);
    if (buffer.width !== bw) buffer.width = bw;
    if (buffer.height !== bh) buffer.height = bh;
    bctx.imageSmoothingEnabled = false;
    const hane = input.style === 'hane';
    canvas.dataset.style = hane ? 'hane' : 'retro';
    // Capitán Hane: el mismo estadio con colores de dibujo animado (sin `filter`, el de siempre).
    if (hane) bctx.filter = HANE_GRASS_FILTER;
    if (pitch) bctx.drawImage(pitch, bx0, by0, bw, bh, 0, 0, bw, bh);
    else { bctx.fillStyle = GRASS; bctx.fillRect(0, 0, bw, bh); }
    if (hane) bctx.filter = 'none';
    const toBuffer = (x: number, y: number) => { const p = fieldToStadium(x, y); return { x: p.x - bx0, y: p.y - by0 }; };
    const nextHits: Hit[] = [], occluders: Hit[] = [], shirtNumbers: ShirtNumber[] = [];
    let officialsShown = 0;
    const ready = atlas && fixed;
    const z = ballHeight(frame.ball);
    const ball = frame.ball && Number.isFinite(frame.ball.x) && Number.isFinite(frame.ball.y) ? { x: frame.ball.x, y: frame.ball.y, z } : null;
    if (!ready) {
      // Mientras carga el arte: marcas de color en su sitio (nunca se inventa nada).
      for (const p of frame.players) {
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
        const s = toBuffer(p.x, p.y), look = playerLook(p, input.cast);
        bctx.fillStyle = look.kit.shirt; bctx.fillRect(Math.round(s.x) - 2, Math.round(s.y) - 6, 5, 7);
      }
      if (ball) { const s = toBuffer(ball.x, ball.y); bctx.fillStyle = '#fcfcf4'; bctx.fillRect(Math.round(s.x) - 1, Math.round(s.y) - 1, 3, 3); }
    } else {
      const cut = input.restarting || isMassReposition(previous, frame);
      const before = new Map(previous.players.map(p => [p.key, p]));
      const dt = (frame.clock_ms - previous.clock_ms) / 1000;
      const cue = input.cue ?? null;
      // Velocidad grabada del balón (para la estirada del portero): solo entre dos fotogramas seguidos de la grabación.
      const prevBall = previous.ball, ballVelocity = ball && prevBall && !cut && frame.period === previous.period && dt > 0
        && Number.isFinite(prevBall.x) && Number.isFinite(prevBall.y) && Math.hypot(ball.x - prevBall.x, ball.y - prevBall.y) < 10
        ? { x: (ball.x - prevBall.x) / dt, y: (ball.y - prevBall.y) / dt, z: (z - ballHeight(prevBall)) / dt } : null;
      type Item = { depth: number; draw: () => void };
      const items: Item[] = [];
      const goals = pitchJson.goals;
      blit(bctx, fixed!, goals.north.sprites.net, goals.north.x - bx0, goals.north.y - by0);
      items.push({ depth: goals.north.y, draw: () => blit(bctx, fixed!, goals.north.sprites.frame, goals.north.x - bx0, goals.north.y - by0) });
      items.push({ depth: goals.south.y, draw: () => blit(bctx, fixed!, goals.south.sprites.frame, goals.south.x - bx0, goals.south.y - by0) });
      items.push({ depth: goals.south.y + 16, draw: () => blit(bctx, fixed!, goals.south.sprites.net, goals.south.x - bx0, goals.south.y - by0) });
      const flag = `env.flag.${Math.floor(frame.clock_ms / 250) % 2}`;
      for (const [cx, cy] of pitchJson.corners) items.push({ depth: cy, draw: () => blit(bctx, fixed!, flag, cx - bx0, cy - by0) });
      for (const p of frame.players) {
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
        const old = before.get(p.key), moved = old ? Math.hypot(p.x - old.x, p.y - old.y) : Infinity;
        const still = cut || !old || frame.period !== previous.period || !(dt > 0) || !(moved < 3);
        const vx = still ? 0 : (p.x - old!.x) / dt, vy = still ? 0 : (p.y - old!.y) / dt;
        const track = advance(p.key, p.x, p.y, frame.clock_ms, tracks);
        const choice = chooseSprite({ key: p.key, role: p.role, side: p.side, x: p.x, y: p.y, vx, vy, clockMs: frame.clock_ms, cut,
          cue, ball, ballVelocity, runDistance: track.run, concedingKeeper: cue?.type === 'goal' && !!cue.side && cue.side !== p.side && p.role === 'GK' });
        const s = toBuffer(p.x, p.y), sheet = sheetFor(p), key = spriteKey(choice), id = key.slice('player.'.length);
        const look = playerLook(p, input.cast), number = input.cast?.players?.get(p.key)?.number;
        blit(bctx, fixed!, LONG_SHADOW.test(choice.anim) ? 'shadow.long' : 'shadow.player', s.x, s.y);
        // Capitán Hane: líneas de velocidad detrás de quien lleva el balón corriendo (velocidad y balón, los grabados).
        const speed = Math.hypot(vx, vy);
        if (hane && ball && speed >= 4 && Math.hypot(ball.x - p.x, ball.y - p.y) <= 1.5) {
          const back = toBuffer(p.x - vx * .45, p.y - vy * .45), dx = s.x - back.x, dy = s.y - back.y, len = Math.hypot(dx, dy) || 1;
          const nx = -dy / len, ny = dx / len;
          items.push({ depth: s.y + by0 - .1, draw: () => {
            bctx.strokeStyle = 'rgba(255,255,255,.85)'; bctx.lineWidth = 1;
            for (const k of [-3, 0, 3]) {
              bctx.beginPath(); bctx.moveTo(Math.round(s.x - dx * .25 + nx * k) + .5, Math.round(s.y - 4 - dy * .25 + ny * k) + .5);
              bctx.lineTo(Math.round(back.x - dx * .6 + nx * k) + .5, Math.round(back.y - 4 - dy * .6 + ny * k) + .5); bctx.stroke();
            }
          } });
        }
        items.push({ depth: s.y + by0, draw: () => {
          const box = hane ? blitOutlined(bctx, sheet, key, s.x, s.y) : blit(bctx, sheet, key, s.x, s.y);
          // Peinado que sobresale (tupé, rizos, melena, moño): capa del mismo fotograma y el mismo ancla.
          if (look.feature) { if (hane) blitOutlined(bctx, sheet, `hair.${look.feature}.${id}`, s.x, s.y); else blit(bctx, sheet, `hair.${look.feature}.${id}`, s.x, s.y); }
          if (box) { nextHits.push({ key: p.key, ...box, depth: s.y }); occluders.push({ key: p.key, ...box, depth: s.y }); }
          const area = NUMBERS[id];
          if (area && number && /^\d{1,2}$/.test(number)) shirtNumbers.push({ key: p.key, depth: s.y, x: Math.round(s.x), y: Math.round(s.y), area, value: number, kit: look.kit });
        } });
      }
      // Árbitro y asistentes: figurantes ilustrativos colocados por reglas (frames.ts → officialTargets), no datos de la
      // fuente. La tarjeta solo sale con una tarjeta grabada, del color grabado y mirando al amonestado.
      const booked = cue?.type === 'card' ? frame.players.find(p => p.key === cue.participants[0]) ?? null : null;
      stepOfficials(frame, ball, cut || frame.period !== previous.period).forEach(({ role, state }, i) => {
        const choice = chooseOfficialSprite(role, state, ball, cue, booked), s = toBuffer(state.x, state.y);
        const sheet = officialSheet(i, cue?.type === 'card' && cue.card === 'red' ? 'red' : 'yellow');
        blit(bctx, fixed!, 'shadow.player', s.x, s.y);
        items.push({ depth: s.y + by0 - .25, draw: () => {
          const box = blit(bctx, sheet, spriteKey(choice), s.x, s.y);
          if (box) occluders.push({ key: role, ...box, depth: s.y });
          if (box && box.x1 > 0 && box.y1 > 0 && box.x0 < bw && box.y0 < bh) officialsShown++;
        } });
      });
      if (ball) {
        // Tras un gol grabado, el balón se pinta contra la red aunque la grabación lo lleve más allá (ver ballInNet).
        const shown = cue?.type === 'goal' ? ballInNet(ball) : ball, s = toBuffer(shown.x, shown.y);
        const track = ballTrack && Math.hypot(ball.x - ballTrack.x, ball.y - ballTrack.y) < 15 ? ballTrack : (ballTrack = { x: ball.x, y: ball.y, clock: frame.clock_ms, run: 0 });
        if (track.clock !== frame.clock_ms) { track.run += Math.hypot(ball.x - track.x, ball.y - track.y); track.x = ball.x; track.y = ball.y; track.clock = frame.clock_ms; }
        const look = chooseBall(shown.z, track.run);
        blit(bctx, fixed!, look.shadow, s.x, s.y);
        items.push({ depth: s.y + by0 + .5, draw: () => blit(bctx, fixed!, look.key, s.x, s.y - look.lift) });
      }
      items.sort((a, b) => a.depth - b.depth);
      for (const item of items) item.draw();
      const selected = input.selectedPlayerKey ? nextHits.find(h => h.key === input.selectedPlayerKey) : null;
      if (selected) marker(bctx, selected, input.cast?.players?.get(selected.key)?.number ?? null);
    }
    if (input.appearance === 'floodlights') { bctx.fillStyle = 'rgba(10,16,52,.24)'; bctx.fillRect(0, 0, bw, bh); }
    // Lienzo visible: fondo, el búfer escalado (entero y sin suavizar en seguimiento) y el marcador.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = OUTSIDE; ctx.fillRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = view.smooth;
    if (view.smooth) ctx.imageSmoothingQuality = 'high';
    const origin = stadiumToDevice(view, bx0, by0);
    fieldToDevice = (x, y) => { const p = fieldToStadium(x, y); return stadiumToDevice(view, p.x, p.y); };
    artScale = hudScale = Number.isInteger(view.scale) ? view.scale : 1;
    ctx.drawImage(buffer, 0, 0, bw, bh, Math.round(origin.x), Math.round(origin.y), Math.round(bw * view.scale), Math.round(bh * view.scale));
    ctx.imageSmoothingEnabled = false;
    hits = nextHits.map(h => ({ ...h, x0: origin.x + h.x0 * view.scale, x1: origin.x + h.x1 * view.scale, y0: origin.y + h.y0 * view.scale, y1: origin.y + h.y1 * view.scale }));
    // Observables (como data-camera): dorsales y árbitros que se ven en el último pintado.
    canvas.dataset.shirtNumbers = String(input.style === 'hane' ? haneNumbers(ctx) : drawNumbers(ctx, shirtNumbers, occluders, { x: Math.round(origin.x), y: Math.round(origin.y) }));
    canvas.dataset.officials = String(officialsShown);
    if (fixed) hud(ctx, W, H);
  }

  /**
   * Vista Táctica en píxel (TP222): capa propia de baja resolución (campo, fichas con la equipación y el dorsal si cabe,
   * árbitros en rombo y balón) ampliada a escala entera sin suavizar. Las posiciones son las grabadas.
   */
  function paintTactical(W: number, H: number) {
    if (!ctx || !bctx) return;
    const frame = input.frame, previous = input.previous, layout = tacticalLayout(W, H, dpr);
    tactical = layout; cam = null;
    canvas.dataset.tactical = `${layout.landscape ? 'landscape' : 'portrait'} ${layout.ppm}ppm x${layout.scale}`;
    canvas.dataset.camera = input.camera;
    const key = `${layout.ppm}|${layout.landscape}`;
    if (tacticalKey !== key) {
      const img = tacticalPitch(layout);
      tacticalField.width = img.width; tacticalField.height = img.height;
      const c = tacticalField.getContext('2d');
      if (c) { const data = c.createImageData(img.width, img.height); data.data.set(img.data); c.putImageData(data, 0, 0); }
      tacticalKey = key;
    }
    if (buffer.width !== layout.w) buffer.width = layout.w;
    if (buffer.height !== layout.h) buffer.height = layout.h;
    bctx.imageSmoothingEnabled = false;
    bctx.drawImage(tacticalField, 0, 0);
    const d = tokenSize(layout.ppm), r = (d - 1) / 2, nextHits: Hit[] = [];
    const at = (x: number, y: number) => { const p = tacticalPoint(layout, x, y); return { x: Math.round(p.x), y: Math.round(p.y) }; };
    const z = ballHeight(frame.ball);
    const ball = frame.ball && Number.isFinite(frame.ball.x) && Number.isFinite(frame.ball.y) ? { x: frame.ball.x, y: frame.ball.y, z } : null;
    const cut = input.restarting || isMassReposition(previous, frame) || frame.period !== previous.period;
    // Árbitros (rombos más pequeños, ilustrativos): primero, debajo de los jugadores.
    const refKit = officialKit(input.cast), od = officialTokenSize(layout.ppm);
    let officialsShown = 0, numbersShown = 0;
    for (const { state } of stepOfficials(frame, ball, cut)) {
      const p = at(state.x, state.y);
      if (p.x >= 0 && p.y >= 0 && p.x < layout.w && p.y < layout.h) officialsShown++;
      bctx.drawImage(tokenSprite(`official|${refKit.shirt}`, refKit, od, true), p.x - (od - 1) / 2, p.y - (od - 1) / 2);
    }
    const players = frame.players.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y))
      .map(p => ({ p, q: at(p.x, p.y) })).sort((a, b) => a.q.y - b.q.y || a.q.x - b.q.x);
    for (const { p, q } of players) {
      const look = playerLook(p, input.cast);
      bctx.drawImage(tokenSprite(look.key.split('|')[0], look.kit, d), q.x - r, q.y - r);
      const number = tokenNumber(input.cast?.players?.get(p.key)?.number, look.kit, d);
      if (number?.plate) { const [px, py, pw, ph] = number.plate; bctx.fillStyle = number.plateFill; bctx.fillRect(q.x - r + px, q.y - r + py, pw, ph); }
      if (number) { numbersShown++; bctx.fillStyle = number.fill; for (const [nx, ny] of number.pixels) bctx.fillRect(q.x - r + nx, q.y - r + ny, 1, 1); }
      nextHits.push({ key: p.key, x0: q.x - r, y0: q.y - r, x1: q.x + r + 1, y1: q.y + r + 1, depth: q.y });
    }
    if (ball) {
      const shown = input.cue?.type === 'goal' ? ballInNet(ball) : ball;
      const q = at(shown.x, shown.y), big = layout.ppm >= 4;
      const shape = big ? ['.###.', '#WWW#', '#WPW#', '#WWW#', '.###.'] : ['.W.', 'WWW', '.W.'];
      const o = (shape.length - 1) / 2;
      bctx.fillStyle = FIXED_COLOURS.shadow;
      if (!big) shape.forEach((row, y) => [...row].forEach((c, x) => { if (c !== '.') bctx.fillRect(q.x - o + x + 1, q.y - o + y + 1, 1, 1); }));
      shape.forEach((row, y) => [...row].forEach((c, x) => {
        if (c === '.') return;
        bctx.fillStyle = c === '#' ? FIXED_COLOURS.outline : c === 'P' ? FIXED_COLOURS.ballPanel : FIXED_COLOURS.ballWhite;
        bctx.fillRect(q.x - o + x, q.y - o + y, 1, 1);
      }));
    }
    const selected = input.selectedPlayerKey ? nextHits.find(h => h.key === input.selectedPlayerKey) : null;
    if (selected) marker(bctx, selected, input.cast?.players?.get(selected.key)?.number ?? null);
    canvas.dataset.shirtNumbers = String(numbersShown); canvas.dataset.officials = String(officialsShown);
    if (input.appearance === 'floodlights') { bctx.fillStyle = 'rgba(10,16,52,.24)'; bctx.fillRect(0, 0, layout.w, layout.h); }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = OUTSIDE; ctx.fillRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(buffer, 0, 0, layout.w, layout.h, layout.ox, layout.oy, layout.w * layout.scale, layout.h * layout.scale);
    fieldToDevice = (x, y) => { const p = tacticalPoint(layout, x, y); return tacticalToDevice(layout, p.x + .5, p.y + .5); };
    // El marcador no crece con la táctica: a la mitad (las fichas son pequeñas y no debe tapar media banda).
    artScale = layout.scale; hudScale = Math.max(1, Math.floor(layout.scale / 2));
    hits = nextHits.map(h => {
      const a = tacticalToDevice(layout, h.x0, h.y0), b = tacticalToDevice(layout, h.x1, h.y1);
      return { ...h, x0: a.x, y0: a.y, x1: b.x, y1: b.y };
    });
    hud(ctx, W, H);
  }

  /**
   * Dorsales (TP222). La espalda mide 3–4 px de arte: dos cifras de 3×5 no caben a la escala del arte, así que se
   * pintan a media rejilla (un píxel de letra = medio píxel de arte, alineado a píxeles del dispositivo) y solo con
   * escala entera ≥ 2. Delante, más pequeños y solo con escala ≥ 4. Si otro jugador o un árbitro pintado delante pisa
   * la zona, no se pinta (el dorsal no puede atravesar a quien tapa al jugador).
   */
  function drawNumbers(target: CanvasRenderingContext2D, list: readonly ShirtNumber[], occluders: readonly Hit[], origin: { x: number; y: number }): number {
    const scale = view.scale;
    if (view.smooth || !Number.isInteger(scale) || scale < 2) return 0;
    let drawn = 0;
    for (const n of list) {
      const [face, ax, ay, aw, ah] = n.area;
      if (face === 2 && scale < 4) continue;
      const f = face === 1 ? Math.max(1, Math.floor(scale / 2)) : Math.max(1, Math.floor(scale / 4));
      const width = (n.value.length * 4 - 1) * f;
      if (width > (aw + 1) * scale) continue;
      const bx0 = n.x + ax, by0 = n.y + ay;
      if (occluders.some(o => o.depth > n.depth && o.key !== n.key && o.x0 < bx0 + aw && o.x1 > bx0 && o.y0 < by0 + ah && o.y1 > by0)) continue;
      const cx = origin.x + (bx0 + aw / 2) * scale, cy = origin.y + (by0 + ah / 2) * scale;
      const left = Math.round(cx - width / 2), top = Math.round(cy - 5 * f / 2), style = numberStyle(n.kit);
      if (style.plate) { target.fillStyle = style.plate; target.fillRect(left - f, top - f, width + 2 * f, 7 * f); }
      target.fillStyle = style.fill;
      [...n.value].forEach((d, i) => { const bits = NUMBER_FONT[d]; for (let k = 0; k < 15; k++) if (bits[k] === '1') target.fillRect(left + (i * 4 + k % 3) * f, top + Math.floor(k / 3) * f, f, f); });
      drawn++;
    }
    return drawn;
  }

  /**
   * Capitán Hane (TP238): dorsal grande sobre la cabeza, rotulado como en el manga (relleno claro y contorno grueso).
   * Solo dorsales identificados del reparto (como los de la espalda); nunca uno inventado.
   */
  function haneNumbers(target: CanvasRenderingContext2D): number {
    const size = Math.max(15, Math.round(7 * artScale + 6));
    target.save();
    target.font = `italic 900 ${size}px 'Segoe UI', Arial, sans-serif`; target.textAlign = 'center'; target.textBaseline = 'bottom';
    target.lineJoin = 'round'; target.lineWidth = Math.max(3, size / 4); target.strokeStyle = HANE_INK; target.fillStyle = HANE_NUMBER;
    let drawn = 0;
    for (const h of hits) {
      const number = input.cast?.players?.get(h.key)?.number;
      if (!number || !/^\d{1,2}$/.test(number)) continue;
      const x = Math.round((h.x0 + h.x1) / 2), y = Math.round(h.y0 - size * .1);
      target.strokeText(number, x, y); target.fillText(number, x, y); drawn++;
    }
    target.restore();
    return drawn;
  }

  function marker(target: CanvasRenderingContext2D, box: Hit, number: string | null) {
    const cx = Math.round((box.x0 + box.x1) / 2), top = box.y0 - 2;
    target.fillStyle = FIXED_COLOURS.outline;
    target.fillRect(cx - 3, top - 5, 7, 1); target.fillRect(cx - 2, top - 4, 5, 1); target.fillRect(cx - 1, top - 3, 3, 1); target.fillRect(cx, top - 2, 1, 1);
    target.fillStyle = FIXED_COLOURS.flagLight;
    target.fillRect(cx - 2, top - 5, 5, 1); target.fillRect(cx - 1, top - 4, 3, 1); target.fillRect(cx, top - 3, 1, 1);
    if (!number || !/^\d{1,2}$/.test(number)) return;
    const digits = number.split(''), width = digits.length * 4 - 1, left = cx - Math.floor(width / 2), y = top - 12;
    target.fillStyle = FIXED_COLOURS.outline; target.fillRect(left - 1, y - 1, width + 2, 7);
    target.fillStyle = FIXED_COLOURS.fontFill;
    digits.forEach((d, i) => { const bits = NUMBER_FONT[d]; for (let k = 0; k < 15; k++) if (bits[k] === '1') target.fillRect(left + i * 4 + k % 3, y + Math.floor(k / 3), 1, 1); });
  }

  function text(target: CanvasRenderingContext2D, value: string, x: number, y: number, scale: number) {
    let pen = x;
    for (const c of value) {
      if (c === '+') {
        for (const [colour, off] of [[FIXED_COLOURS.fontShade, 1], [FIXED_COLOURS.fontFill, 0]] as const) {
          target.fillStyle = colour;
          PLUS.forEach((row, r) => { for (let k = 0; k < 5; k++) if (row[k] === '#') target.fillRect(pen + (k + 1 + off) * scale, y + (r + 1 + off) * scale, scale, scale); });
        }
      } else if (c !== ' ') blit(target, fixed!, glyphKey(c), pen, y, scale);
      pen += 8 * scale;
    }
    return pen - x;
  }
  const measure = (value: string, scale: number) => value.length * 8 * scale;

  function hud(target: CanvasRenderingContext2D, W: number, H: number) {
    // Un píxel de la letra nunca es menor que un píxel CSS (en el teléfono, DPR 2, salía a medio píxel e ilegible) ni
    // menor que el píxel del arte en pantalla.
    const s = Math.max(1, Math.round(dpr), hudScale, Math.round(Math.min(H / 300, W / 320))), pad = 3 * s;
    const score = input.frame.score;
    const line1 = `${teamTag(input.labels.home)} ${score ? score.home : '-'}-${score ? score.away : '-'} ${teamTag(input.labels.away)}`;
    const line2 = hudText(input.labels.clock, GLYPHS);
    const boxW = Math.max(measure(line1, s), measure(line2, s)) + pad * 2, boxH = 9 * s * 2 + s * 2 + pad * 2;
    // Arriba a la derecha, bajo las pestañas de cámara del armazón y del rótulo de escena del teléfono (≈ 72 px CSS): abajo lo tapa el rótulo de gol de la app.
    // En la Táctica se ve todo el campo y el marcador tapaba un área (en el teléfono, la del gol): va al lado contrario
    // del balón, con histéresis para que no salte de lado a cada pase por el medio.
    const b = input.frame.ball, ballDevice = b && Number.isFinite(b.x) && Number.isFinite(b.y) ? fieldToDevice(b.x, b.y) : null;
    if (!tactical) hudLeft = false;
    else if (ballDevice) { if (ballDevice.x > W * .6) hudLeft = true; else if (ballDevice.x < W * .4) hudLeft = false; }
    const x = Math.round(hudLeft ? 6 * s : W - boxW - 6 * s), y = Math.round(Math.min(72 * dpr, H - boxH - 6 * s));
    // Caja opaca con marco de 1 px lógico: la grada de colores no debe asomar por detrás de las cifras.
    target.fillStyle = FIXED_COLOURS.outline; target.fillRect(x - s, y - s, boxW + 2 * s, boxH + 2 * s);
    target.fillStyle = '#1c1430'; target.fillRect(x, y, boxW, boxH);
    target.fillStyle = FIXED_COLOURS.fontShade; target.fillRect(x, y, boxW, s); target.fillRect(x, y + boxH - s, boxW, s);
    text(target, line1, x + pad, y + pad, s);
    text(target, line2, x + pad + Math.round((boxW - pad * 2 - measure(line2, s)) / 2), y + pad + 9 * s + s * 2, s);
    const cue = input.cue, age = cue && cue.type === 'goal' ? input.frame.clock_ms - cue.t1_ms : -1;
    if (age >= 0 && age < 3000 && (age > 1500 || Math.floor(age / 220) % 2 === 0)) {
      const big = s * 2, word = hudText(input.labels.goal, GLYPHS) || 'GOAL';
      const label = `${word}!`, width = measure(label, big);
      // El rótulo no tapa la portería ni al portero batido: va a la mitad de la pantalla contraria a la del balón (en la
      // Táctica apaisada, la mitad izquierda o derecha, a media altura).
      const ballX = ballDevice ? ballDevice.x : W / 2, ballY = ballDevice ? ballDevice.y : H;
      const across = !!tactical?.landscape;
      const gx = Math.round(across ? Math.max(4 * big, Math.min(W - width - 4 * big, (ballX > W / 2 ? W * .27 : W * .73) - width / 2)) : (W - width) / 2);
      const gy = Math.round(across ? H * .55 : ballY < H / 2 ? H * .6 : H * .3);
      // Caja opaca que abarca también las siglas del equipo (antes quedaban medio fuera, pisando el marco).
      const bx = gx - 4 * big, by = gy - 3 * big, bw = width + 8 * big, bh = 3 * big + 9 * big + 2 * big + 9 * s + 3 * s;
      target.fillStyle = FIXED_COLOURS.outline; target.fillRect(bx - s, by - s, bw + 2 * s, bh + 2 * s);
      target.fillStyle = '#1c1430'; target.fillRect(bx, by, bw, bh);
      target.fillStyle = FIXED_COLOURS.fontShade; target.fillRect(bx, by, bw, s); target.fillRect(bx, by + bh - s, bw, s);
      text(target, label, gx, gy, big);
      const side = cue!.side === 'away' ? input.labels.away : input.labels.home, tag = teamTag(side);
      text(target, tag, Math.round(gx + (width - measure(tag, s)) / 2), gy + 11 * big, s);
    }
  }

  function projection(): PitchProjection {
    const ratioX = (css.width - inset.x * 2) / Math.max(1, canvas.width), ratioY = (css.height - inset.y * 2) / Math.max(1, canvas.height);
    return { viewport: css, projectFieldPoint(x, y) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      const d = fieldToDevice(x, y), px = inset.x + d.x * ratioX, py = inset.y + d.y * ratioY;
      return Number.isFinite(px) && Number.isFinite(py) && px >= 0 && px < css.width && py >= 0 && py < css.height ? { x: px, y: py } : null;
    } };
  }

  async function loadAtlas(): Promise<IndexedImage> {
    const inflate = browserInflate();
    if (inflate) {
      const response = await fetch(atlasUrl, { credentials: 'same-origin' });
      if (!response.ok) throw new Error('atlas');
      return decodeIndexedPng(new Uint8Array(await response.arrayBuffer()), inflate);
    }
    const image = await loadImage(atlasUrl), sheet = document.createElement('canvas');
    sheet.width = image.naturalWidth; sheet.height = image.naturalHeight;
    const c = sheet.getContext('2d')!; c.drawImage(image, 0, 0);
    const data = c.getImageData(0, 0, sheet.width, sheet.height).data;
    return { width: sheet.width, height: sheet.height, indices: indicesFromRgba(data, atlasJson.indexColours) };
  }
  function loadImage(url: string) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image(); image.decoding = 'async';
      image.onload = () => resolve(image); image.onerror = () => reject(new Error('image')); image.src = url;
    });
  }
  if (ctx && bctx) void Promise.all([loadAtlas(), loadImage(pitchUrl)]).then(([indices, stadium]) => {
    if (disposed) return;
    atlas = indices; pitch = stadium; fixed = recolour(buildPaletteLUT(PREVIEW_KIT, PREVIEW_LOOK));
    canvas.dataset.spriteStatus = 'ready'; paint();
  }, () => {
    if (disposed) return;
    canvas.dataset.spriteStatus = 'fallback'; onFailure('assets');
  });
  paint();

  return {
    update(next) { if (!disposed) { input = next; paint(); } return projection(); },
    resize(size, ratio) {
      if (disposed || !(size.width > 0) || !(size.height > 0)) return;
      css = { width: size.width, height: size.height }; dpr = Number.isFinite(ratio) && ratio > 0 ? Math.min(ratio, 3) : 1;
      fitBacking(); paint();
    },
    pickPlayer(point: ScreenPoint) {
      if (disposed || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
      const x = (point.x - inset.x) * canvas.width / Math.max(1, css.width - inset.x * 2), y = (point.y - inset.y) * canvas.height / Math.max(1, css.height - inset.y * 2);
      const hit = [...hits].sort((a, b) => b.depth - a.depth).find(h => x >= h.x0 && x <= h.x1 && y >= h.y0 && y <= h.y1 + 2 * artScale);
      return hit?.key ?? null;
    },
    dispose() {
      if (disposed) return;
      disposed = true; tactical = null; tacticalKey = ''; tacticalField.width = tacticalField.height = 0; looks.clear(); tracks.clear(); officials.clear(); cam = null; atlas = null; pitch = null; fixed = null; hits = [];
      buffer.width = buffer.height = 0;
    },
  };
};
