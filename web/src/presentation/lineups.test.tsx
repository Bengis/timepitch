import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../i18n';
import type { Announcement } from '../match-centre/announcements/announcements';
import type { PlayerView } from '../match-centre/session';
import { GENERIC_APPEARANCE, type CastEntry, type KitSpec, type MatchCast } from './types';
import { LineupsPair, LineupsView, formationLines, placeStarters } from './LineupsView';
import { MatchMetaBar, matchMetaFromDescriptor } from './MatchMetaBar';
import { MatchPlayers } from '../match-centre/MatchPlayers';

const kit = (shirt: string, number: string): KitSpec => ({
  shirt, sleeves: { left: shirt, right: shirt }, shorts: '#ffffff', socks: shirt, trim: '#ffffff', number, collar: 'crew',
  pattern: { body: 'plain', sleeves: 'plain', shorts: 'plain', socks: 'plain' },
  source: { kind: 'hand_assigned', licence: 'TimePitch' },
});
const KITS = { home: kit('#ef0107', '#ffffff'), away: kit('#6cabdd', '#1c2c5b'), homeKeeper: kit('#222222', '#eeeeee'), awayKeeper: kit('#00a650', '#000000'), choice: 'source' as const };

const XI_4231 = ['Goalkeeper', 'Right Back', 'Right Center Back', 'Left Center Back', 'Left Back',
  'Right Defensive Midfield', 'Left Defensive Midfield', 'Right Wing', 'Center Attacking Midfield', 'Left Wing', 'Center Forward'];

function player(id: string, opts: { name?: string | null; side?: 'home' | 'away'; role?: string | null; jersey?: string | null; starter?: boolean; rolesEstimated?: boolean } = {}): PlayerView {
  const { name = `Player ${id}`, side = 'home', role = null, jersey = null, starter = false, rolesEstimated = false } = opts;
  return {
    id, name, side, sourceRefs: [id],
    role: { value: role, provenance: role == null ? 'unavailable' : rolesEstimated ? 'estimated' : 'source_recorded', refs: [] },
    jersey: { value: jersey, provenance: jersey == null ? 'unavailable' : 'source_recorded', refs: [] },
    intervals: { value: starter ? [{ fromMs: 0, toMs: null }] : null, provenance: starter ? 'source_recorded' : 'unavailable', refs: [] },
    estimatedAttributes: [], metrics: [], availability: { status: 'available', reason: null } as PlayerView['availability'],
  };
}
const home11 = () => XI_4231.map((role, i) => player(`h${i + 1}`, { role, jersey: String(i + 1), starter: true }));

const ann = (over: Partial<Announcement> & Pick<Announcement, 'id' | 'kind'>): Announcement => ({
  priority: 50, minuteLabel: "23'", atMs: 1000, side: 'home', primaryPlayerId: null, provenance: 'historical', durationMs: 3000, ...over,
});

const castOf = (entries: Record<string, Partial<CastEntry>>): MatchCast => ({
  kits: KITS,
  players: new Map(Object.entries(entries).map(([id, e]) => [id, {
    number: null, displayName: null, appearance: GENERIC_APPEARANCE, appearanceSource: 'generic', record: null, ...e,
  } satisfies CastEntry])),
});

function view(props: Partial<Parameters<typeof LineupsView>[0]> = {}) {
  return render(<LanguageProvider><LineupsView side="home" teamName="Arsenal" formation="4-2-3-1" players={home11()}
    cast={null} announcements={[]} onSelect={() => {}} {...props} /></LanguageProvider>);
}

afterEach(() => localStorage.clear());

describe('formationLines', () => {
  it('parses outfield lines and rejects formations that do not add up to ten', () => {
    expect(formationLines('4-2-3-1')).toEqual([4, 2, 3, 1]);
    expect(formationLines('442')).toEqual([4, 4, 2]);
    expect(formationLines('4-4-3')).toBeNull();
    expect(formationLines(null)).toBeNull();
    expect(formationLines('bad')).toBeNull();
  });
});

