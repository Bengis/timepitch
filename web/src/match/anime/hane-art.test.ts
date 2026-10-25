import { describe, expect, it } from 'vitest';
import { artIndex, matchArtFiles, NO_ART, sceneArt, situationsFor, type ArtLookup, type HaneManifest, type HaneSituation } from './hane-art';
import type { CutIn } from './cutins';
import { cutInSvg, safeArt, type CutInSpec } from './scene';
import { concedingKeeper, specFor } from './spec';
import { GENERIC_APPEARANCE } from '../../presentation/types';
import { NEUTRAL_KIT } from '../../presentation/avatar/portrait-svg';
import type { EventView, PlayerView } from '../../match-centre/session';

const image = (sourceKey: string, situation: HaneSituation, file: string) => ({ sourceKey, qid: null, situation, file, prompt: 'p', seed: 1,
  requestId: null, sha256Png: 'a', sha256Webp: 'b', verdict: 'accepted' });
const manifest = (images: HaneManifest['images']): HaneManifest => ({ schema: 'hane-portraits-1', model: 'FLUX.2-pro', deployment: 'flux-2-pro',
  provider: 'Azure AI Foundry', generated: '2026-10-24', images });

describe('Capitán Hane generated portraits: manifest index', () => {
  it('indexes by source key and situation and drops malformed entries', () => {
    const idx = artIndex(manifest([
      image('epldata:2003:arsenal:HENRYT', 'charge', 'arsenal-2003/henryt-charge.webp'),
      image('x', 'charge', '../secret.webp'), image('y', 'charge', 'a/b.png'), image('z', 'wave' as HaneSituation, 'a/z-wave.webp'),
    ]));
    expect([...idx.entries()]).toEqual([['epldata:2003:arsenal:HENRYT|charge', 'arsenal-2003/henryt-charge.webp']]);
    expect(artIndex(null).size).toBe(0);
    expect(artIndex({ ...manifest([]), schema: 'other' } as unknown as HaneManifest).size).toBe(0);
  });
  it('lists only the files of the players in this match', () => {
    const idx = artIndex(manifest([image('A', 'charge', 't/a-charge.webp'), image('A', 'lament', 't/a-lament.webp'), image('B', 'dive', 't/b-dive.webp')]));
    expect(matchArtFiles(idx, ['A'])).toEqual(['t/a-charge.webp', 't/a-lament.webp']);
    expect(matchArtFiles(idx, ['C'])).toEqual([]);
  });
});

describe('Capitán Hane generated portraits: selection by recorded outcome', () => {
  const has = new Set(['H|charge', 'H|celebration', 'H|lament', 'K|dive', 'K|beaten', 'D|charge']);
  const lookup: ArtLookup = (id, s) => id && has.has(`${id}|${s}`) ? `/assets/hane/t/${id}-${s}.webp`.toLowerCase() : null;
  it('maps each scene to the right situations', () => {
    expect(situationsFor('goal')).toEqual({ charge: 'actor', outcome: ['actor', 'celebration'], inset: ['keeper', 'beaten'] });
    expect(situationsFor('save')).toEqual({ charge: 'actor', outcome: ['keeper', 'dive'], inset: ['actor', 'lament'] });
    expect(situationsFor('miss')).toEqual({ charge: 'actor', outcome: ['actor', 'lament'], inset: null });
    expect(situationsFor('tackle')).toEqual({ charge: 'actor', outcome: ['actor', 'charge'], inset: null });
  });
  it('goal: charge + celebration + beaten keeper; save: charge + dive + lament; miss: lament; tackle: charge in both phases', () => {
    expect(sceneArt('goal', 'H', 'K', lookup)).toEqual({ charge: '/assets/hane/t/h-charge.webp', outcome: '/assets/hane/t/h-celebration.webp', inset: '/assets/hane/t/k-beaten.webp' });
    expect(sceneArt('save', 'H', 'K', lookup)).toEqual({ charge: '/assets/hane/t/h-charge.webp', outcome: '/assets/hane/t/k-dive.webp', inset: '/assets/hane/t/h-lament.webp' });
    expect(sceneArt('miss', 'H', null, lookup)).toEqual({ charge: '/assets/hane/t/h-charge.webp', outcome: '/assets/hane/t/h-lament.webp', inset: null });
    expect(sceneArt('tackle', 'D', null, lookup)).toEqual({ charge: '/assets/hane/t/d-charge.webp', outcome: '/assets/hane/t/d-charge.webp', inset: null });
  });
  it('falls back to the SVG portrait when there is no image, no lookup or the player is unknown', () => {
    expect(sceneArt('goal', 'X', 'Y', lookup)).toBe(NO_ART);
    expect(sceneArt('goal', 'H', 'K', null)).toBe(NO_ART);
    // Sin imagen de desenlace no hay viñeta suelta: la viñeta va sobre la imagen del desenlace.
    expect(sceneArt('save', 'D', 'K', lookup)).toEqual({ charge: '/assets/hane/t/d-charge.webp', outcome: '/assets/hane/t/k-dive.webp', inset: null });
    expect(sceneArt('save', 'H', 'Z', lookup)).toEqual({ charge: '/assets/hane/t/h-charge.webp', outcome: null, inset: null });
  });
});

