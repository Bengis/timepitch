import { render, renderHook, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Announcement } from '../match-centre/announcements/announcements';
import type { PlayerView } from '../match-centre/session';
import { LanguageProvider } from '../i18n';
import { AnnouncementBanner, useBannerPlacement } from './AnnouncementBanner';
import { BroadcastScorebug, teamAbbreviation } from './BroadcastScorebug';
import { GENERIC_APPEARANCE, type CastEntry, type CrestRef, type KitSpec, type MatchCast, type MatchKits } from './types';

const SRC = { kind: 'wikipedia', title: 'Season article', revid: 1, licence: 'CC BY-SA 4.0' } as const;
const kit = (shirt: string): KitSpec => ({
  shirt, sleeves: { left: shirt, right: shirt }, shorts: shirt, socks: shirt, trim: '#ffffff', number: '#ffffff', collar: 'crew',
  pattern: { body: 'plain', sleeves: 'plain', shorts: 'plain', socks: 'plain' }, source: SRC,
});
const KITS: MatchKits = { home: kit('#034694'), away: kit('#f6f6f3'), homeKeeper: kit('#222222'), awayKeeper: kit('#33aa33'), choice: 'source' };
const CRESTS: { home: CrestRef; away: CrestRef } = {
  home: { src: '/che.png', kind: 'hfk', source: null }, away: { src: '', kind: 'none', source: null },
};
const entry = (number: string | null, displayName: string): CastEntry => ({
  number, displayName, appearance: GENERIC_APPEARANCE, appearanceSource: 'generic', record: null,
});
const CAST: MatchCast = { kits: KITS, players: new Map([['p-hazard', entry('10', 'Eden Hazard')], ['p-courtois', entry('13', 'Thibaut Courtois')], ['p-off', entry('7', 'Ramires')]]) };
const view = (id: string, name: string): PlayerView => ({ id, name } as unknown as PlayerView);
const PLAYERS = [view('p-hazard', 'Eden Hazard'), view('p-unlinked', 'Bafétimbi Gomis')];

const ann = (over: Partial<Announcement>): Announcement => ({
  id: 'goal:1', kind: 'goal', priority: 100, minuteLabel: "23'", atMs: 1_380_000, side: 'home', primaryPlayerId: 'p-hazard',
  provenance: 'historical', durationMs: 6000, ...over,
});
const banner = (current: Announcement | null, source: 'historical' | 'grf' | 'timepitch' = 'historical') => (
  <AnnouncementBanner current={current} source={source} cast={CAST} players={PLAYERS} homeName="Chelsea" awayName="Swansea City" crests={CRESTS} kits={KITS} />
);

afterEach(() => { vi.unstubAllGlobals(); });

