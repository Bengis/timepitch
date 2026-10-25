// TouchLines grabado (5c5c71a): reloj físico (TIME_SCALE 1, 0,1 s por tick = 0,1 s de partido) o, desde TP243, su reloj
// original (TIME_SCALE 18, partes de 150 s reales) con el reloj de partido escrito en cada muestra.
// TouchLines no modela la altura del balón: su `ball_xyz[2]` es siempre 0 y aquí queda ausente, nunca inventada.
import { arr, fail, obj, str, type EngineProfile, type RecordedPlayer } from './recorded-track';

const PHASE: Readonly<Record<string, number>> = { firstHalf: 1, halfTime: 1, secondHalf: 2, matchEnd: 2 };

export const TOUCHLINES_PROFILE: EngineProfile = {
  engine: 'touchlines',
  versions: ['touchlines-5c5c71a-freeplay', 'touchlines-5c5c71a-native'],
  ballHeight: 'absent',
  period: (s, i) => PHASE[str(s.tl_match_phase, `samples[${i}].tl_match_phase`)] ?? fail('invalid_recording', `samples[${i}].tl_match_phase ${String(s.tl_match_phase)}`),
  configPlayers: true,
  nativeId: p => typeof p.touchlines_engine_id === 'number' ? String(p.touchlines_engine_id) : null,
  // `goalScored` lleva el tick (= índice de muestra) y el id nativo del autor.
  scorers: (raw, goals, players) => {
    const tl = obj(raw.touchlines, 'touchlines');
    if (tl.physical_clock !== true && tl.native_clock !== true) fail('unsupported_version', 'TouchLines recordings must carry a match clock (physical or native)');
    const scored = arr(tl.events, 'touchlines.events').map(e => obj(e, 'touchlines event')).filter(e => e.type === 'goalScored');
    if (scored.length !== goals.length) fail('identity_mismatch', `TouchLines lists ${scored.length} goals, samples show ${goals.length}`);
    return goals.map((g, k): RecordedPlayer | null => {
      const e = scored[k];
      if (e.tick !== g.sampleIndex) fail('identity_mismatch', `goal ${k} tick ${String(e.tick)} is not sample ${g.sampleIndex}`);
      return players.find(p => p.nativeId === String(e.scorerId)) ?? null;
    });
  },
  upstream: raw => {
    const tl = obj(raw.touchlines, 'touchlines');
    return { url: str(tl.upstream, 'touchlines.upstream'), commit: str(tl.commit, 'touchlines.commit'), licence: str(tl.licence, 'touchlines.licence') };
  },
};
