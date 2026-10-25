// Muestras PNG de las escenas de Capitán Hane (TP234). Uso (desde web/):
//   node scripts/anime-samples/render.ts [carpeta]
// Carga el generador real por Vite (`runnerImport`: sin servidor ni puerto) y rasteriza cada SVG con Microsoft Edge
// vía Playwright (canal msedge, como playwright.config.ts; sin descargar navegadores) y la red bloqueada: el SVG no
// referencia nada externo. Por defecto escribe en ../.local/anime-samples/.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';
import { chromium } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = resolve(HERE, '..', '..');
const OUT = resolve(process.argv[2] ?? resolve(WEB, '..', '.local/anime-samples'));

type Built = { build(): { samples: { file: string; svg: string; width?: number; height?: number }[]; summary: Record<string, unknown>[] } };
const { module } = await runnerImport<Built>(resolve(HERE, 'samples.ts'), { root: WEB, configFile: false, logLevel: 'error' });
const { samples, summary } = module.build();
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge' });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.route('**/*', route => route.abort());
  for (const s of samples) {
    const width = s.width ?? 1600, height = s.height ?? 900;
    await page.setContent(`<!doctype html><html><body style="margin:0;background:#000">${s.svg.replace('<svg ', `<svg width="${width}" height="${height}" `)}</body></html>`);
    writeFileSync(resolve(OUT, s.file), await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width, height } }));
  }
} finally { await browser.close(); }
writeFileSync(resolve(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
console.log(`${samples.length} PNG -> ${OUT}`);