describe('AnnouncementBanner', () => {
  it('renders a goal with title, shirt number and name from the cast and the score after it', () => {
    render(banner(ann({ scoreAfter: { home: 1, away: 0 } })));
    const region = screen.getByRole('status');
    expect(within(region).getByText('GOAL')).toBeInTheDocument();
    expect(within(region).getByText('10')).toHaveClass('tp-bn-shirtno');
    expect(within(region).getByText('Eden Hazard')).toBeInTheDocument();
    expect(region).toHaveTextContent('Chelsea · 1–0');
    expect(region).toHaveTextContent("23'");
  });

  it('does not invent a score when the announcement has none (partial historical window)', () => {
    render(banner(ann({})));
    const region = screen.getByRole('status');
    expect(region).not.toHaveTextContent(/\d–\d/);
    expect(region).toHaveTextContent('Chelsea');
  });

  it('is assertive for goals and polite for everything else, and stays mounted when empty', () => {
    const { rerender } = render(banner(ann({})));
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'assertive');
    rerender(banner(ann({ id: 'yellow:2', kind: 'yellow', priority: 60, side: 'away', primaryPlayerId: 'p-unlinked' })));
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    rerender(banner(null));
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('shows both historical chips for a historical source', () => {
    render(banner(ann({})));
    expect(screen.getByText('Historical event · StatsBomb')).toHaveClass('chip', 'hist');
    expect(screen.getByText('Synthetic animation')).toHaveClass('chip', 'sim');
  });

  it('shows the engine-event simulated chip and never the historical one for GRF and TimePitch', () => {
    const { rerender } = render(banner(ann({ provenance: 'simulated' }), 'grf'));
    expect(screen.getByText('Engine event · Simulated · GRF')).toHaveClass('chip', 'sim');
    expect(screen.queryByText(/Historical event/)).toBeNull();
    rerender(banner(ann({ provenance: 'simulated' }), 'timepitch'));
    expect(screen.getByText('Engine event · Simulated')).toHaveClass('chip', 'sim');
    expect(screen.queryByText(/Historical event/)).toBeNull();
  });

  it('names the recording engine on the chip of a recorded match (demo), in Spanish too', () => {
    localStorage.setItem('timepitch.locale', 'es');
    render(<LanguageProvider><AnnouncementBanner current={ann({ provenance: 'simulated' })} source="recorded" cast={CAST} players={PLAYERS}
      homeName="Chelsea" awayName="Swansea City" crests={CRESTS} kits={KITS} engineLabel="TouchLines" /></LanguageProvider>);
    expect(screen.getByText('Acontecimiento del motor · Simulado · TouchLines')).toHaveClass('chip', 'sim');
    expect(screen.queryByText(/Evento histórico/)).toBeNull();
    localStorage.removeItem('timepitch.locale');
  });

  it('sits over the pitch by default and can be mounted below it (phones), keeping the provenance chips', () => {
    const { rerender } = render(banner(ann({})));
    expect(document.querySelector('.tp-banner')).toHaveClass('tp-banner--overlay');
    rerender(<AnnouncementBanner current={ann({})} source="historical" cast={CAST} players={PLAYERS} homeName="Chelsea"
      awayName="Swansea City" crests={CRESTS} kits={KITS} placement="below" />);
    const region = screen.getByRole('status');
    expect(region).toHaveClass('tp-banner--below');
    expect(within(region).getByText('Historical event · StatsBomb')).toHaveClass('chip', 'hist');
  });

  it('uses the source name and «—» when the player has no cast entry, never another number', () => {
    render(banner(ann({ kind: 'yellow', id: 'yellow:2', side: 'away', primaryPlayerId: 'p-unlinked' })));
    const region = screen.getByRole('status');
    expect(within(region).getByText('—')).toHaveClass('tp-bn-shirtno');
    expect(within(region).getByText('Bafétimbi Gomis')).toBeInTheDocument();
    expect(within(region).getByText('YELLOW CARD')).toBeInTheDocument();
  });

  it('shows the player coming on and going off for a substitution', () => {
    render(banner(ann({ kind: 'substitution', id: 'substitution:3', priority: 40, primaryPlayerId: 'p-hazard', secondaryPlayerId: 'p-off' })));
    const region = screen.getByRole('status');
    expect(region).toHaveTextContent('On: 10 Eden Hazard');
    expect(region).toHaveTextContent('Off: 7 Ramires');
  });

  it('animates only when reduced motion is not requested', () => {
    const { unmount } = render(banner(ann({})));
    expect(document.querySelector('.tp-bn')).toHaveClass('tp-bn--animate');
    unmount();
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {} }));
    render(banner(ann({})));
    expect(document.querySelector('.tp-bn')).not.toHaveClass('tp-bn--animate');
  });

  it('speaks Spanish when the locale is Spanish', () => {
    localStorage.setItem('timepitch.locale', 'es');
    render(<LanguageProvider>{banner(ann({ kind: 'red', id: 'red:4', priority: 90 }))}</LanguageProvider>);
    expect(screen.getByText('EXPULSIÓN')).toBeInTheDocument();
    expect(screen.getByText('Evento histórico · StatsBomb')).toBeInTheDocument();
    expect(screen.getByText('Animación sintética')).toBeInTheDocument();
    localStorage.removeItem('timepitch.locale');
  });

  it('shows a period marker without player or crest', () => {
    render(banner(ann({ kind: 'half_time', id: 'half_time:5', priority: 70, side: null, primaryPlayerId: null, minuteLabel: "45+2'" })));
    const region = screen.getByRole('status');
    expect(within(region).getByText('HALF-TIME')).toBeInTheDocument();
    expect(region.querySelector('.tp-bn-shirtno')).toBeNull();
    expect(region).toHaveTextContent("45+2'");
  });
});

