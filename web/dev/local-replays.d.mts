import type { Plugin } from 'vite';
/** Sirve `.local/replays-dist` (o `TIMEPITCH_REPLAYS_DIR`) bajo /replays/ solo en `vite dev`. */
export function localReplays(dir?: string): Plugin;
