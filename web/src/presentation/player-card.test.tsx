import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../i18n';
import type { PlayerSeason } from '../api';
import type { MetricView, PlayerView } from '../match-centre/session';
import type { PlayerCardRecord } from '../catalog/player-registry';
import { GENERIC_APPEARANCE, type CastEntry, type KitSpec, type MatchCast } from './types';
import { PlayerCard, ageOnFirstAugust } from './PlayerCard';
import { PlayerPicker, kitForPlayer, pickerOptions } from './PlayerPicker';

const KIT: KitSpec = {
  shirt: '#EF0107', sleeves: { left: '#FFFFFF', right: '#FFFFFF' }, shorts: '#FFFFFF', socks: '#FFFFFF',
  trim: '#FFFFFF', number: '#FFFFFF', collar: 'crew',
  pattern: { body: 'plain', sleeves: 'plain', shorts: 'plain', socks: 'plain' },
  source: { kind: 'hand_assigned', licence: 'TimePitch' },
};
const ARTICLE = { kind: 'wikipedia', title: '2003–04 Arsenal F.C. season', revid: 1380992540, licence: 'CC BY-SA 4.0' } as const;
const WD = (note: string) => ({ kind: 'wikidata', qid: 'Q45901', revision: 2550000000, licence: 'CC0 1.0', note }) as const;

const HENRY: PlayerCardRecord = {
  qid: 'Q45901', number: '14', display: 'Thierry Henry', position: 'FW', nation: 'France', dob: '1977-08-17', heightCm: 188,
  fields: { display: WD('label'), number: ARTICLE, position: ARTICLE, nation: WD('P1532'), citizenship: WD('P27'), dob: WD('P569'), heightCm: WD('P2048') },
  numbers: [{ value: '14', position: 'FW', nationFlag: 'FRA' }], nationBasis: 'sport', sportNationalities: ['France'],
  citizenship: ['France'], wikidataPositions: ['forward'], flags: [],
};

const metric = (id: string, value: number | null, provenance: MetricView['provenance']): MetricView => ({
  id, definition: id, value, unit: 'count', provenance, availability: { status: value == null ? 'unavailable' : 'available', reason: null }, evidenceIds: [],
});

const view = (over: Partial<PlayerView> = {}): PlayerView => ({
  id: 'historical:15515', sourceRefs: [], name: 'T. Henry (source)', side: 'home',
  role: { value: 'Center Forward', provenance: 'source_recorded', refs: [] },
  jersey: { value: '99', provenance: 'source_recorded', refs: [] },
  intervals: { value: null, provenance: 'unavailable', refs: [] },
  estimatedAttributes: [], metrics: [], availability: { status: 'available', reason: null }, ...over,
});

const entry = (over: Partial<CastEntry> = {}): CastEntry => ({
  number: '14', displayName: 'Thierry Henry', appearance: GENERIC_APPEARANCE, appearanceSource: 'generic', record: HENRY, ...over,
});

const SEASON: PlayerSeason = {
  key: 'epldata:2003:arsenal:HENRYT', source_id: 'HENRYT', name: 'Thierry Henry', role: 'FWD', quality_flags: [],
  stats: {
    appearances: { value: 37, source: 'epldata', status: 'measured', unit: 'count' },
    goals: { value: 30, source: 'epldata', status: 'measured', unit: 'count' },
    assists: { value: 6, source: 'epldata', status: 'measured', unit: 'count' },
    minutes: { value: 3298, source: 'epldata', status: 'estimated', unit: 'minutes' },
  },
};

function renderCard(props: Partial<Parameters<typeof PlayerCard>[0]> = {}, locale: 'en' | 'es' = 'en') {
  localStorage.setItem('timepitch.locale', locale);
  const onClose = vi.fn();
  render(<LanguageProvider><PlayerCard player={view()} entry={entry()} kit={KIT} seasonLabel="2003/04" teamKey="arsenal:2003" teamName="Arsenal" onClose={onClose} {...props} /></LanguageProvider>);
  return { onClose, card: screen.getByRole('dialog') };
}

afterEach(() => localStorage.clear());

describe('ageOnFirstAugust', () => {
  it('computes the age on 1 August of the season start year', () => {
    expect(ageOnFirstAugust('1977-08-17', '2003/04')).toBe(25);
    expect(ageOnFirstAugust('1977-08-01', '2003/04')).toBe(26);
    expect(ageOnFirstAugust(null, '2003/04')).toBeNull();
    expect(ageOnFirstAugust('1977-08-17', 'n/a')).toBeNull();
  });
});

