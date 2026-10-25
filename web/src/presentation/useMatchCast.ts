// G16 · Hook del MatchCast: carga las plantillas públicas de los dos equipos (solo los de la demo tienen) y
// construye el cast. Mientras cargan, `cast` es `null` (los renderizadores usan sus colores por lado); si la carga
// falla, el cast se construye sin fichas (aspecto genérico), nunca con datos de otro jugador.
import { useEffect, useMemo, useState } from 'react';
import { resolveCrest } from '../catalog/crest-resolver';
import { loadSquad, squadUrl } from '../catalog/player-registry';
import type { PlayerView, SessionDescriptor } from '../match-centre/session';
import { buildMatchCast, castSignature, type BuiltMatchCast } from './cast';
import type { CrestRef, PlayerRecord } from './types';

type Squads = Readonly<{ home: readonly PlayerRecord[]; away: readonly PlayerRecord[] }>;
const EMPTY: Squads = Object.freeze({ home: [], away: [] });

async function settle(teamKey: string, signal: AbortSignal): Promise<readonly PlayerRecord[]> {
  try { return await loadSquad(teamKey, signal); } catch (error) {
    if (signal.aborted) throw error;
    return [];
  }
}

export function useMatchCast(descriptor: SessionDescriptor, players: readonly PlayerView[]): {
  cast: BuiltMatchCast | null; crests: { home: CrestRef; away: CrestRef };
} {
  const homeKey = descriptor.home.id, awayKey = descriptor.away.id, source = descriptor.identity.source;
  const teamsKey = `${homeKey}\u0000${awayKey}`;
  const needsFetch = squadUrl(homeKey) !== null || squadUrl(awayKey) !== null;
  const [loaded, setLoaded] = useState<{ teams: string; squads: Squads } | null>(null);

  useEffect(() => {
    if (!needsFetch) return;
    const controller = new AbortController();
    Promise.all([settle(homeKey, controller.signal), settle(awayKey, controller.signal)])
      .then(([home, away]) => { if (!controller.signal.aborted) setLoaded({ teams: teamsKey, squads: { home, away } }); })
      .catch(() => { /* abortado: otro partido */ });
    return () => controller.abort();
  }, [homeKey, awayKey, teamsKey, needsFetch]);

  const squads: Squads | null = !needsFetch ? EMPTY : loaded?.teams === teamsKey ? loaded.squads : null;

  // Mismo objeto mientras no cambie ningún campo de identidad (evita recrear jugadores en el 3D): la dependencia
  // es la firma, no la referencia del array, que cambia en cada instantánea.
  const signature = castSignature(players);
  const cast = useMemo(
    () => (squads ? buildMatchCast({ source, homeKey, awayKey, players, squads }) : null),
    [squads, source, homeKey, awayKey, signature],
  );
  const crests = useMemo(() => ({ home: resolveCrest(homeKey), away: resolveCrest(awayKey) }), [homeKey, awayKey]);
  return { cast, crests };
}
