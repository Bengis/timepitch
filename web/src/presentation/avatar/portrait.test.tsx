import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LanguageProvider } from '../../i18n';
import { GENERIC_APPEARANCE, type AppearanceParams, type HairStyle, type KitSpec } from '../types';
import { Portrait } from './Portrait';
import { HAIR_STYLES, SKIN_TONES } from './palette';
import { portraitSvg } from './portrait-svg';

const KIT: KitSpec = {
  shirt: '#EF0107', sleeves: { left: '#FFFFFF', right: '#FFFFFF' }, shorts: '#FFFFFF', socks: '#FFFFFF',
  trim: '#FFFFFF', number: '#FFFFFF', collar: 'crew',
  pattern: { body: 'plain', sleeves: 'plain', shorts: 'plain', socks: 'plain' },
  source: { kind: 'hand_assigned', licence: 'TimePitch' },
};
const LOOK: AppearanceParams = Object.freeze({
  skin: 's2', hairStyle: 'quiff', hairColour: 'dkblond', beard: 'stubble', eyes: 'bl', boots: '#111111', build: 1,
});
const base = { appearance: LOOK, kit: KIT, number: '17', idPrefix: 'p1' };

const ids = (markup: string) => [...markup.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
const refs = (markup: string) => [...markup.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1]);

afterEach(() => localStorage.clear());