describe('placeStarters', () => {
  it('puts the keeper alone at the back and orders each line from left to right', () => {
    const placed = placeStarters(home11(), [4, 2, 3, 1])!;
    expect(placed.map(p => p.line)).toEqual([0, 1, 1, 1, 1, 2, 2, 3, 3, 3, 4]);
    const back4 = placed.filter(p => p.line === 1);
    expect(back4.map(p => p.player.role.value)).toEqual(['Left Back', 'Left Center Back', 'Right Center Back', 'Right Back']);
    expect(back4.map(p => p.x)).toEqual([...back4.map(p => p.x)].sort((a, b) => a - b));
    expect(placed[0].y).toBeGreaterThan(placed[10].y);
  });

  it('places engine roles (GK/DEF/MID/FWD) keeping source order inside a line', () => {
    const roles = ['GK', 'DEF', 'DEF', 'DEF', 'DEF', 'MID', 'MID', 'MID', 'MID', 'FWD', 'FWD'];
    const xi = roles.map((role, i) => player(`e${i}`, { role, rolesEstimated: true }));
    const placed = placeStarters(xi, [4, 4, 2])!;
    expect(placed.map(p => p.line)).toEqual([0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3]);
    expect(placed.filter(p => p.line === 1).map(p => p.player.id)).toEqual(['e1', 'e2', 'e3', 'e4']);
  });

  it('gives up (list only) without exactly eleven starters', () => {
    expect(placeStarters(home11().slice(0, 10), [4, 2, 3, 1])).toBeNull();
  });
});

