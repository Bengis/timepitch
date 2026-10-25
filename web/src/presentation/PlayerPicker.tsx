// Selector de jugadores de la ficha (maqueta v1-2d.html, `.pc-picker`): chips con el dorsal en un círculo del color
// de la equipación. Nombre y dorsal salen del reparto (MatchCast), los mismos que usan la cronología y las alineaciones;
// sin entrada en el reparto, los de la fila de la fuente. Nada se inventa: sin dorsal, un guion.
import { useLanguage } from '../i18n';
import type { PlayerView } from '../match-centre/session';
import type { KitSpec, MatchCast } from './types';
import './tokens.css';
import './player-card.css';

const TEXT = { en: { label: 'Choose player' }, es: { label: 'Elegir jugador' } } as const;

const KEEPER = /^(gk|goalkeeper|portero)$/i;
const NEUTRAL = { shirt: '#3a4150', ink: '#ffffff' } as const;
const isHex = (c: string | undefined): c is string => !!c && /^#[0-9a-fA-F]{6}$/.test(c);

/** Equipación del jugador según su lado y si es portero; `null` sin reparto. */
export function kitForPlayer(cast: MatchCast | null | undefined, player: Pick<PlayerView, 'side' | 'role'>): KitSpec | null {
  if (!cast || (player.side !== 'home' && player.side !== 'away')) return null;
  const keeper = KEEPER.test(player.role.value ?? '');
  return cast.kits[player.side === 'home' ? (keeper ? 'homeKeeper' : 'home') : (keeper ? 'awayKeeper' : 'away')];
}

export type PickerOption = Readonly<{ id: string; number: string | null; name: string; shirt: string; ink: string }>;

/** Opciones del selector en el orden recibido; quien llama decide qué jugadores ofrecer. */
export function pickerOptions(players: readonly PlayerView[], cast: MatchCast | null | undefined): PickerOption[] {
  return players.map(player => {
    const entry = cast?.players.get(player.id) ?? null;
    const kit = kitForPlayer(cast, player);
    const number = entry ? entry.number : (player.jersey.value ?? null);
    return {
      id: player.id,
      number: number && number.trim() !== '' ? number : null,
      name: entry?.displayName ?? player.name ?? player.id,
      shirt: isHex(kit?.shirt) ? kit!.shirt : NEUTRAL.shirt,
      ink: isHex(kit?.number) ? kit!.number : NEUTRAL.ink,
    };
  });
}

export type PlayerPickerProps = Readonly<{
  options: readonly PickerOption[];
  selectedId: string | null;
  onSelect: (playerId: string) => void;
}>;

export function PlayerPicker({ options, selectedId, onSelect }: PlayerPickerProps) {
  const { locale } = useLanguage();
  const t = TEXT[locale === 'es' ? 'es' : 'en'];
  return <nav className="tp-pc-picker" aria-label={t.label}>
    {options.map(o => <button key={o.id} type="button" aria-pressed={o.id === selectedId} onClick={() => onSelect(o.id)}>
      <span className="n" aria-hidden={o.number == null} style={{ background: o.shirt, color: o.ink }}>{o.number ?? '–'}</span>
      {o.name}
    </button>)}
  </nav>;
}
