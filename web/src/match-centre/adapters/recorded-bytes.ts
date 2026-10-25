// Lectura verificada de un archivo servido del índice de grabaciones (TP193; compartida con el sidecar TP202):
// tamaño y SHA-256 de los bytes tal como se sirven, gzip opcional y JSON estricto.
import { abortError, guard } from './base';
import { fail, RecordingError } from './recorded-track';

export async function sha256Hex(bytes: ArrayBuffer | Uint8Array<ArrayBuffer>): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function decode(bytes: Uint8Array<ArrayBuffer>, encoding: 'identity' | 'gzip'): Promise<unknown> {
  try {
    const plain = encoding === 'gzip'
      ? new Uint8Array(await new Response(new Response(bytes).body!.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer())
      : bytes;
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plain));
  } catch (error) { throw new RecordingError('decode_failed', error instanceof Error ? error.message : String(error)); }
}

export type ServedFile = Readonly<{ file: string; encoding: 'identity' | 'gzip'; bytes: number; sha256: string }>;
/** Lee `ref.file`, comprueba tamaño y SHA-256 contra el índice y devuelve el JSON decodificado. */
export async function readVerified(ref: ServedFile, read: (file: string, signal: AbortSignal) => Promise<ArrayBuffer>, signal: AbortSignal): Promise<unknown> {
  guard(signal);
  const bytes = new Uint8Array(await read(ref.file, signal));
  if (signal.aborted) throw abortError();
  if (bytes.byteLength !== ref.bytes) fail('size_mismatch', `${ref.file}: ${bytes.byteLength} bytes, index says ${ref.bytes}`);
  if (await sha256Hex(bytes) !== ref.sha256) fail('hash_mismatch', `${ref.file}: SHA-256 differs from the index`);
  const raw = await decode(bytes, ref.encoding);
  guard(signal);
  return raw;
}