describe('<LineupsView>', () => {
  it('places 11 shirts on the mini pitch: keeper plus four lines for 4-2-3-1', () => {
    view();
    const pitch = screen.getByRole('group', { name: 'Arsenal formation 4-2-3-1' });
    const spots = within(pitch).getAllByRole('button');
    expect(spots).toHaveLength(11);
    const lines = spots.map(b => b.getAttribute('data-line'));
    expect(new Set(lines).size).toBe(5);
    expect(lines.filter(l => l === '1')).toHaveLength(4);
    expect(pitch.querySelectorAll('.tp-lu-shirticon')).toHaveLength(11);
  });

  it('shows a list only when the formation is missing', () => {
    view({ formation: null });
    expect(screen.queryByRole('group', { name: /formation/ })).toBeNull();
    expect(screen.getByText('Formation not in source')).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Starting XI' })).getAllByRole('listitem')).toHaveLength(11);
  });

  it('lists every non-starter on the bench and ignores the other side', () => {
    const players = [...home11(), player('b1', { name: 'Bench One', jersey: '15' }), player('b2', { name: 'Bench Two' }),
      player('a1', { name: 'Away Guy', side: 'away', starter: true, role: 'Goalkeeper' })];
    view({ players });
    const bench = screen.getByRole('list', { name: 'Substitutes' });
    expect(within(bench).getAllByRole('listitem').map(li => li.textContent)).toEqual([
      expect.stringContaining('Bench One'), expect.stringContaining('Bench Two')]);
    expect(screen.queryByText('Away Guy')).toBeNull();
  });

  it('marks both players of a substitution, plus goals and cards, with their minute', () => {
    const players = [...home11(), player('b1', { name: 'Sub On', jersey: '14' })];
    const announcements = [
      ann({ id: 's', kind: 'substitution', primaryPlayerId: 'b1', secondaryPlayerId: 'h11', minuteLabel: "70'" }),
      ann({ id: 'g', kind: 'goal', primaryPlayerId: 'h9', minuteLabel: "12'" }),
      ann({ id: 'y', kind: 'yellow', primaryPlayerId: 'h3', minuteLabel: "40'" }),
      ann({ id: 'f', kind: 'foul', primaryPlayerId: 'h4' }),
      ann({ id: 'x', kind: 'goal', side: 'away', primaryPlayerId: 'zz' }),
    ];
    view({ players, announcements });
    const xi = screen.getByRole('list', { name: 'Starting XI' });
    const bench = screen.getByRole('list', { name: 'Substitutes' });
    expect(within(bench).getByLabelText("SUBSTITUTION · On 70'")).toBeInTheDocument();
    expect(within(xi).getByLabelText("SUBSTITUTION · Off 70'")).toBeInTheDocument();
    expect(within(xi).getByLabelText("GOAL 12'")).toBeInTheDocument();
    expect(within(xi).getByLabelText("YELLOW CARD 40'")).toBeInTheDocument();
    expect(within(xi).queryByLabelText(/FOUL/)).toBeNull();
    const pitch = screen.getByRole('group', { name: /formation/ });
    expect(within(pitch).getByLabelText("GOAL 12'")).toBeInTheDocument();
    expect(within(pitch).getByLabelText("SUBSTITUTION · Off 70'")).toBeInTheDocument();
  });

  it('calls onSelect with the player id from the pitch and from the list', () => {
    const onSelect = vi.fn();
    view({ onSelect });
    const pitch = screen.getByRole('group', { name: /formation/ });
    fireEvent.click(within(pitch).getByRole('button', { name: /Player h9/ }));
    fireEvent.click(within(screen.getByRole('list', { name: 'Starting XI' })).getByRole('button', { name: /Player h1\b/ }));
    expect(onSelect.mock.calls).toEqual([['h9'], ['h1']]);
  });

  it('uses kit colours (keeper kit for the goalkeeper) and the cast number, never another player\'s', () => {
    const players = home11().map(p => p.id === 'h5' ? { ...p, jersey: { value: null, provenance: 'unavailable' as const, refs: [] } } : p);
    const cast = castOf({ h1: { number: '1', displayName: 'Lehmann' }, h2: { number: '12', displayName: 'Lauren' } });
    view({ players, cast });
    const pitch = screen.getByRole('group', { name: /formation/ });
    const keeper = within(pitch).getByRole('button', { name: /Lehmann/ });
    expect(keeper.dataset.shirt).toBe('#222222');
    expect(keeper.querySelector('text')?.getAttribute('fill')).toBe('#eeeeee');
    const rb = within(pitch).getByRole('button', { name: /Lauren/ });
    expect(rb.dataset.shirt).toBe('#ef0107');
    expect(rb.querySelector('text')?.textContent).toBe('12');
    const noNumber = within(pitch).getByRole('button', { name: /Player h5/ });
    expect(noNumber.querySelector('text')?.textContent).toBe('—');
  });

  it('renders Spanish labels and both teams side by side', () => {
    localStorage.setItem('timepitch.locale', 'es');
    const away = XI_4231.map((role, i) => player(`a${i + 1}`, { side: 'away', role, starter: true }));
    render(<LanguageProvider><LineupsPair
      home={{ side: 'home', teamName: 'Arsenal', formation: '4-2-3-1', players: home11(), cast: null, announcements: [], onSelect: () => {} }}
      away={{ side: 'away', teamName: 'Man City', formation: null, players: away, cast: null, announcements: [], onSelect: () => {} }} />
    </LanguageProvider>);
    expect(screen.getByRole('group', { name: 'Arsenal formación 4-2-3-1' })).toBeInTheDocument();
    expect(screen.getByText('Formación no disponible en la fuente')).toBeInTheDocument();
    expect(screen.getAllByRole('list', { name: 'Once inicial' })).toHaveLength(2);
  });
});

