// open-football grabado (bfb2273 + parche de esfuerzo del harness, en una copia). Altura del balón en metros.
import { arr, fail, num, obj, str, type EngineProfile, type RecordedPlayer } from './recorded-track';

export const OPEN_FOOTBALL_PROFILE: EngineProfile = {
  engine: 'open-football',
  versions: ['open-football-bfb2273-harness'],
  ballHeight: 'metres',
  period: (s, i) => { const p = num(s.period, `samples[${i}].period`); return p === 1 || p === 2 ? p : fail('invalid_recording', `samples[${i}].period ${p}`); },
  // Su `input.config` no repite la lista de catálogo: los ids por puesto vienen de `input.players[].source_key`.
  configPlayers: false,
  nativeId: p => Array.isArray(p.native_ids) && typeof p.native_ids[0] === 'string' ? p.native_ids[0] : null,
  scorers: (raw, goals, players) => {
    const native = arr(obj(raw.open_football, 'open_football').goals, 'open_football.goals').map(g => obj(g, 'open_football goal'));
    if (native.length !== goals.length) fail('identity_mismatch', `open-football lists ${native.length} goals, samples show ${goals.length}`);
    return goals.map((g, k): RecordedPlayer | null => {
      if (native[k].side !== g.side) fail('identity_mismatch', `goal ${k} side ${String(native[k].side)} is not ${g.side}`);
      return players.find(p => p.nativeId === String(native[k].scorer_id)) ?? null;
    });
  },
  upstream: raw => {
    const of = obj(raw.open_football, 'open_football');
    return { url: str(of.upstream, 'open_football.upstream'), commit: str(of.commit, 'open_football.commit'), licence: str(of.licence, 'open_football.licence') };
  },
};