describe('portraitSvg', () => {
  it('is deterministic for the same input', () => {
    expect(portraitSvg(base)).toBe(portraitSvg({ ...base }));
    expect(portraitSvg({ ...base, shape: 'medallion' })).toBe(portraitSvg({ ...base, shape: 'medallion' }));
  });

  it('prefixes every id and only references its own ids (no global defs)', () => {
    for (const shape of ['bust', 'medallion'] as const) {
      const svg = portraitSvg({ ...base, shape });
      const own = ids(svg);
      expect(own.length).toBeGreaterThan(0);
      expect(new Set(own).size).toBe(own.length);
      for (const id of own) expect(id.startsWith('p1')).toBe(true);
      for (const ref of refs(svg)) expect(own).toContain(ref);
    }
  });

  it('draws each of the ten hair styles, quiff included, with distinct markup', () => {
    expect(HAIR_STYLES).toHaveLength(10);
    const hair = (style: HairStyle) => {
      const svg = portraitSvg({ ...base, appearance: { ...LOOK, hairStyle: style } });
      expect(svg).toContain(`data-hair="${style}"`);
      const m = svg.match(/<g data-part="hair"[^>]*>[\s\S]*?<\/g><!--\/hair-->/);
      expect(m, style).not.toBeNull();
      return m![0];
    };
    const all = HAIR_STYLES.map(hair);
    expect(new Set(all).size).toBe(10);
    expect(all[HAIR_STYLES.indexOf('quiff')]).toMatch(/<path d="M/);
  });

  it('draws beard levels from none to full with growing opacity', () => {
    const beardOpacity = (beard: AppearanceParams['beard']) => {
      const svg = portraitSvg({ ...base, appearance: { ...LOOK, beard } });
      const m = svg.match(/data-part="beard" data-level="(\w+)"[^>]*opacity="([\d.]+)"/);
      return m ? Number(m[2]) : 0;
    };
    expect(portraitSvg({ ...base, appearance: { ...LOOK, beard: 'none' } })).not.toContain('data-part="beard"');
    const levels = (['none', 'stubble', 'light', 'full'] as const).map(beardOpacity);
    expect(levels[0]).toBe(0);
    expect(levels[1]).toBeGreaterThan(0);
    expect(levels[2]).toBeGreaterThan(levels[1]);
    expect(levels[3]).toBeGreaterThan(levels[2]);
  });

  it('uses the skin palette and the kit colours for shirt and collar', () => {
    const light = portraitSvg({ ...base, appearance: { ...LOOK, skin: 's1' } });
    const dark = portraitSvg({ ...base, appearance: { ...LOOK, skin: 's8' } });
    expect(light).toContain(SKIN_TONES.s1);
    expect(dark).toContain(SKIN_TONES.s8);
    expect(dark).not.toContain(SKIN_TONES.s1);
    const crew = portraitSvg(base);
    expect(crew).toMatch(/data-part="collar" data-collar="crew"[^>]*stroke="#FFFFFF"/);
    expect(crew).toContain('stop-color="#EF0107"');
    const vNeck = portraitSvg({ ...base, kit: { ...KIT, collar: 'v', trim: '#123456' } });
    expect(vNeck).toMatch(/data-part="collar" data-collar="v"/);
    expect(vNeck).toContain('#123456');
  });

  it('draws the shirt number only when there is one, escaped', () => {
    expect(portraitSvg(base)).toMatch(/data-part="number"[^>]*>17</);
    expect(portraitSvg({ ...base, number: null })).not.toContain('data-part="number"');
    const hostile = portraitSvg({ ...base, number: '<b>' });
    expect(hostile).not.toContain('<b>');
    expect(hostile).toContain('&lt;b&gt;');
  });

  it('rejects colours that are not #rrggbb instead of injecting them', () => {
    const svg = portraitSvg({ ...base, kit: { ...KIT, shirt: 'red"/><script>x</script>', trim: 'url(evil)' } });
    expect(svg).not.toContain('<script>');
    expect(svg).not.toContain('evil');
  });

  it('gives GENERIC_APPEARANCE a neutral look: no beard, plain crop hair', () => {
    const svg = portraitSvg({ ...base, appearance: GENERIC_APPEARANCE });
    expect(svg).not.toContain('data-part="beard"');
    expect(svg).toContain('data-hair="crop"');
    expect(svg).not.toContain('data-part="hair-back"');
    expect(svg).toContain(SKIN_TONES.s4);
  });
});

describe('<Portrait>', () => {
  it('never repeats an id when two portraits share the page', () => {
    const { container } = render(<>
      <Portrait appearance={LOOK} kit={KIT} number="17" label="Kevin De Bruyne" />
      <Portrait appearance={LOOK} kit={KIT} number="17" label="Kevin De Bruyne" size="medallion" />
      <Portrait appearance={LOOK} kit={KIT} number="17" label="Kevin De Bruyne" />
    </>);
    const all = [...container.querySelectorAll('[id]')].map((e) => e.id);
    expect(all.length).toBeGreaterThan(6);
    expect(new Set(all).size).toBe(all.length);
  });

  it('labels the image as a stylised avatar in English and Spanish', () => {
    const { unmount } = render(<Portrait appearance={LOOK} kit={KIT} number="17" label="Kevin De Bruyne" />);
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe('Kevin De Bruyne · Stylised avatar, not a portrait');
    unmount();
    localStorage.setItem('timepitch.locale', 'es');
    render(<LanguageProvider><Portrait appearance={LOOK} kit={KIT} number="17" label="Kevin De Bruyne" /></LanguageProvider>);
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe('Kevin De Bruyne · Avatar estilizado, no es un retrato');
  });

  it('shows the hand-assigned note only for hand-assigned looks', () => {
    localStorage.setItem('timepitch.locale', 'es');
    const { unmount } = render(<LanguageProvider>
      <Portrait appearance={LOOK} appearanceSource="hand_assigned" kit={KIT} number="17" label="X" />
    </LanguageProvider>);
    expect(screen.getByText('Rasgos sin fuente · asignados a mano')).toBeInTheDocument();
    unmount();
    render(<LanguageProvider>
      <Portrait appearance={null} appearanceSource="generic" kit={KIT} number={null} label="Y" />
    </LanguageProvider>);
    expect(screen.queryByText('Rasgos sin fuente · asignados a mano')).toBeNull();
    expect(screen.getByRole('img')).toHaveAttribute('title', 'Avatar genérico');
  });

  it('falls back to the generic look and a neutral kit when nothing is known', () => {
    const { container } = render(<Portrait appearance={null} kit={null} number={null} label="Unknown" />);
    const html = container.innerHTML;
    expect(html).toContain('data-hair="crop"');
    expect(html).not.toContain('data-part="beard"');
    expect(html).not.toContain('data-part="number"');
    expect(screen.getByRole('img')).toHaveAttribute('title', 'Generic avatar');
  });

  it('keeps the drawing out of the accessibility tree and applies the size class', () => {
    const { container } = render(<Portrait appearance={LOOK} kit={KIT} number="17" label="Z" size="medallion" />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('.tp-portrait--medallion')).not.toBeNull();
  });
});
