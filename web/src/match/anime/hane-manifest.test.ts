// Procedencia de los retratos generados de Capitán Hane (TP235): el manifiesto versionado coincide con los ficheros,
// los prompts no nombran a ningún jugador ni club (solo rasgos del avatar) y cada imagen tiene veredicto de revisión.
import { describe, expect, it } from 'vitest';
import { artIndex, HANE_SITUATIONS, type HaneManifest } from './hane-art';

// La app no carga los tipos de Node (tsconfig: solo vite/client y vitest): las APIs de Node se cargan con un
// especificador dinámico y un tipo mínimo, y las rutas son URL de fichero relativas a este test.
type Dirent = { name: string; isDirectory(): boolean };
type Fs = { readFileSync(p: URL): Uint8Array & { toString(enc: string): string }; existsSync(p: URL): boolean; statSync(p: URL): { size: number };
  readdirSync(p: URL): string[]; readdirSync(p: URL, o: { withFileTypes: true }): Dirent[] };
type Crypto = { createHash(a: string): { update(b: Uint8Array): { digest(e: 'hex'): string } } };
const load = (specifier: string) => import(/* @vite-ignore */ specifier);
const fs = await load('node:fs') as Fs, nodeCrypto = await load('node:crypto') as Crypto;

const nodeUrl = await load('node:url') as { pathToFileURL(p: string): URL }, proc = await load('node:process') as { cwd(): string };
// Vitest corre con la raíz en web/ (con jsdom, import.meta.url no es una URL de fichero).
const WEB = nodeUrl.pathToFileURL(`${proc.cwd()}/`);
const HANE = new URL('public/assets/hane/', WEB);
const ORIGINALS = new URL('../.local/hane-originals/', WEB);
const manifest = JSON.parse(fs.readFileSync(new URL('manifest.json', HANE)).toString('utf8')) as HaneManifest;
const sha256 = (path: URL) => nodeCrypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex');
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Nombres de las plantillas de la demo (fichas públicas) + clubes, estadios, apodos y la grafía de la fuente. */
function forbiddenWords(): string[] {
  const words = new Set<string>(['arsenal', 'manchester', 'city', 'gunners', 'citizens', 'cityzens', 'highbury', 'etihad', 'premier', 'patrik', 'emirates', 'fly emirates', 'etihad airways']);
  for (const team of ['arsenal-2003', 'mancity-2024']) {
    const squad = JSON.parse(fs.readFileSync(new URL(`public/data/players/${team}.json`, WEB)).toString('utf8')) as { players: { display: string }[] };
    for (const p of squad.players) {
      words.add(fold(p.display));
      for (const token of fold(p.display).split(/[\s-]+/)) if (token.length >= 3) words.add(token);
    }
  }
  return [...words];
}

describe('Capitán Hane portraits manifest (TP235)', () => {
  it('declares the model, the deployment and one reviewed image per player and situation', () => {
    expect(manifest.schema).toBe('hane-portraits-1');
    expect(manifest.model).toBe('FLUX.2-pro');
    expect(manifest.deployment).toBe('flux-2-pro');
    expect(manifest.images.length).toBeGreaterThan(0);
    expect(artIndex(manifest).size).toBe(manifest.images.length);
    for (const img of manifest.images) {
      expect(HANE_SITUATIONS).toContain(img.situation);
      expect(img.file).toMatch(new RegExp(`^(arsenal-2003|mancity-2024)/[a-z0-9]+-${img.situation}\\.webp$`));
      expect(img.verdict).toMatch(/^accepted/);
      expect(img.seed === null && img.requestId === null).toBe(false);
    }
  });

  it('prompts contain no player, club or stadium names (only avatar traits)', () => {
    const banned = forbiddenWords();
    expect(banned).toContain('henry');
    expect(banned).toContain('haaland');
    for (const img of manifest.images) {
      const text = ` ${fold(img.prompt).replace(/[^a-z0-9]+/g, ' ')} `;
      for (const word of banned) expect(text.includes(` ${word} `), `${img.file}: «${word}»`).toBe(false);
    }
  });

  it('every WebP matches its hash and no unlisted image is shipped', () => {
    const listed = new Set(manifest.images.map(i => i.file));
    for (const img of manifest.images) {
      const path = new URL(img.file, HANE);
      expect(fs.existsSync(path), img.file).toBe(true);
      expect(sha256(path), img.file).toBe(img.sha256Webp);
      expect(fs.statSync(path).size).toBeLessThan(260_000);
    }
    const shipped = fs.readdirSync(HANE, { withFileTypes: true }).filter(d => d.isDirectory())
      .flatMap(d => fs.readdirSync(new URL(`${d.name}/`, HANE)).map(f => `${d.name}/${f}`));
    expect(shipped.sort()).toEqual([...listed].sort());
  });

  // Los PNG originales no se versionan (.local/hane-originals); si están en este equipo, también se comprueban.
  it.runIf(fs.existsSync(ORIGINALS))('original PNG hashes match when the local originals are present', () => {
    for (const img of manifest.images) {
      const original = img.original;
      expect(original, img.file).toBeTruthy();
      const path = new URL(original!, ORIGINALS);
      if (fs.existsSync(path)) expect(sha256(path), original).toBe(img.sha256Png);
    }
  });
});
