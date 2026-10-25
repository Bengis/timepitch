// Solo en `vite dev`: sirve las grabaciones `.json.gz` (fuera de git) bajo /replays/ tal cual, sin Content-Encoding,
// porque el índice guarda el SHA-256 de esos bytes (TP193). Carpeta: TIMEPITCH_REPLAYS_DIR o ../.local/replays-dist.
// En JS para no añadir @types/node al proyecto; tipos en local-replays.d.mts.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SAFE = /^[\w./-]+\.json\.gz$/;

export function localReplays(dir = process.env.TIMEPITCH_REPLAYS_DIR) {
  const root = resolve(dir ?? fileURLToPath(new URL('../../.local/replays-dist', import.meta.url)));
  return {
    name: 'timepitch-local-replays', apply: 'serve',
    configureServer(server) {
      if (!existsSync(root)) return;
      server.middlewares.use('/replays/', (req, res, next) => {
        let path;
        try { path = decodeURIComponent((req.url ?? '').split('?')[0]).replace(/^\/+/, ''); } catch { return next(); }
        const file = resolve(root, path);
        if (!SAFE.test(path) || path.includes('..') || !file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) return next();
        if (req.method !== 'GET' && req.method !== 'HEAD') { res.statusCode = 405; res.end(); return; }
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Length', String(statSync(file).size));
        res.setHeader('Cache-Control', 'no-cache');
        if (req.method === 'HEAD') { res.end(); return; }
        createReadStream(file).pipe(res);
      });
    },
  };
}