describe('mockup layout (v1-2d)', () => {
  it('shows crest fallback, Home label and position · nation only when the record has a nation', () => {
    const cast = castOf({
      h1: { number: '1', displayName: 'Lehmann', record: { qid: null, number: '1', display: 'Lehmann', position: null, nation: 'Germany', dob: null, heightCm: null, fields: {} } },
      h2: { number: '12', displayName: 'Lauren' },
    });
    view({ cast });
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(document.querySelector('.tp-crest--none')?.textContent).toBe('A');
    const xi = screen.getByRole('list', { name: 'Starting XI' });
    expect(within(xi).getByText('GK · Germany')).toBeInTheDocument();
    expect(within(xi).getByText('RB')).toBeInTheDocument();
    expect(within(xi).queryByText(/RB ·/)).toBeNull();
  });

  it('shows an honest empty bench when the source has no substitutes', () => {
    view();
    expect(screen.queryByRole('list', { name: 'Substitutes' })).toBeNull();
    expect(screen.getByText('None in source')).toBeInTheDocument();
  });

  it('builds recorded-match facts (engine, seed) and a sim chip, never a date, venue or referee', () => {
    const { facts, chips } = matchMetaFromDescriptor({ metadata: { synthetic: true, engine: 'grf', engineVersion: '1.2', seed: 43 } }, 'es',
      { fictional: 'Partido ficticio', kits: { choice: 'estimated' } });
    expect(facts).toEqual([{ label: 'Motor', value: 'grf 1.2' }, { label: 'Semilla', value: '43' }]);
    expect(chips).toEqual([{ kind: 'sim', text: 'Simulado · grf' }, { kind: 'ph', text: 'Partido ficticio' },
      { kind: 'ph', text: 'Colores provisionales, pendiente de fuente' }]);
  });

  it('builds historical facts only from source fields', () => {
    const { facts, chips } = matchMetaFromDescriptor({ metadata: { source: 'StatsBomb Open Data', date: '2003-08-16', kickOff: '15:00:00.000', season: '2003/2004' } }, 'en');
    expect(facts).toEqual([{ value: '2003-08-16 · 15:00' }, { label: 'Season', value: '2003/2004' }]);
    expect(chips).toEqual([{ kind: 'hist', text: 'Lineups · StatsBomb Open Data' }]);
    expect(matchMetaFromDescriptor({}, 'en')).toEqual({ facts: [], chips: [] });
  });

  it('renders the meta bar with score, non-empty facts and chips above the lineups', () => {
    render(<LanguageProvider><LineupsPair
      meta={{ home: { name: 'Arsenal', short: 'ARS' }, away: { name: 'Man City', short: 'MCI' }, score: { home: 2, away: 1 },
        facts: [{ label: 'Engine', value: 'grf' }, { label: 'Referee', value: null }], chips: [{ kind: 'sim', text: 'Simulated' }] }}
      home={{ side: 'home', teamName: 'Arsenal', formation: '4-2-3-1', players: home11(), cast: null, announcements: [], onSelect: () => {} }}
      away={{ side: 'away', teamName: 'Man City', formation: null, players: [], cast: null, announcements: [], onSelect: () => {} }} />
    </LanguageProvider>);
    const bar = screen.getByRole('region', { name: 'Match details' });
    expect(bar.textContent).toContain('ARS 2 – 1 MCI');
    expect(within(bar).getByText('grf')).toBeInTheDocument();
    expect(bar.textContent).not.toContain('Referee');
    expect(within(bar).getByText('Simulated')).toHaveClass('chip', 'sim');
  });

  it('shows a dash instead of a score when none is given', () => {
    render(<LanguageProvider><MatchMetaBar home={{ name: 'Arsenal' }} away={{ name: 'Man City' }} /></LanguageProvider>);
    expect(screen.getByRole('region', { name: 'Match details' }).textContent).toContain('Arsenal – Man City');
  });

  it('folds the technical player list when collapsible', () => {
    render(<LanguageProvider><MatchPlayers players={home11()} onSelect={() => {}} collapsible summary="Technical list" /></LanguageProvider>);
    const details = screen.getByText('Technical list').closest('details')!;
    expect(details).not.toHaveAttribute('open');
    expect(within(details).getByRole('table', { name: 'Players' })).toBeInTheDocument();
  });
});
