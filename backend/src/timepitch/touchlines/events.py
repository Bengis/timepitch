"""Eventos grabados de TouchLines en formato `recorded-events-1` (TP202, movido aquí en TP243).

Lo usan el exportador de grabaciones (`scripts/export_recorded_events.py`) y el servicio en vivo de TouchLines. Solo
se traduce lo que el motor grabó; lo demás se cuenta en `skipped` y se deja fuera.
"""
from __future__ import annotations

from collections import Counter

KINDS = ('kickoff', 'pass', 'shot', 'shot_on_target', 'save', 'goal', 'own_goal', 'foul', 'card_yellow', 'card_red',
         'offside', 'corner', 'free_kick', 'throw_in', 'penalty', 'substitution', 'possession_change', 'halftime', 'fulltime')
SIDES = ('home', 'away')


class Builder:
    """Common event construction over one recording (samples, players, periods)."""

    def __init__(self, rec: dict, period_of):
        self.rec, self.samples, self.period_of = rec, rec['samples'], period_of
        self.players = {(p['side'], p['slot']): p for p in rec['input']['players']}
        self.events: list[dict] = []
        self.skipped: Counter = Counter()

    def index_at(self, t_ms: float) -> int:
        # First sample at or after the event (as GRF's own sample_index): an open-football second-half kick-off at
        # 2 700 410 ms belongs to sample 27 005, the first one of period 2, not to the last of period 1.
        return max(0, min(len(self.samples) - 1, -(-int(t_ms) // 100)))

    def add(self, kind: str, t_ms: float, sample_index: int, native: str, side: str | None = None, slot: int | None = None,
            xy=None, extra: dict | None = None):
        assert kind in KINDS, kind
        s = self.samples[sample_index]
        if xy is None:  # recorded position of the actor in the same sample, else the recorded ball
            xy = (s['home_xy'] if side == 'home' else s['away_xy'])[slot] if side and slot is not None else s['ball_xyz'][:2]
        player = self.players.get((side, slot)) if side and slot is not None else None
        self.events.append({'t_ms': int(round(t_ms)), 'sample_index': sample_index, 'period': self.period_of(s),
                            'match_ms': s['match_time_ms'], 'kind': kind, 'side': side, 'slot': slot,
                            'player_id': player['id'] if player else None, 'x': round(xy[0], 5), 'y': round(xy[1], 5),
                            'native': native, **({'extra': extra} if extra else {})})

    def periods(self):
        """Half-time at the first sample of the next period, full time at the last sample (both recorded state)."""
        last = None
        for i, s in enumerate(self.samples):
            p = self.period_of(s)
            if last is not None and p != last:
                self.add('halftime', i * 100, i, 'samples.period')
            last = p
        n = len(self.samples) - 1
        self.add('fulltime', n * 100, n, 'samples.last')


# ── TouchLines: harness subscription to the engine bus (touchlines.events) + set pieces from samples.game_mode ──
TL_PHASE = {'firstHalf': 1, 'halfTime': 1, 'secondHalf': 2, 'matchEnd': 2}
TL_MODE = {1: 'kickoff', 3: 'free_kick', 4: 'corner', 5: 'throw_in'}  # harness MODE: kickoff 1, goal_kick 2, offside_fk 3, corner 4, throw_in 5


def touchlines(rec: dict) -> Builder:
    b = Builder(rec, lambda s: TL_PHASE[s['tl_match_phase']])
    slot = {p['touchlines_engine_id']: (p['side'], p['slot']) for p in rec['input']['players']}
    keeper = {p['side']: p['slot'] for p in rec['input']['players'] if p.get('touchlines_role') == 'GK'}
    team = {'A': 'home', 'B': 'away'}
    events = rec['touchlines']['events']
    resolved = [e for e in events if e['type'] == 'shotResolved']
    for e in events:
        t, i = e['tick'] * 100, min(e['tick'], len(b.samples) - 1)
        kind = e['type']
        if kind == 'passAttempted':
            to = slot.get(e.get('toId'))
            b.add('pass', t, i, kind, *slot[e['player']], extra={'to_slot': to[1] if to else None, 'distance_yd': round(e['distance'], 2)})
        elif kind in ('interception', 'tackle') and e.get('success') is True:
            b.add('possession_change', t, i, kind, *slot[e['player']])
        elif kind == 'shot':
            # Outcome from the engine's own resolution of this shot (next shotResolved of the same shooter).
            res = next((r for r in resolved if r['tick'] >= e['tick'] and r['player'] == e['player']), None)
            outcome = None if res is None else 'goal' if res['isGoal'] else 'saved' if res['inPosts'] else 'off_target'
            b.add('shot', t, i, kind, *slot[e['player']], extra={'xg': round(e['xg'], 4), 'outcome': outcome,
                                                                 'resolved_t_ms': res['tick'] * 100 if res else None})
        elif kind == 'shotResolved':
            side, s = slot[e['player']]
            if e['inPosts']:
                b.add('shot_on_target', t, i, kind, side, s, extra={'outcome': 'goal' if e['isGoal'] else 'saved'})
            if e['inPosts'] and not e['isGoal']:
                # Engine branch `defendingGK && inPosts && !isGoal` (gkSave): the defending GK by recorded role.
                other = 'away' if side == 'home' else 'home'
                b.add('save', t, i, kind, other, keeper.get(other), extra={'shooter_slot': s})
        elif kind == 'goalScored':
            b.add('goal', t, i, kind, *slot[e['scorerId']], extra={'assist_slot': slot[e['assistId']][1] if e.get('assistId') in slot else None})
        elif kind == 'offsideCalled':
            side, s = slot[e['receiverId']]
            assert team[e['team']] == side
            b.add('offside', t, i, kind, side, s)
        else:
            b.skipped[kind] += 1
    prev = 0
    for i, s in enumerate(b.samples):
        mode = s['game_mode']
        if mode and mode != prev:
            if mode in TL_MODE:
                owner = (SIDES[s['owner_team']], s['owner_slot']) if s['owner_team'] in (0, 1) else (None, None)
                b.add(TL_MODE[mode], i * 100, i, f'samples.game_mode={mode}', *owner,
                      extra={'reason': 'offside'} if mode == 3 else None)
            else:
                b.skipped[f'samples.game_mode={mode}'] += 1
        prev = mode
    b.periods()
    return b
