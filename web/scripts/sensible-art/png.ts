// Codificador PNG mínimo (sin dependencias): indexado de 8 bits con tRNS y RGBA de 8 bits. Sin gAMA/iCCP/sRGB
// para que el navegador no gestione color y los valores lleguen exactos al canvas.
import { deflateSync } from 'node:zlib';

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0); out.write(type, 4, 'ascii'); Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function ihdr(w: number, h: number, colourType: number): Buffer {
  const d = Buffer.alloc(13); d.writeUInt32BE(w, 0); d.writeUInt32BE(h, 4); d[8] = 8; d[9] = colourType; return chunk('IHDR', d);
}
function rows(w: number, h: number, bpp: number, data: Uint8Array): Buffer {
  const raw = Buffer.alloc((w * bpp + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * bpp + 1)] = 0; Buffer.from(data.buffer, data.byteOffset + y * w * bpp, w * bpp).copy(raw, y * (w * bpp + 1) + 1); }
  return deflateSync(raw, { level: 9 });
}

/** `palette`: RGBA por índice (hasta 256). */
export function encodeIndexed(w: number, h: number, indices: Uint8Array, palette: readonly [number, number, number, number][]): Buffer {
  const plte = Buffer.alloc(palette.length * 3), trns = Buffer.alloc(palette.length);
  palette.forEach(([r, g, b, a], i) => { plte[i * 3] = r; plte[i * 3 + 1] = g; plte[i * 3 + 2] = b; trns[i] = a; });
  return Buffer.concat([SIG, ihdr(w, h, 3), chunk('PLTE', plte), chunk('tRNS', trns), chunk('IDAT', rows(w, h, 1, indices)), chunk('IEND', new Uint8Array())]);
}

export function encodeRGBA(w: number, h: number, rgba: Uint8Array | Uint8ClampedArray): Buffer {
  return Buffer.concat([SIG, ihdr(w, h, 6), chunk('IDAT', rows(w, h, 4, new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.length))), chunk('IEND', new Uint8Array())]);
}
