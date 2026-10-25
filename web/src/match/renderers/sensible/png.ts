// Lectura de los ÍNDICES del atlas indexado (PNG tipo 3, 8 bits, sin entrelazar) sin pasar por un lienzo: así una
// protección anti-huella del navegador que altere `getImageData` no puede cambiar ningún índice. La descompresión la
// pone quien llama (`DecompressionStream('deflate')` en el navegador, `zlib` en las pruebas).

export type IndexedImage = Readonly<{ width: number; height: number; indices: Uint8Array }>;
export type Inflate = (zlib: Uint8Array) => Promise<Uint8Array>;

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/** Separa cabecera y datos IDAT concatenados. Lanza si no es un PNG indexado de 8 bits sin entrelazar. */
export function readIndexedChunks(bytes: Uint8Array): Readonly<{ width: number; height: number; data: Uint8Array }> {
  if (bytes.length < 33 || SIGNATURE.some((b, i) => bytes[i] !== b)) throw new Error('png: firma no válida');
  const u32 = (o: number) => ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0;
  let offset = 8, width = 0, height = 0;
  const parts: Uint8Array[] = [];
  while (offset + 8 <= bytes.length) {
    const length = u32(offset), type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    if (body.length !== length) throw new Error('png: bloque truncado');
    if (type === 'IHDR') {
      width = u32(offset + 8); height = u32(offset + 12);
      if (body[8] !== 8 || body[9] !== 3 || body[12] !== 0) throw new Error('png: se esperaba indexado de 8 bits sin entrelazar');
    } else if (type === 'IDAT') parts.push(body);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  if (!width || !height || !parts.length) throw new Error('png: sin datos');
  const data = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { data.set(p, at); at += p.length; }
  return { width, height, data };
}

/** Deshace los filtros de fila de PNG para 1 byte por píxel. */
export function unfilter(raw: Uint8Array, width: number, height: number): Uint8Array {
  const stride = width + 1;
  if (raw.length < stride * height) throw new Error('png: datos incompletos');
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * stride], row = y * width, src = y * stride + 1;
    for (let x = 0; x < width; x++) {
      const value = raw[src + x];
      const a = x > 0 ? out[row + x - 1] : 0, b = y > 0 ? out[row - width + x] : 0, c = x > 0 && y > 0 ? out[row - width + x - 1] : 0;
      let predicted = 0;
      switch (filter) {
        case 0: predicted = 0; break;
        case 1: predicted = a; break;
        case 2: predicted = b; break;
        case 3: predicted = (a + b) >> 1; break;
        case 4: { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); predicted = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; break; }
        default: throw new Error('png: filtro desconocido');
      }
      out[row + x] = (value + predicted) & 255;
    }
  }
  return out;
}

export async function decodeIndexedPng(bytes: Uint8Array, inflate: Inflate): Promise<IndexedImage> {
  const { width, height, data } = readIndexedChunks(bytes);
  return { width, height, indices: unfilter(await inflate(data), width, height) };
}

/** Inflado zlib del navegador. `null` si no hay `DecompressionStream` (se usa entonces la vía del lienzo). */
export function browserInflate(): Inflate | null {
  if (typeof DecompressionStream === 'undefined') return null;
  return async zlib => {
    const stream = new Blob([zlib as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  };
}

/** Vía de respaldo: colores de un lienzo → índices, con la tabla `indexColours` del atlas (un color por índice). */
export function indicesFromRgba(rgba: Uint8ClampedArray, colours: Readonly<Record<string, string>>): Uint8Array {
  const lookup = new Map<number, number>();
  for (const [index, hex] of Object.entries(colours)) lookup.set(parseInt(hex.slice(1), 16), Number(index));
  const out = new Uint8Array(rgba.length / 4);
  for (let p = 0; p < out.length; p++) {
    const o = p * 4;
    out[p] = rgba[o + 3] === 0 ? 0 : lookup.get((rgba[o] << 16) | (rgba[o + 1] << 8) | rgba[o + 2]) ?? 0;
  }
  return out;
}
