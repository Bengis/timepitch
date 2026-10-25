import { render, screen, fireEvent,within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { isLocalPreview, LanguageProvider, LanguageSelector } from '../i18n';
import { TeamSelector } from './TeamSelector';
import { Roster } from './Roster';
import type { TeamSummary, TeamSeason } from '../api';

const summary: TeamSummary = {
  key: 'example:2003', club: 'example', name: 'Example Club', season_start: 2003,
  season_label: '2003/04', source: 'epldata', results_sources: ['football-data'], dataset_version: 'fixture', player_count: 1,
  matches: 38, goals_for: 1, goals_against: 2, available_formations: [],
  coverage: { minutes: 'estimated' }, quality_flags: ['minutes_estimated'],
};
const roster: TeamSeason = { ...summary, players: [{
  key: 'epldata:2003:example:1', source_id: '1', name: 'Example Player', role: null,
  quality_flags: ['unknown_role'], stats: {
    appearances: { value: 3, source: 'epldata', status: 'measured', unit: 'count' },
    minutes: { value: 125, source: 'epldata', status: 'estimated', unit: 'minutes' },
    goals: { value: 0, source: 'epldata', status: 'measured', unit: 'count' },
    assists: { value: null, source: 'epldata', status: 'unavailable', unit: 'count' },
  },
}] };

describe('catalogue interactions', () => {
  it('filters by search and season without silently changing the selected opponent', () => {
    const other = { ...summary, key: 'other:2017', name: 'Other Club', season_start: 2017, season_label: '2017/18' };
    let selected = summary.key;
    render(<LanguageProvider><TeamSelector side="home" teams={[summary, other]} value={summary.key} onChange={key => { selected = key; }} /></LanguageProvider>);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Other' } });
    expect(screen.getByRole('option', { name: 'Other Club · 2017/18' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Example Club · 2003/04' })).not.toBeInTheDocument();
    expect(selected).toBe(summary.key);
    fireEvent.change(screen.getByLabelText('Team and season'), { target: { value: other.key } });
    expect(selected).toBe('other:2017');
    fireEvent.change(screen.getByLabelText('Season'), { target: { value: '2003' } });
    expect(screen.getByText('No teams match these filters.')).toBeInTheDocument();
  });

  it('starts in English and switches the visible controls to Spanish', () => {
    render(<LanguageProvider><LanguageSelector /><TeamSelector side="away" teams={[summary]} value={summary.key} onChange={() => {}} /></LanguageProvider>);
    expect(screen.getByText('Away team')).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('en');
    fireEvent.click(screen.getByRole('button', { name: 'Language: Español' }));
    expect(screen.getByText('Equipo visitante')).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('es');
    expect(localStorage.getItem('timepitch.locale')).toBe('es');
    // TP211: banderas como botones con estado pulsado y nombre accesible en el idioma activo.
    expect(screen.getByRole('group', { name: 'Idioma' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Idioma: Español' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Idioma: English' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Idioma: English' }));
    expect(document.documentElement.lang).toBe('en');
  });

  it('labels the local preview only on loopback hosts (TP211)', () => {
    expect(['localhost', '127.0.0.1', '[::1]', 'timepitch.localhost'].every(host => isLocalPreview(host))).toBe(true);
    expect(['timepitch.diloclaro.app', '192.0.2.250', 'example.com'].some(host => isLocalPreview(host))).toBe(false);
  });

  it('shows unknown position and missing assists distinctly from measured zero goals', () => {
    render(<LanguageProvider><Roster team={roster} /></LanguageProvider>);
    const basic=within(screen.getByRole('region',{name:/Example Club/}));
    expect(basic.getByText('Example Player')).toBeInTheDocument();
    expect(basic.getByText('Unknown position')).toBeInTheDocument();
    expect(basic.getByText('125')).toHaveAttribute('title', 'Estimated');
    expect(basic.getByText('0')).toHaveAttribute('title', 'Measured');
    expect(basic.getByText('—')).toHaveAttribute('title', 'Unavailable');
  });
});
