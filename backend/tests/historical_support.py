"""Synthetic, minimal StatsBomb-shaped records; not historical observations."""
import hashlib
import json
from pathlib import Path
from uuid import UUID

PIN = '4b73468fc5b0f1950f9f66fada70ad3a4f9327cb'
PILOT = 3754217


def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True).encode('utf-8')


def fixture(match_id=PILOT, season=27):
    return {'match_id': match_id, 'match_date': '2015-09-19', 'kick_off': '11:45:00.000',
            'competition': {'competition_id': 2, 'competition_name': 'Premier League'},
            'season': {'season_id': season, 'season_name': '2015/2016' if season == 27 else '2003/2004'},
            'home_team': {'home_team_id': 33, 'home_team_name': 'Synthetic home'},
            'away_team': {'away_team_id': 1, 'away_team_name': 'Synthetic away'},
            'home_score': 0, 'away_score': 0}


def records():
    lineups = [{'team_id': team, 'team_name': name, 'lineup': [
        {'player_id': start + i, 'player_name': 'Same name' if i == 0 else f'Synthetic {start+i}',
         'jersey_number': i + 1, 'country': {'id': 1, 'name': 'Synthetic'},
         'positions': [], 'cards': [], 'birthday': '2000-01-01'} for i in range(11)]}
        for team, start, name in ((33, 100, 'Synthetic home'), (1, 200, 'Synthetic away'))]
    events = []
    for i, (team, start) in enumerate(((33, 100), (1, 200)), 1):
        events.append({'id': str(UUID(int=i)), 'index': i, 'period': 1,
                       'timestamp': '00:00:00.000', 'minute': 0, 'second': 0,
                       'type': {'id': 35, 'name': 'Starting XI'}, 'team': {'id': team},
                       'tactics': {'formation': 4231, 'lineup': [
                           {'player': {'id': start+j}, 'position': {'id': 1 if j == 0 else 6, 'name': 'Synthetic'}}
                           for j in range(11)]}})
    events.append({'id': str(UUID(int=3)), 'index': 3, 'period': 1,
                   'timestamp': '00:00:00.622', 'minute': 0, 'second': 0,
                   'type': {'id': 30, 'name': 'Pass'}, 'team': {'id': 33},
                   'player': {'id': 100}, 'location': [60, 40], 'duration': .4,
                   'pass': {'recipient': {'id': 101}, 'end_location': [70, 40]}})
    return lineups, events


def write_source(root: Path, *, calendars=None, events=None, lineups=None, missing=(), additional=()):
    root.mkdir(parents=True)
    standard_lineups, standard_events = records()
    bodies = {'data/matches/2/27.json': [fixture()], 'data/matches/2/44.json': [],
              f'data/lineups/{PILOT}.json': standard_lineups if lineups is None else lineups,
              f'data/events/{PILOT}.json': standard_events if events is None else events}
    if calendars is not None:
        bodies.update({f'data/matches/2/{season}.json': value for season, value in calendars.items()})
    for match_id in additional:
        bodies[f'data/lineups/{match_id}.json'] = standard_lineups
        bodies[f'data/events/{match_id}.json'] = standard_events
    files = []
    for relative, body in bodies.items():
        if relative in missing:
            continue
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        data = encoded(body)
        path.write_bytes(data)
        files.append({'path': relative, 'sha256': hashlib.sha256(data).hexdigest(),
                      'size': len(data), 'status': 'ok', 'reason': None})
    for relative, data in [('README.md', b'Synthetic test terms. Not permission for publication.'),
                           ('LICENSE.pdf', b'Synthetic license fixture'),
                           ('doc/Open Data Events v4.0.0.pdf', b'Synthetic event specification'),
                           ('doc/Open Data Lineups v2.0.0.pdf', b'Synthetic lineup specification'),
                           ('doc/Open Data Matches v3.0.0.pdf', b'Synthetic match specification')]:
        (root / relative).parent.mkdir(parents=True, exist_ok=True)
        (root / relative).write_bytes(data)
        files.append({'path': relative, 'sha256': hashlib.sha256(data).hexdigest(),
                      'size': len(data), 'status': 'ok', 'reason': None})
    manifest = {'snapshot': PIN, 'files': files, 'requested_matches': [PILOT], 'errors': []}
    (root / 'source-manifest.json').write_bytes(encoded(manifest))
    return root
