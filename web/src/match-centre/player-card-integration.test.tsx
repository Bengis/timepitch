// G17 · Al elegir un jugador con identidad revisada (ficha o aspecto asignado a mano) se abre la ficha G12;
// el cast llega también al campo. El cast se simula para no depender de los registros públicos.
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MatchCentre } from './MatchCentre';
import { createRecordedSession } from './adapters/recorded-session';
import { ENGINE_PROFILES } from './adapters/recorded-replay';
import { normalizeRecording } from './adapters/recorded-track';
import { rawRecording } from './adapters/recorded-fixtures';
import { GENERIC_APPEARANCE, type CastEntry, type KitSpec, type MatchCast } from '../presentation/types';

const kit: KitSpec = { shirt: '#034694', sleeves: { left: '#034694', right: '#034694' }, shorts: '#034694', socks: '#ffffff', trim: '#ffffff', number: '#ffffff',
  collar: 'crew', pattern: { body: 'plain', sleeves: 'plain', shorts: 'plain', socks: 'plain' }, source: { kind: 'generic', licence: 'n/a' } };
const linked: CastEntry = { number: '8', displayName: 'Linked Player', appearance: GENERIC_APPEARANCE, appearanceSource: 'hand_assigned',
  record: { qid: 'Q1', number: '8', display: 'Linked Player', position: 'Midfielder', nation: null, dob: null, heightCm: null, fields: {} } };
const cast: MatchCast = { kits: { home: kit, away: kit, homeKeeper: kit, awayKeeper: kit, choice: 'source' },
  players: new Map([['touchlines:home:epldata:2015:chelsea:P8', linked]]) };
const crest = { src: '', kind: 'none' as const, source: null };
vi.mock('../presentation/useMatchCast', () => ({ useMatchCast: () => ({ cast, crests: { home: crest, away: crest } }) }));

describe('player selection with a cast', () => {
  it('opens the player card for a linked player and the technical detail for an unlinked one', async () => {
    const adapter = createRecordedSession('tl', normalizeRecording(rawRecording('touchlines'), ENGINE_PROFILES.touchlines));
    render(<MatchCentre adapter={adapter} visible onBack={() => {}} initialSection="players" matchLabel="Fictional cross-era simulation" />);
    const rows = await screen.findAllByRole('button', { name: /Linked Player/ });
    fireEvent.click(rows[0]);
    const card = screen.getByRole('dialog', { name: 'Player card: Linked Player' });
    expect(card).toHaveTextContent('8');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'home 3' })[0]);
    expect(screen.getByRole('dialog', { name: 'Player detail' })).toBeInTheDocument();
  });
});
