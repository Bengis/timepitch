import { configDefaults,defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { localReplays } from './dev/local-replays.mjs';
import {localSpeechTest} from './dev/local-speech-test.mjs';
import {localSpeechPreview} from './dev/local-speech-preview.mjs';
import {localSummarySpeechPreview} from './dev/local-summary-speech-preview.mjs';
const env=(globalThis as typeof globalThis&{process?:{env:Record<string,string|undefined>}}).process?.env;

export default defineConfig({
  plugins: [react(), localReplays(),localSpeechTest(),localSpeechPreview(),localSummarySpeechPreview()],
  build: { manifest: 'assets/pitch-renderer-manifest.json' },
  server: {
    host: '127.0.0.1',
    strictPort: true,
    // Retro sprite atlas lives in ../assets/art/retro (outside the Vite root); allow only that folder (TP201).
    fs: { allow: ['.', '../assets/art/retro'] },
    proxy: { '/api': 'http://127.0.0.1:8078', '/art': 'http://127.0.0.1:8078' },
  },
  test: { environment: 'jsdom', setupFiles: ['./src/test-setup.ts'], include: ['src/**/*.test.tsx', 'src/**/*.test.ts'],
    exclude:[...configDefaults.exclude,...(env?.TIMEPITCH_ROOT_DIAGNOSTIC_ADMISSION==='TP168-root-diagnostic-1'?[]:['**/root-diagnostic-acceptance.test.ts']),
      ...(env?.TIMEPITCH_ROOT_REFINED_ADMISSION==='TP173-root-refined-diagnostic-2'?[]:['**/root-refined-acceptance.test.ts'])] },
});