describe('Capitán Hane generated portraits: scene integration', () => {
  const view = (id: string, side: 'home' | 'away', role: string): PlayerView => ({ id, name: id, side, sourceRefs: [], role: { value: role, provenance: 'estimated', refs: [] },
    jersey: { value: null, provenance: 'unavailable', refs: [] }, intervals: { value: null, provenance: 'unavailable', refs: [] }, estimatedAttributes: [], metrics: [],
    availability: { status: 'available', reason: null }, details: { sourceKey: `k:${id}` } } as unknown as PlayerView);
  const players = [view('H', 'home', 'FWD'), view('HK', 'home', 'GK'), view('K', 'away', 'GK'), view('A', 'away', 'MID')];
  const events: EventView[] = [];
  const goal: CutIn = { id: 'g', kind: 'goal', atMs: 1, side: 'home', actorId: 'H', keeperId: null };
  const art: ArtLookup = (id, s) => id ? `/assets/hane/t/${id.toLowerCase()}-${s}.webp` : null;

  it('a goal looks up the conceding keeper (the other side) for the inset', () => {
    expect(concedingKeeper(goal, { players, cast: null, data: new Map(), events, locale: 'en' })).toBe('K');
    const spec = specFor(goal, { players, cast: null, data: new Map(), events, locale: 'en', art })!;
    expect(spec.art).toEqual({ charge: '/assets/hane/t/h-charge.webp', outcome: '/assets/hane/t/h-celebration.webp', inset: '/assets/hane/t/k-beaten.webp' });
    expect(specFor(goal, { players, cast: null, data: new Map(), events, locale: 'en' })!.art).toBe(NO_ART);
  });

  const base: CutInSpec = { kind: 'save', actor: { appearance: GENERIC_APPEARANCE, kit: NEUTRAL_KIT, number: '9', name: 'Test Nine' }, keeper: null,
    moveName: 'POLAR STORM', ability: null, keeperAbility: null, skyPassFrom: null, outcomeText: 'SAVE!' };
  it('draws the images under the code overlays and keeps the SVG portrait as fallback', () => {
    const withArt = cutInSvg({ ...base, art: { charge: '/assets/hane/t/a-charge.webp', outcome: '/assets/hane/t/k-dive.webp', inset: '/assets/hane/t/a-lament.webp' } }, 't', 'animated');
    expect(withArt.match(/<image /g)).toHaveLength(3);
    expect(withArt).toContain('class="ci-art"'); expect(withArt).toContain('class="ci-inset"');
    // Bocadillo, placa y rótulo siguen encima de la imagen.
    for (const overlay of ['ci-bubble', 'ci-plate', 'ci-caption']) expect(withArt.indexOf(overlay)).toBeGreaterThan(withArt.indexOf('<image '));
    const plain = cutInSvg(base, 't', 'animated');
    expect(plain).not.toContain('<image'); expect(plain).toContain('ci-portrait');
    const portrait = cutInSvg({ ...base, art: { charge: '/assets/hane/t/a-charge.webp', outcome: null, inset: null } }, 't', 'card', 'portrait');
    expect(portrait).toContain('preserveAspectRatio="xMinYMid slice"');
  });
  it('rejects unsafe URLs (falls back to SVG)', () => {
    for (const bad of ['javascript:alert(1)', '/assets/hane/../x.webp', '/a"onload="x.webp', 'https://evil.example/x.png', 'https://evil.example/x.webp'])
      expect(safeArt(bad)).toBeNull();
    const svg = cutInSvg({ ...base, art: { charge: 'javascript:alert(1)', outcome: null, inset: null } }, 't', 'charge');
    expect(svg).not.toContain('<image'); expect(svg).toContain('ci-portrait');
  });
});

describe('Capitán Hane generated portraits keep the visual abilities', () => {
  const base: CutInSpec = { kind: 'goal', actor: { appearance: GENERIC_APPEARANCE, kit: NEUTRAL_KIT, number: '9', name: 'Test Nine' }, keeper: null,
    moveName: 'POLAR STORM', ability: null, keeperAbility: null, skyPassFrom: null, outcomeText: 'GOAL!!',
    art: { charge: '/assets/hane/t/a-charge.webp', outcome: '/assets/hane/t/a-celebration.webp', inset: null } };
  it('draws aura, afterimages, sky-pass trail and the deformed ball over the images', () => {
    expect(cutInSvg({ ...base, ability: 'ultimate-shot' }, 't', 'animated')).toMatch(/ci-aura[\s\S]*ci-deform/);
    expect(cutInSvg({ ...base, ability: 'phantom-sprint' }, 't', 'charge')).toContain('ci-after');
    expect(cutInSvg({ ...base, skyPassFrom: base.actor }, 't', 'charge')).toContain('ci-trail');
    expect(cutInSvg(base, 't', 'animated')).not.toMatch(/ci-aura|ci-after|ci-trail|ci-deform/);
  });
});
