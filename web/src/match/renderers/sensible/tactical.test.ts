import { describe, expect, it } from 'vitest';
import { GENERIC_KITS } from './looks';
import { TACTICAL_COLOURS, TACTICAL_PPM, tacticalLayout, tacticalPitch, tacticalPoint, tacticalToDevice, officialTokenSize, tokenNumber, tokenPixels, tokenSize } from './tactical';

describe('vista Táctica en píxel (TP222)', () => {
  it('escala entera, sin suavizado posible: un píxel de arte mide al menos 2 px CSS y el campo cabe', () => {
    for (const [w, h, dpr] of [[1100, 560, 1], [1440, 900, 1], [780, 520, 2], [1170, 1500, 3], [390, 844, 1], [384, 256, 1]] as const) {
      const l = tacticalLayout(w, h, dpr);
      expect(Number.isInteger(l.scale) && l.scale >= 1, `${w}x${h}`).toBe(true);
      expect(TACTICAL_PPM).toContain(l.ppm);
      if (w >= 390 && w !== 780) expect(l.scale / dpr).toBeGreaterThanOrEqual(2);
      expect(l.w * l.scale).toBeLessThanOrEqual(w); expect(l.h * l.scale).toBeLessThanOrEqual(h);
      expect(l.ox).toBeGreaterThanOrEqual(0); expect(l.oy).toBeGreaterThanOrEqual(0);
    }
    // Si no cabe a 2 px CSS por píxel, baja la escala pero sigue siendo entera.
    expect(tacticalLayout(780, 520, 2)).toMatchObject({ ppm: 2, scale: 3 });
    expect(tacticalLayout(1440, 700).landscape).toBe(true);
    expect(tacticalLayout(390, 700).landscape).toBe(false);
  });
  it('apaisado: largo en horizontal; vertical: portería x = 105 arriba e y = 68 a la derecha, como el seguimiento', () => {
    const l = tacticalLayout(1440, 700), p = tacticalLayout(390, 800);
    expect(tacticalPoint(l, 105, 34).x).toBeGreaterThan(tacticalPoint(l, 0, 34).x);
    expect(tacticalPoint(p, 105, 34).y).toBeLessThan(tacticalPoint(p, 0, 34).y);
    expect(tacticalPoint(p, 52.5, 68).x).toBeGreaterThan(tacticalPoint(p, 52.5, 0).x);
    // El centro del campo cae en el píxel central de la capa.
    for (const layout of [l, p]) {
      const c = tacticalPoint(layout, 52.5, 34);
      expect(c).toEqual({ x: (layout.w - 1) / 2, y: (layout.h - 1) / 2 });
      expect(tacticalToDevice(layout, c.x, c.y).x).toBe(layout.ox + c.x * layout.scale);
    }
  });
  it('campo con la paleta fija (sin antialiasing), simétrico y con las líneas en su sitio', () => {
    const allowed = new Set(Object.values(TACTICAL_COLOURS).map(c => c.join(',')));
    for (const ppm of TACTICAL_PPM) for (const landscape of [true, false]) {
      const img = tacticalPitch({ ppm, landscape }), { width: W, height: H, data } = img;
      expect(data.length).toBe(W * H * 4);
      const at = (x: number, y: number) => { const i = (y * W + x) * 4; return [data[i], data[i + 1], data[i + 2]].join(','); };
      // Comprobaciones píxel a píxel acumuladas (un `expect` por píxel tarda demasiado a 6 px/m).
      let foreign = 0, asymmetric = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i + 3] !== 255 || !allowed.has(`${data[i]},${data[i + 1]},${data[i + 2]}`)) foreign++;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (at(x, y) !== at(W - 1 - x, y) || at(x, y) !== at(x, H - 1 - y)) asymmetric++;
      expect({ foreign, asymmetric }).toEqual({ foreign: 0, asymmetric: 0 });
      const line = TACTICAL_COLOURS.line.join(','), layout = { ...tacticalLayout(1000, 1000), ppm, landscape };
      const px = (x: number, y: number) => { const p = tacticalPoint(layout, x, y); return at(Math.round(p.x), Math.round(p.y)); };
      expect(px(52.5, 34)).toBe(line);   // punto central
      expect(px(52.5, 10)).toBe(line);   // medio campo
      expect(px(0, 20)).toBe(line);      // línea de meta
      expect(px(30, 0)).toBe(line);      // banda
      expect(px(16.5, 34)).toBe(line);   // frontal del área
      expect(px(11, 34)).toBe(line);     // punto de penalti
      expect(px(30, 30)).not.toBe(line); // césped
    }
  });
  it('fichas: disco con contorno, camiseta y pantalón; raya de la equipación si la tiene', () => {
    for (const ppm of TACTICAL_PPM) expect(tokenSize(ppm) % 2).toBe(1);
    expect(tokenNumber('23', GENERIC_KITS.home, tokenSize(4))).not.toBeNull(); // dos cifras desde 4 px/m
    const t = tokenPixels(GENERIC_KITS.home, 5);
    expect(t.map(r => r.map(c => c === null ? '.' : c === GENERIC_KITS.home.shirt ? 'S' : c === GENERIC_KITS.home.shorts ? 's' : '#').join(''))).toEqual(
      ['.###.', '#SSS#', '#SSS#', '#sss#', '.###.']);
    const striped = tokenPixels({ ...GENERIC_KITS.away, trim: '#ffffff', pattern: { body: 'stripes' } }, 7);
    expect(striped[2]).toContain('#ffffff');
  });
  it('dorsal dentro de la ficha solo si es conocido y cabe; nunca se inventa', () => {
    expect(tokenNumber(null, GENERIC_KITS.home, 11)).toBeNull();
    expect(tokenNumber('', GENERIC_KITS.home, 11)).toBeNull();
    expect(tokenNumber('7', GENERIC_KITS.home, 5)).toBeNull();
    expect(tokenNumber('14', GENERIC_KITS.home, 9)).toBeNull();
    expect(tokenNumber('7', GENERIC_KITS.home, 7)).toBeNull(); // pegado al contorno no se lee
    const seven = tokenNumber('7', GENERIC_KITS.home, 9)!;
    expect(seven.pixels.length).toBe([...'111001010010010'].filter(b => b === '1').length);
    expect(seven.plate).toBeNull();
    // Pulido 2: desde 4 px/m la ficha mide 11 px y las dos cifras dejan un píxel de camiseta entre ellas y el contorno,
    // por encima del pantalón.
    expect(tokenSize(4)).toBe(11);
    const d = tokenSize(4), grid = tokenPixels(GENERIC_KITS.home, d);
    for (const [x, y] of tokenNumber('14', GENERIC_KITS.home, d)!.pixels) {
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) expect(grid[ny][nx]).not.toBe('#140c1c');
      expect(grid[y][x]).toBe(GENERIC_KITS.home.shirt);
    }
  });
  it('dorsal táctico con placa en camisetas con rayas; rombo de árbitro menor que la ficha', () => {
    const striped = { ...GENERIC_KITS.away, trim: '#ffffff', pattern: { body: 'stripes' as const } };
    const n = tokenNumber('10', striped, 11)!;
    expect(n.plate).toEqual([1, 3, 9, 5]);
    expect(n.plateFill).toBe(striped.shirt);
    expect(officialTokenSize(2)).toBe(3);
    expect(officialTokenSize(4)).toBe(7);
  });
});
