import { beforeAll, describe, expect, it } from 'vitest';
import registry from './crests-hd.json';
import historical from './historical-crests.json';
import { resolveHistoricalCrest } from './crests';
import { CREST_HD_BASE, createCrestResolver, crestChain, resolveCrest, sanitizeSvgText, type CrestHdRegistry } from './crest-resolver';
import { assertNoTransfermarkt, isAssetSource } from '../presentation/registry-schema';

const eras = (registry as unknown as CrestHdRegistry).eras;
const seasons = historical.seasons as Record<string, string>;
const RESERVED = ['arsenal-1990', 'swindon-1991', 'wimbledon-1981'];
const keysOf = (eraId: string) => Object.keys(seasons).filter((k) => seasons[k] === eraId);

describe('resolveCrest: HD revisado → HFK → neutro', () => {
  it('uses the reviewed HD SVG with its file page and licence', () => {
    const ref = resolveCrest('arsenal:2010');
    expect(ref.kind).toBe('hd');
    expect(ref.src).toBe('/assets/crests-hd/arsenal-2002.svg');
    expect(ref.source).toEqual({ kind: 'wikipedia', title: 'File:Arsenal FC.svg', url: 'https://en.wikipedia.org/wiki/File:Arsenal_FC.svg', licence: 'Fair use' });
  });

  it('keeps every Chelsea season on HFK (no candidate)', () => {
    const chelsea = Object.keys(seasons).filter((k) => k.startsWith('chelsea:'));
    expect(chelsea.length).toBeGreaterThan(0);
    for (const key of chelsea) {
      const ref = resolveCrest(key);
      expect(ref.kind, key).toBe('hfk');
      expect(ref.src, key).toBe(resolveHistoricalCrest(key)!.src);
      expect(ref.source).toMatchObject({ kind: 'hfk', url: 'https://www.historicalkits.co.uk/Chelsea/Chelsea.htm' });
    }
  });

  it('keeps the three reserved eras and the rejected ones on HFK', () => {
    for (const eraId of [...RESERVED, 'arsenal-1994', 'arsenal-1998', 'burnley-2010', 'derby-2007', 'ipswich-2016', 'middlesbrough-1987', 'portsmouth-2008', 'tottenham-2006', 'watford-1979']) {
      expect(eras[eraId], eraId).toBeUndefined();
      const keys = keysOf(eraId);
      expect(keys.length, eraId).toBeGreaterThan(0);
      for (const key of keys) expect(resolveCrest(key).kind, key).toBe('hfk');
    }
    expect(resolveCrest('arsenal:1992').src).toBe('/assets/crests/arsenal-1990.gif');
  });

  it('records that Manchester United 1998 and 2010 share one SVG', () => {
    const a = resolveCrest('manunited:1999'), b = resolveCrest('manunited:2015');
    expect(a.kind).toBe('hd');
    expect(a.src).toBe(b.src);
    expect(eras['manunited-2010'].shares_file_with).toBe('manunited-1998');
    expect(resolveCrest('manunited:2007').kind).toBe('hfk');
  });

  it('keeps the Arsenal 2024 cannon (HFK tier) with its own provenance', () => {
    const ref = resolveCrest('arsenal:2024');
    expect(ref.kind).toBe('hfk');
    expect(ref.src).toBe('/assets/crests/arsenal-2024.png');
    expect(ref.source?.url).toMatch(/^https:\/\/news\.adidas\.com\//);
  });

  it('returns the neutral crest for unknown or malformed keys', () => {
    for (const key of ['unknown:1999', 'arsenal:2050', 'afcwimbledon:1999', 'arsenal:2003junk', ''])
      expect(resolveCrest(key)).toEqual({ kind: 'none', src: '', source: null });
  });

  it('never shows an entry with reviewed:false and validates sources', () => {
    const source = { kind: 'wikipedia', title: 'File:X.svg', url: 'https://en.wikipedia.org/wiki/File:X.svg', licence: 'Fair use' } as const;
    const entry = { eraId: 'arsenal-2002', file: 'arsenal-2002.svg', sha256: 'x', bytes: 1, upload_url: 'https://upload.wikimedia.org/x', source };
    const reviewed = createCrestResolver({ eras: { 'arsenal-2002': { ...entry, reviewed: true } } });
    expect(reviewed('arsenal:2010')).toMatchObject({ kind: 'hd', src: `${CREST_HD_BASE}arsenal-2002.svg` });
    const pending = createCrestResolver({ eras: { 'arsenal-2002': { ...entry, reviewed: false } } });
    expect(pending('arsenal:2010').kind).toBe('hfk');
    const badSource = createCrestResolver({ eras: { 'arsenal-2002': { ...entry, reviewed: true, source: { kind: 'foto' } as never } } });
    expect(badSource('arsenal:2010').kind).toBe('hfk');
    const traversal = createCrestResolver({ eras: { 'arsenal-2002': { ...entry, reviewed: true, file: '../x.svg' } } });
    expect(traversal('arsenal:2010').kind).toBe('hfk');
  });

  it('exposes the fallback chain HD then HFK', () => {
    expect(crestChain('arsenal:2010').map((c) => c.kind)).toEqual(['hd', 'hfk']);
    expect(crestChain('chelsea:2015').map((c) => c.kind)).toEqual(['hfk']);
    expect(crestChain('unknown:1999')).toEqual([]);
  });
});

describe('crests-hd.json (decisión D6)', () => {
  it('holds exactly the 38 accepted eras (331 seasons), all reviewed and valid', () => {
    const ids = Object.keys(eras);
    expect(ids).toHaveLength(38);
    expect(ids.reduce((n, id) => n + keysOf(id).length, 0)).toBe(331);
    assertNoTransfermarkt(registry);
    const assets = historical.assets as Record<string, unknown>;
    for (const [id, e] of Object.entries(eras)) {
      expect(e.eraId, id).toBe(id);
      expect(Object.hasOwn(assets, id), id).toBe(true);
      expect(e.reviewed, id).toBe(true);
      expect(isAssetSource(e.source), id).toBe(true);
      expect(e.source.kind, id).toBe('wikipedia');
      expect(e.source.title, id).toMatch(/^File:.+\.svg$/);
      expect(e.source.url, id).toMatch(/^https:\/\/en\.wikipedia\.org\/wiki\/File:/);
      expect(['Fair use', 'PD'], id).toContain(e.source.licence);
      expect(e.upload_url, id).toMatch(/^https:\/\/upload\.wikimedia\.org\/wikipedia\/en\//);
      expect(e.sha256, id).toMatch(/^[0-9a-f]{64}$/);
      expect(e.file, id).toMatch(/^[a-z0-9-]+\.svg$/);
      if (!e.shares_file_with) expect(e.file, id).toBe(`${id}.svg`);
      else expect(e.file, id).toBe(eras[e.shares_file_with].file);
    }
    for (const id of RESERVED) expect(ids).not.toContain(id);
    expect(ids.some((id) => id.startsWith('chelsea-'))).toBe(false);
  });
});

describe('public/assets/crests-hd files', () => {
  type Fs = { readFileSync(p: string): Uint8Array & { toString(enc: string): string }; existsSync(p: string): boolean; readdirSync(p: string): string[] };
  type Crypto = { createHash(a: string): { update(b: Uint8Array): { digest(e: 'hex'): string } } };
  let fs: Fs, crypto: Crypto, dir: string;
  beforeAll(async () => {
    const fsName = 'node:fs', cryptoName = 'node:crypto', processName = 'node:process';
    fs = await import(/* @vite-ignore */ fsName) as Fs;
    crypto = await import(/* @vite-ignore */ cryptoName) as Crypto;
    const proc = await import(/* @vite-ignore */ processName) as { cwd(): string };
    dir = `${proc.cwd()}/public/assets/crests-hd`;
  });

  it('every registered file exists, matches its SHA256 and size, and is clean', () => {
    for (const [id, e] of Object.entries(eras)) {
      const path = `${dir}/${e.file}`;
      expect(fs.existsSync(path), id).toBe(true);
      const bytes = fs.readFileSync(path);
      expect(crypto.createHash('sha256').update(bytes).digest('hex'), id).toBe(e.sha256);
      expect(bytes.length, id).toBe(e.bytes);
      const text = bytes.toString('utf8');
      expect(sanitizeSvgText(text), id).toEqual({ ok: true });
      expect(text, id).not.toMatch(/<script|foreignObject|\son[a-z]+\s*=|<!DOCTYPE|<!ENTITY/i);
    }
  });

  it('serves no unregistered file', () => {
    const used = new Set(Object.values(eras).map((e) => e.file));
    expect(fs.readdirSync(dir).filter((f) => !used.has(f))).toEqual([]);
    expect(used.size).toBe(37);
  });
});

describe('sanitizeSvgText', () => {
  it('rejects active or external content', () => {
    for (const svg of [
      '<svg><script/></svg>',
      '<svg><SCRIPT>alert(1)</SCRIPT></svg>',
      '<svg><foreignObject><div/></foreignObject></svg>',
      '<svg onload="x()"></svg>',
      '<svg><g onclick = "x()"/></svg>',
      '<svg><image href="http://evil/x.png"/></svg>',
      '<svg><use xlink:href="https://evil/x.svg#a"/></svg>',
      '<svg><use href="//evil/x.svg#a"/></svg>',
      '<svg xmlns:x="http://www.w3.org/1999/xlink"><use x:href="https://evil/x.svg#a"/></svg>',
      '<svg><a href="javascript:alert(1)"/></svg>',
      '<svg><image href="data:image/svg+xml;base64,AAAA"/></svg>',
      '<svg><rect style="fill:url(http://evil/p)"/></svg>',
      '<svg><style>@import "http://evil/x.css";</style></svg>',
      '<!DOCTYPE svg [<!ENTITY a "b">]><svg/>',
      '<svg><iframe/></svg>',
    ]) expect(sanitizeSvgText(svg).ok, svg).toBe(false);
  });

  it('accepts a clean SVG with internal references and embedded rasters', () => {
    expect(sanitizeSvgText('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><defs><linearGradient id="g"/></defs><rect fill="url(#g)" opacity="0.5"/><use xlink:href="#g"/><image href="data:image/png;base64,AAAA"/></svg>')).toEqual({ ok: true });
  });
});