describe('BroadcastScorebug', () => {
  const bug = (over: Partial<Parameters<typeof BroadcastScorebug>[0]> = {}) => (
    <BroadcastScorebug home={{ name: 'Chelsea' }} away={{ name: 'Swansea City' }} score={{ home: 2, away: 1 }} clock="67:12" period={2}
      reds={{ home: 1, away: 0 }} crests={CRESTS} kits={KITS} {...over} />
  );

  it('shows abbreviations, full names, score, clock, half and red cards', () => {
    render(bug());
    const board = screen.getByRole('group', { name: /Chelsea 2, Swansea City 1/ });
    expect(within(board).getByText('CHE')).toBeInTheDocument();
    expect(within(board).getByText('SWA')).toBeInTheDocument();
    expect(within(board).getByText('Chelsea')).toHaveClass('tp-sb-full');
    expect(within(board).getByText('67:12')).toBeInTheDocument();
    expect(within(board).getByText('2nd half')).toBeInTheDocument();
    expect(within(board).getByLabelText('1 red card')).toBeInTheDocument();
    expect(board.querySelectorAll('.tp-sb-kitstrip i')).toHaveLength(8);
  });

  it('keeps only abbreviations visible in compact mode', () => {
    render(bug({ compact: true }));
    const board = screen.getByRole('group');
    expect(board).toHaveClass('tp-sb--compact');
    expect(within(board).getByText('CHE')).toBeVisible();
    expect(within(board).queryByText('Chelsea', { selector: '.tp-sb-full' })).toBeNull();
  });

  it('shows dashes for an unknown score, a neutral crest and an estimated-kit chip', () => {
    render(bug({ score: null, kits: { ...KITS, choice: 'estimated' } }));
    const board = screen.getByRole('group');
    expect(board).toHaveTextContent('—–—');
    expect(board.querySelectorAll('.tp-sb-crest img')).toHaveLength(1);
    expect(board.querySelector('.tp-sb-crest--none')).not.toBeNull();
    expect(within(board).getByText('Estimated kit colours')).toHaveClass('chip', 'est');
  });

  it('tints each half with its club shirt colour, falling back to a faint white for near-white or missing kits', () => {
    const { rerender } = render(bug());
    const home = document.querySelector('.tp-sb-team--home') as HTMLElement, away = document.querySelector('.tp-sb-team--away') as HTMLElement;
    expect(home.style.getPropertyValue('--club')).toBe('#034694');
    expect(away.style.getPropertyValue('--club')).toBe('');
    expect(away).toHaveClass('tp-sb-team--light');
    rerender(bug({ kits: null }));
    expect((document.querySelector('.tp-sb-team--home') as HTMLElement).style.getPropertyValue('--club')).toBe('');
    expect(document.querySelector('.tp-sb-kitstrip')).toBeNull();
  });

  it('flashes only the digit that changed, and not with reduced motion', () => {
    const { rerender, unmount } = render(bug({ score: { home: 0, away: 0 } }));
    expect(document.querySelector('.tp-sb-flash')).toBeNull();
    rerender(bug({ score: { home: 1, away: 0 } }));
    const flashing = document.querySelectorAll('.tp-sb-flash');
    expect(flashing).toHaveLength(1);
    expect(flashing[0]).toHaveTextContent('1');
    unmount();
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {} }));
    const again = render(bug({ score: { home: 0, away: 0 } }));
    again.rerender(bug({ score: { home: 0, away: 1 } }));
    expect(document.querySelector('.tp-sb-flash')).toBeNull();
  });

  it('shows full time without the live dot', () => {
    render(bug({ finished: true }));
    expect(screen.getByText('Full time')).toBeInTheDocument();
    expect(document.querySelector('.tp-sb-livedot')).toBeNull();
  });

  it('derives broadcast abbreviations', () => {
    expect(teamAbbreviation('Chelsea')).toBe('CHE');
    expect(teamAbbreviation('Swansea City')).toBe('SWA');
    expect(teamAbbreviation('Manchester United')).toBe('MUN');
    expect(teamAbbreviation('Manchester City')).toBe('MCI');
    expect(teamAbbreviation('West Ham United')).toBe('WHU');
    // Los nombres de sesión llevan la temporada (G17).
    expect(teamAbbreviation('Manchester City 2024/25')).toBe('MCI');
    expect(teamAbbreviation('Arsenal 2003/04')).toBe('ARS');
  });
});

describe('useBannerPlacement', () => {
  const media = (narrow: boolean) => vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('max-width: 600px') ? narrow : false, media: query, addEventListener() {}, removeEventListener() {},
  }));
  it('puts the banner below the pitch on phones (≤600 px) and over it otherwise', () => {
    media(true);
    expect(renderHook(() => useBannerPlacement()).result.current).toBe('below');
    media(false);
    expect(renderHook(() => useBannerPlacement()).result.current).toBe('overlay');
  });
});
