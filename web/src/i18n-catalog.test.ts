// TP266: los catálogos de idioma cubren los textos del código. Importa todos los módulos (cada `defineTexts` registra
// su inglés), recoge las frases `L(locale, 'inglés', 'español')` del código y las notas de la crónica, y comprueba que
// cada catálogo tiene las mismas claves que el inglés y los mismos huecos `{0}`. Con I18N_SOURCE=<fichero> vuelca el
// inglés para `scripts/i18n_translate.py`.
import { describe, expect, it } from 'vitest';
import { LOCALES, REGISTRY } from './i18n-catalog';

const modules = import.meta.glob(['./**/*.ts', './**/*.tsx', '!./**/*.test.ts', '!./**/*.test.tsx', '!./main.tsx', '!./test-setup.ts']);
const sources = import.meta.glob(['./**/*.ts', './**/*.tsx', '!./**/*.test.ts', '!./**/*.test.tsx'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const catalogs = import.meta.glob('./locales/*.json', { eager: true, import: 'default' }) as Record<string, Record<string, Record<string, string>>>;

/** El inglés de un espacio como `ruta → plantilla`: cada función, llamada con `{0}`, `{1}`… */
function flatten(value: unknown, path: string, out: Record<string, string>) {
  if (typeof value === 'string') out[path] = value;
  else if (typeof value === 'function') {
    const fn = value as (...args: string[]) => unknown;
    try {  // a function that needs a list or a number stays in English (defineTexts keeps it when the key is missing)
      const text = fn(...Array.from({ length: Math.max(fn.length, 0) }, (_, i) => `{${i}}`));
      if (typeof text === 'string' && fn.length > 0) out[path] = text;
    } catch { /* not a plain template */ }
  } else if (Array.isArray(value)) value.forEach((v, i) => flatten(v, `${path}.${i}`, out));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) flatten(v, path ? `${path}.${k}` : k, out);
}

async function englishSource(): Promise<Record<string, Record<string, string>>> {
  for (const load of Object.values(modules)) await load();
  const out: Record<string, Record<string, string>> = {};
  for (const [ns, en] of REGISTRY) { out[ns] = {}; flatten(en, '', out[ns]); }
  const phrases: Record<string, string> = {};
  const call = /\bL\(\s*[\w.]+\s*,\s*'((?:[^'\\]|\\.)*)'\s*,\s*'(?:[^'\\]|\\.)*'\s*\)/g;
  for (const text of Object.values(sources)) for (const m of text.matchAll(call)) phrases[m[1].replace(/\\'/g, "'")] = m[1].replace(/\\'/g, "'");
  out.phrases = phrases;
  const { NOTES_ES } = await import('./match-centre/CrewReportPanel');
  out['crew-notes'] = Object.fromEntries(Object.keys(NOTES_ES).map(n => [n, n]));
  return out;
}

const holes = (text: string) => [...text.matchAll(/\{\d+\}/g)].map(m => m[0]).sort().join(',');

describe('language catalogues (TP266)', () => {
  it('every catalogue matches the English source: same keys and the same {n} holes', async () => {
    const source = await englishSource();
    const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env;
    if (env?.I18N_SOURCE) {
      const fsName = 'node:fs';
      const fs = await import(/* @vite-ignore */ fsName) as { writeFileSync(p: string, d: string): void };
      fs.writeFileSync(env.I18N_SOURCE, JSON.stringify(source, null, 1));
    }
    expect(Object.keys(source).length).toBeGreaterThan(20);
    for (const [path, catalog] of Object.entries(catalogs)) {
      const code = path.slice(path.lastIndexOf('/') + 1, -5);
      expect(LOCALES.map(l => l.code as string), code).toContain(code);
      for (const [ns, entries] of Object.entries(catalog)) {
        for (const [key, text] of Object.entries(entries)) {
          const english = source[ns]?.[key];
          if (english === undefined) continue; // a key the code no longer has: harmless, removed on the next run
          expect(holes(text), `${code} ${ns}.${key}`).toBe(holes(english));
        }
      }
    }
  });
});
