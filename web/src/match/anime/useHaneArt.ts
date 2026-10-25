// Carga a demanda de los retratos generados de Capitán Hane (TP235): solo con el modo activo, primero el manifiesto
// y luego únicamente las imágenes de los jugadores de ESTE partido. Una imagen solo se usa cuando ya cargó; mientras
// tanto (o si falla) la escena dibuja el primer plano SVG.
import { useEffect, useMemo, useState } from 'react';
import type { PlayerView } from '../../match-centre/session';
import { artIndex, haneUrl, matchArtFiles, type ArtLookup, type HaneManifest } from './hane-art';

const sourceKeyOf = (p: PlayerView) => typeof p.details?.sourceKey === 'string' ? p.details.sourceKey : null;
const base = () => import.meta.env.BASE_URL ?? '/';

export function useHaneArt(active: boolean, players: readonly PlayerView[]): ArtLookup | null {
  const [manifest, setManifest] = useState<HaneManifest | null>(null);
  const [loaded, setLoaded] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    if (!active || manifest) return;
    const controller = new AbortController();
    fetch(haneUrl(base(), 'manifest.json'), { signal: controller.signal })
      .then(r => r.ok ? r.json() as Promise<HaneManifest> : null)
      .then(m => { if (!controller.signal.aborted && m) setManifest(m); }, () => { /* sin manifiesto: todo SVG */ });
    return () => controller.abort();
  }, [active, manifest]);

  const index = useMemo(() => artIndex(manifest), [manifest]);
  const keyById = useMemo(() => new Map(players.flatMap(p => { const k = sourceKeyOf(p); return k ? [[p.id, k] as const] : []; })), [players]);
  const files = useMemo(() => matchArtFiles(index, keyById.values()).join('\n'), [index, keyById]);

  useEffect(() => {
    if (!active || !files || typeof Image === 'undefined') return;
    let live = true;
    for (const file of files.split('\n')) {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => { if (live) setLoaded(prev => prev.has(file) ? prev : new Set(prev).add(file)); };
      img.src = haneUrl(base(), file);
    }
    return () => { live = false; };
  }, [active, files]);

  return useMemo(() => {
    if (!active || index.size === 0) return null;
    return (playerId, situation) => {
      const key = playerId ? keyById.get(playerId) : undefined, file = key ? index.get(`${key}|${situation}`) : undefined;
      return file && loaded.has(file) ? haneUrl(base(), file) : null;
    };
  }, [active, index, keyById, loaded]);
}
