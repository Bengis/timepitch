import type { AssetSource, AssetSourceKind } from './types';

const KINDS: ReadonlySet<AssetSourceKind> = new Set<AssetSourceKind>([
  'wikipedia', 'wikidata', 'commons', 'hfk', 'statsbomb', 'hand_assigned', 'generic',
]);
const STRING_FIELDS = ['title', 'qid', 'url', 'note'] as const;
const NUMBER_FIELDS = ['revid', 'revision'] as const;

export function isAssetSource(v: unknown): v is AssetSource {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  if (typeof o.kind !== 'string' || !KINDS.has(o.kind as AssetSourceKind)) return false;
  if (typeof o.licence !== 'string' || o.licence.length === 0) return false;
  for (const f of STRING_FIELDS) if (o[f] !== undefined && typeof o[f] !== 'string') return false;
  for (const f of NUMBER_FIELDS) if (o[f] !== undefined && typeof o[f] !== 'number') return false;
  return true;
}

/** Lanza si cualquier clave, a cualquier profundidad, empieza por `tm_` (Transfermarkt: solo investigación privada). */
export function assertNoTransfermarkt(json: unknown, path = '$'): void {
  if (Array.isArray(json)) {
    json.forEach((item, i) => assertNoTransfermarkt(item, `${path}[${i}]`));
    return;
  }
  if (typeof json !== 'object' || json === null) return;
  for (const [key, value] of Object.entries(json)) {
    if (key.startsWith('tm_')) throw new Error(`Transfermarkt field not allowed in web registries: ${path}.${key}`);
    assertNoTransfermarkt(value, `${path}.${key}`);
  }
}