describe('PlayerCard', () => {
  it('shows identity from the card record, not from the source row', () => {
    const { card } = renderCard();
    expect(within(card).getByRole('heading', { level: 2 })).toHaveTextContent('Thierry Henry');
    expect(card).toHaveTextContent('Number 14');
    expect(card).not.toHaveTextContent('Number 99');
    expect(card).toHaveTextContent('Forward');
    expect(card).toHaveTextContent('Arsenal · 2003/04');
    const facts = within(card).getByRole('list', { name: 'Player facts' });
    expect(facts).toHaveTextContent('Nationality (national team)France');
    expect(facts).toHaveTextContent('Citizenship (Wikidata)France');
    expect(facts).toHaveTextContent('17 Aug 1977');
    expect(facts).toHaveTextContent('25 on 1 Aug 2003');
    expect(facts).toHaveTextContent('188 cm');
  });

  it('lists every record field in Sources with title+revid or QID+revision', () => {
    const { card } = renderCard();
    const sources = within(card).getByRole('region', { name: 'Sources' });
    const items = within(sources).getAllByRole('listitem');
    expect(items).toHaveLength(Object.keys(HENRY.fields).length);
    expect(sources).toHaveTextContent('2003–04 Arsenal F.C. season · rev 1380992540 · CC BY-SA 4.0');
    expect(sources).toHaveTextContent('Wikidata Q45901 · rev 2550000000 · CC0 1.0');
  });

  it('labels citizenship-based and manually corrected nationality', () => {
    const citizen = { ...HENRY, nation: 'United Kingdom', nationBasis: 'citizenship' as const, sportNationalities: [], citizenship: ['United Kingdom'] };
    const { card } = renderCard({ entry: entry({ record: citizen }) });
    expect(card).toHaveTextContent('Nationality (citizenship)United Kingdom');
  });

  it('without a record shows only the source row and no invented sources', () => {
    const { card } = renderCard({ entry: null });
    expect(within(card).getByRole('heading', { level: 2 })).toHaveTextContent('T. Henry (source)');
    expect(card).toHaveTextContent('99');
    expect(card).toHaveTextContent('Center Forward');
    expect(within(card).queryByRole('region', { name: 'Sources' })).toBeNull();
    expect(card).not.toHaveTextContent('Nationality');
    expect(card).toHaveTextContent('No player card');
  });

  it('marks season stats as historical or estimated by their status', () => {
    const { card } = renderCard({ season: SEASON });
    const block = within(card).getByRole('region', { name: /Season 2003\/04/ });
    expect(block).toHaveTextContent('Appearances37');
    expect(within(block).getByText('Minutes').closest('[data-provenance]')).toHaveAttribute('data-provenance', 'est');
    expect(within(block).getByText('Goals').closest('[data-provenance]')).toHaveAttribute('data-provenance', 'hist');
    expect(within(block).getByText('Historical', { selector: '.chip' })).toBeInTheDocument();
    expect(within(block).getByText('Estimated', { selector: '.chip' })).toBeInTheDocument();
    expect(block).toHaveTextContent('epldata');
  });

  it('separates historical and simulated match stats and estimated attributes', () => {
    const player = view({
      metrics: [metric('passes', 41, 'source_recorded'), metric('distance_m', 10450, 'simulated'), metric('xg', null, 'source_recorded')],
      estimatedAttributes: [metric('pace', 92, 'estimated')],
    });
    const { card } = renderCard({ player, matchLabel: 'Fictional cross-era simulation' });
    const match = within(card).getByRole('region', { name: /This match/ });
    expect(match).toHaveTextContent('Fictional cross-era simulation');
    expect(within(match).getByText('passes', { exact: false }).closest('[data-provenance]')).toHaveAttribute('data-provenance', 'hist');
    expect(within(match).getByText('Distance').closest('[data-provenance]')).toHaveAttribute('data-provenance', 'sim');
    expect(within(match).getByText('Simulated', { selector: '.chip' })).toBeInTheDocument();
    expect(match).not.toHaveTextContent('xg');
    const attrs = within(card).getByRole('region', { name: /Attributes/ });
    expect(within(attrs).getByText('Estimated', { selector: '.chip' })).toBeInTheDocument();
    expect(attrs).toHaveTextContent('92');
  });

  it('says when there are no match stats', () => {
    const { card } = renderCard();
    expect(card).toHaveTextContent('No match statistics available');
  });

  it('shows the stylised avatar with its notice and the hand-assigned chip only when assigned by hand', () => {
    const { card } = renderCard({ entry: entry({ appearanceSource: 'hand_assigned', appearance: { ...GENERIC_APPEARANCE, beard: 'full' } }) });
    expect(within(card).getByRole('img', { name: /Stylised avatar, not a portrait/ })).toBeInTheDocument();
    expect(card).toHaveTextContent('Unsourced features · assigned by hand');
  });

  it('closes with the button and with Escape', () => {
    const { onClose, card } = renderCard();
    fireEvent.click(within(card).getByRole('button', { name: 'Close' }));
    fireEvent.keyDown(card, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('is translated to Spanish', () => {
    const { card } = renderCard({ season: SEASON }, 'es');
    expect(card).toHaveTextContent('Delantero');
    expect(card).toHaveTextContent('Nacionalidad (selección)France');
    expect(card).toHaveTextContent('25 años el 1 ago 2003');
    expect(within(card).getByRole('region', { name: 'Fuentes' })).toBeInTheDocument();
    expect(within(card).getByText('Histórico', { selector: '.chip' })).toBeInTheDocument();
    expect(within(card).getByRole('img', { name: /Avatar estilizado, no es un retrato/ })).toBeInTheDocument();
  });

  it('never injects an invalid kit colour into the hero style', () => {
    const { card } = renderCard({ kit: { ...KIT, shirt: 'red;background:url(x)' } });
    expect(card.querySelector('.tp-pc-hero')!.getAttribute('style')).not.toContain('url(');
  });

  it('flags a generic avatar as pending appearance and a hand-assigned one as unsourced, once', () => {
    const { card } = renderCard();
    expect(within(card).getByText('Appearance pending', { selector: '.chip.ph' })).toBeInTheDocument();
    cleanup();
    const hand = renderCard({ entry: entry({ appearanceSource: 'hand_assigned', appearance: { ...GENERIC_APPEARANCE, beard: 'full' } }) }).card;
    expect(within(hand).getAllByText(/Unsourced features/)).toHaveLength(1);
    expect(within(hand).queryByText('Appearance pending')).toBeNull();
  });

  it('labels the nationality in the hero meta line', () => {
    const { card } = renderCard();
    expect(card.querySelector('.tp-pc-meta')).toHaveTextContent('Nationality France');
  });
});

describe('PlayerCard inline variant', () => {
  function renderInline(props: Partial<Parameters<typeof PlayerCard>[0]> = {}, locale: 'en' | 'es' = 'en') {
    localStorage.setItem('timepitch.locale', locale);
    render(<LanguageProvider><PlayerCard variant="inline" player={view()} entry={entry()} kit={KIT} seasonLabel="2003/04" teamName="Arsenal" {...props} /></LanguageProvider>);
    return screen.getByRole('region', { name: /Player card: Thierry Henry|Ficha de jugador: Thierry Henry/ });
  }

  it('is a page region with a two-column layout and no close button', () => {
    const card = renderInline();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(card).toHaveClass('tp-pc--inline');
    expect(card.querySelector('.tp-pc-layout > .tp-pc-hero')).not.toBeNull();
    expect(card.querySelector('.tp-pc-layout > .tp-pc-body')).not.toBeNull();
    expect(within(card).queryByRole('button', { name: 'Close' })).toBeNull();
  });

  it('offers a back button only when onClose is given', () => {
    const onClose = vi.fn();
    const card = renderInline({ onClose });
    fireEvent.click(within(card).getByRole('button', { name: 'Back to broadcast' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders the picker slot at the top of the body', () => {
    const card = renderInline({ picker: <nav aria-label="Pick">picker</nav> });
    const body = card.querySelector('.tp-pc-body')!;
    expect(body.firstElementChild).toHaveAttribute('aria-label', 'Pick');
  });

  it('shows simulated movement from the recording and says what the engine does not record', () => {
    const card = renderInline({ movement: { distanceM: 10450, hsrM: 812, seconds: 5400 } });
    const block = within(card).getByRole('region', { name: /Movement in the reconstruction/ });
    expect(within(block).getByText('Simulated', { selector: '.chip' })).toBeInTheDocument();
    expect(block).toHaveTextContent('Distance10.5km');
    expect(block).toHaveTextContent('High intensity (> 5.5 m/s)812m');
    expect(block).toHaveTextContent('Minutes on pitch90');
    expect(block).toHaveTextContent('Top speed and sprints: not available in this recording');
    expect(block).toHaveTextContent('not real tracking');
  });

  it('shows top speed and sprints only when the recording provides them', () => {
    const card = renderInline({ movement: { distanceM: 9000, hsrM: 500, seconds: 3000, topSpeedMps: 8.94, sprints: 21 } });
    const block = within(card).getByRole('region', { name: /Movement in the reconstruction/ });
    expect(block).toHaveTextContent('Top speed32.2km/h');
    expect(block).toHaveTextContent('Sprints21');
    expect(block).not.toHaveTextContent('not available');
  });

  it('keeps the movement block with an honest empty state when the recording has no movement', () => {
    const card = renderInline({ movement: null }, 'es');
    const block = within(card).getByRole('region', { name: /Movimiento en la reconstrucción/ });
    expect(block.querySelector('.tp-pc-missing')).toHaveTextContent('no disponible en esta grabación');
  });

  it('omits the movement block when the caller does not provide one', () => {
    const card = renderInline();
    expect(within(card).queryByRole('region', { name: /Movement in the reconstruction/ })).toBeNull();
  });
});

describe('PlayerPicker', () => {
  const GK_KIT: KitSpec = { ...KIT, shirt: '#222222', number: '#EEEEEE' };
  const AWAY_KIT: KitSpec = { ...KIT, shirt: '#6CABDD', number: '#1C2C5B' };
  const cast: MatchCast = {
    kits: { home: KIT, away: AWAY_KIT, homeKeeper: GK_KIT, awayKeeper: GK_KIT, choice: 'source' },
    players: new Map([
      ['h:9', entry({ number: '14', displayName: 'Thierry Henry' })],
      ['h:1', entry({ number: '1', displayName: 'Jens Lehmann', record: null })],
      ['a:8', entry({ number: '8', displayName: 'İlkay Gündoğan', record: null })],
    ]),
  };
  const players: PlayerView[] = [
    view({ id: 'h:9', name: 'Thierry Henry (source)' }),
    view({ id: 'h:1', name: 'J. Lehmann', role: { value: 'Goalkeeper', provenance: 'source_recorded', refs: [] }, jersey: { value: '1', provenance: 'source_recorded', refs: [] } }),
    view({ id: 'a:8', name: 'Ilkay Gundogan', side: 'away', jersey: { value: '8', provenance: 'source_recorded', refs: [] } }),
    view({ id: 'a:99', name: 'Uncast Player', side: 'away', jersey: { value: null, provenance: 'unavailable', refs: [] } }),
  ];

  it('uses the cast names and numbers (the same as the timeline) and the kit colours', () => {
    const options = pickerOptions(players, cast);
    expect(options.map(o => o.name)).toEqual(['Thierry Henry', 'Jens Lehmann', 'İlkay Gündoğan', 'Uncast Player']);
    expect(options.map(o => o.number)).toEqual(['14', '1', '8', null]);
    expect(options[0]).toMatchObject({ shirt: '#EF0107', ink: '#FFFFFF' });
    expect(options[1]).toMatchObject({ shirt: '#222222', ink: '#EEEEEE' });
    expect(options[2]).toMatchObject({ shirt: '#6CABDD', ink: '#1C2C5B' });
    expect(kitForPlayer(cast, players[1])).toBe(GK_KIT);
    expect(kitForPlayer(null, players[0])).toBeNull();
  });

  it('marks the active player and calls onSelect with the player id', () => {
    localStorage.setItem('timepitch.locale', 'en');
    const onSelect = vi.fn();
    render(<LanguageProvider><PlayerPicker options={pickerOptions(players, cast)} selectedId="h:9" onSelect={onSelect} /></LanguageProvider>);
    const nav = screen.getByRole('navigation', { name: 'Choose player' });
    expect(within(nav).getByRole('button', { name: /Thierry Henry/ })).toHaveAttribute('aria-pressed', 'true');
    expect(within(nav).getByRole('button', { name: /Jens Lehmann/ })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(within(nav).getByRole('button', { name: /Gündoğan/ }));
    expect(onSelect).toHaveBeenCalledWith('a:8');
    expect(within(nav).getByRole('button', { name: /Uncast Player/ }).querySelector('.n')).toHaveTextContent('–');
  });

  it('never injects an invalid colour into the number disc', () => {
    const bad: MatchCast = { ...cast, kits: { ...cast.kits, home: { ...KIT, shirt: 'red;background:url(x)' } } };
    expect(pickerOptions([players[0]], bad)[0].shirt).not.toContain('url(');
  });
});
