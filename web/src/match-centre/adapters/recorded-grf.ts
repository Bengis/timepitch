// GRF grabado (juego libre, reloj físico, binario de actividad `ea7b78bf…`). Altura del balón en metros.
import { arr, fail, num, obj, type EngineProfile } from './recorded-track';

export const GRF_PROFILE: EngineProfile = {
  engine: 'grf',
  versions: ['grf-2.10.2-activity-1'],
  ballHeight: 'metres',
  period: (s, i) => { const p = num(s.period, `samples[${i}].period`); return p === 1 || p === 2 ? p : fail('invalid_recording', `samples[${i}].period ${p}`); },
  configPlayers: true,
  nativeId: () => null,
  // El export grf-experimental-1 solo guarda el marcador de cada gol (grf_physical.goals), no el autor.
  scorers: (raw, goals) => {
    const native = arr(obj(raw.grf_physical, 'grf_physical').goals, 'grf_physical.goals');
    if (native.length !== goals.length) fail('identity_mismatch', `grf_physical lists ${native.length} goals, samples show ${goals.length}`);
    return goals.map(() => null);
  },
  upstream: () => ({ url: 'https://github.com/google-research/football', commit: null, licence: 'Apache-2.0' }),
};
