"""Build a new, immutable historical dataset; never rewrite provider files."""
import argparse
from collections import Counter
from datetime import date
import hashlib
import json
import math
from pathlib import Path
import re
import sqlite3
from uuid import UUID

from .models import (PINNED_SNAPSHOT, FixtureAudit, HistoricalEvent, HistoricalLineup,
                     HistoricalManifest, HistoricalMatch, HistoricalPlayer, HistoricalTeam,
                     HistoricalPoint, SourceManifest)
from .source import DOCUMENTS, canonical, contained, digest, download_snapshot, read_json

DETAIL_FIELDS = ('pass', 'shot', 'carry', 'tactics', 'substitution', 'bad_behaviour',
                 'foul_committed', 'foul_won', 'goalkeeper', 'ball_receipt', 'ball_recovery',
                 'duel', 'interception', 'block', 'dribble', '50_50', 'clearance', 'player_off',
                 'under_pressure', 'counterpress', 'play_pattern', 'out', 'off_camera')


class SourceProblem(ValueError):
    pass


def identifier(value):
    if type(value) is not int or value <= 0:
        raise SourceProblem('invalid_identity')
    return value


def key(value):
    return 'statsbomb:'+str(identifier(value))


def period_milliseconds(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d{2}:\d{2}:\d{2}\.\d{3}', value):
        raise SourceProblem('invalid_timestamp')
    hours, minutes, seconds = value.split(':')
    whole, fraction = seconds.split('.')
    if int(minutes) > 59 or int(whole) > 59:
        raise SourceProblem('invalid_timestamp')
    return ((int(hours)*60+int(minutes))*60+int(whole))*1000+int(fraction)


def source_coordinates(value):
    if value is None:
        return None
    if (not isinstance(value, list) or len(value) not in (2, 3) or
        any(type(v) not in (int, float) or not math.isfinite(v) for v in value)):
        raise SourceProblem('invalid_location')
    return value


def projected(value, issues):
    # Provider attacking frame only. Canonical side/half orientation belongs to phase 2.
    if value is None:
        return None
    if not 0 <= value[0] <= 120 or not 0 <= value[1] <= 80:
        issues.append('location_outside_nominal_pitch')
        return None
    return HistoricalPoint(x=value[0]*105/120, y=value[1]*68/80)


def fixture_model(record, season):
    identifier(record['match_id'])
    if record['competition']['competition_id'] != 2 or record['season']['season_id'] != season:
        raise SourceProblem('calendar_scope_mismatch')
    date.fromisoformat(record['match_date'])
    def team(side):
        raw = record[side+'_team']
        source_id = identifier(raw[side+'_team_id'])
        return HistoricalTeam(key=key(source_id), source_id=source_id, name=raw[side+'_team_name'])
    home, away = team('home'), team('away')
    if home.key == away.key:
        raise SourceProblem('identical_match_teams')
    score = {side: record[side+'_score'] for side in ('home', 'away')}
    if any(type(value) is not int or value < 0 for value in score.values()):
        raise SourceProblem('invalid_final_score')
    return HistoricalMatch(id=record['match_id'], key=key(record['match_id']), season_id=season,
                           season_name=record['season']['season_name'], date=record['match_date'],
                           kick_off=record.get('kick_off'), home_team=home, away_team=away,
                           final_score=score, status='metadata_only')


def normalize_lineups(raw, match):
    if not isinstance(raw, list) or len(raw) != 2:
        raise SourceProblem('invalid_lineups')
    result, teams_seen, players_seen = [], set(), set()
    expected = {match.home_team.key, match.away_team.key}
    for entry in raw:
        team_key = key(entry['team_id'])
        if team_key not in expected or team_key in teams_seen:
            raise SourceProblem('lineup_team_mismatch')
        teams_seen.add(team_key)
        players = []
        for player in entry['lineup']:
            player_key = key(player['player_id'])
            if player_key in players_seen:
                raise SourceProblem('repeated_lineup_player')
            players_seen.add(player_key)
            players.append(HistoricalPlayer(key=player_key, source_id=player['player_id'], name=player['player_name'],
                jersey_number=player.get('jersey_number'), positions=player.get('positions', []), cards=player.get('cards', [])))
        result.append(HistoricalLineup(team_key=team_key, players=players))
    return result


def normalize_events(raw, match, lineups):
    if not isinstance(raw, list) or not raw:
        raise SourceProblem('empty_or_invalid_events')
    seen, indices, result, issues = {}, set(), [], set()
    known_players = {p.key for lineup in lineups for p in lineup.players}
    by_team = {lineup.team_key:{p.key for p in lineup.players} for lineup in lineups}
    teams = {match.home_team.key, match.away_team.key}
    for entry in raw:
        if not isinstance(entry, dict) or not isinstance(entry.get('id'), str):
            raise SourceProblem('invalid_event_id')
        for field in ('tactics', 'pass', 'shot', 'carry', 'substitution'):
            if field in entry and not isinstance(entry[field], dict):
                raise SourceProblem('invalid_event_details')
        event_id = str(UUID(entry['id']))
        encoded = canonical(entry)
        if event_id in seen:
            if seen[event_id] != encoded:
                raise SourceProblem('conflicting_event_id')
            issues.add('repeated_identical_event')
            continue
        seen[event_id] = encoded
        source_index = identifier(entry['index'])
        if source_index in indices:
            raise SourceProblem('conflicting_event_index')
        indices.add(source_index)
        event_issues = []
        team_key = key(entry['team']['id']) if entry.get('team') else None
        player_key = key(entry['player']['id']) if entry.get('player') else None
        if team_key is not None and team_key not in teams:
            raise SourceProblem('event_team_mismatch')
        if team_key is None:
            event_issues.append('event_team_missing')
        possession_team_key = key(entry['possession_team']['id']) if entry.get('possession_team') else None
        if possession_team_key is not None and possession_team_key not in teams:
            event_issues.append('unknown_possession_team')
        if player_key and (player_key not in known_players or player_key not in by_team.get(team_key, set())):
            event_issues.append('unknown_player_reference')
        for nested in (entry.get('pass', {}).get('recipient'), entry.get('substitution', {}).get('replacement')):
            if nested and key(nested['id']) not in by_team.get(team_key, set()):
                event_issues.append('unknown_player_reference')
        for position in entry.get('tactics', {}).get('lineup', []):
            if key(position['player']['id']) not in by_team.get(team_key, set()):
                event_issues.append('unknown_player_reference')
        origin = source_coordinates(entry.get('location'))
        destination = next((entry[name]['end_location'] for name in ('pass', 'carry', 'shot')
                            if isinstance(entry.get(name), dict) and 'end_location' in entry[name]), None)
        destination = source_coordinates(destination)
        origin_point = projected(origin, event_issues)
        destination_point = projected(destination, event_issues)
        duration = entry.get('duration')
        if duration is not None and (type(duration) not in (int, float) or not math.isfinite(duration)):
            raise SourceProblem('invalid_duration_type')
        usable_duration = duration
        if duration is not None and duration < 0:
            usable_duration = None
            event_issues.append('invalid_source_duration')
        event = HistoricalEvent(id=event_id, source_index=source_index, period=entry['period'],
            period_ms=period_milliseconds(entry['timestamp']), minute=entry['minute'], second=entry['second'],
            type=entry['type']['name'], team_key=team_key, player_key=player_key,
            location_source=origin, end_location_source=destination, location=origin_point,
            end_location=destination_point, duration=usable_duration, duration_source=duration,
            related_events=entry.get('related_events', []), possession=entry.get('possession'),
            possession_team_key=possession_team_key,
            details={name:entry[name] for name in DETAIL_FIELDS if name in entry}, issues=sorted(set(event_issues)))
        result.append(event)
        issues.update(event_issues)
    event_ids = set(seen)
    if any(ref not in event_ids for event in result for ref in event.related_events):
        issues.add('unknown_related_event')
    starting = [e for e in result if e.type == 'Starting XI']
    if ({e.team_key for e in starting} != teams or len(starting) != 2 or
            any(len(e.details.get('tactics', {}).get('lineup', [])) != 11 or
                len({p['player']['id'] for p in e.details.get('tactics', {}).get('lineup', [])}) != 11
                for e in starting)):
        issues.add('starting_xi_incomplete')
    return sorted(result, key=lambda e:e.source_index), sorted(issues)


def build_dataset(source_root: Path, output_dir: Path, snapshot: str) -> HistoricalManifest:
    if snapshot != PINNED_SNAPSHOT:
        raise ValueError('Unapproved snapshot')
    source_root, output_dir = Path(source_root), Path(output_dir)
    source_manifest_path = source_root/'source-manifest.json'
    source_manifest = SourceManifest.model_validate(read_json(source_manifest_path))
    if source_manifest.snapshot != snapshot:
        raise ValueError('Source snapshot mismatch')
    sources = {f.path:f for f in source_manifest.files}

    def load(relative, prefix):
        entry = sources.get(relative)
        if not entry or entry.status != 'ok':
            raise SourceProblem(prefix+'_missing')
        path = contained(source_root, relative)
        if not path.is_file():
            raise SourceProblem(prefix+'_missing')
        if path.stat().st_size != entry.size or digest(path) != entry.sha256:
            raise SourceProblem(prefix+'_integrity')
        try:
            return read_json(path)
        except (ValueError, UnicodeError):
            raise SourceProblem(prefix+'_invalid_json') from None

    # Attribution/terms are part of the input closure, without exposing their paths through API.
    for name in DOCUMENTS:
        entry = sources.get(name)
        path = contained(source_root, name)
        if not entry or entry.status != 'ok' or not path.is_file() or digest(path) != entry.sha256:
            raise ValueError('Missing or changed source document')
    calendar = []
    for season in (27, 44):
        raw = load(f'data/matches/2/{season}.json', 'calendar')
        if not isinstance(raw, list):
            raise ValueError('Invalid calendar')
        calendar.extend(fixture_model(record, season) for record in raw)
    if len({m.id for m in calendar}) != len(calendar):
        raise ValueError('Repeated calendar match identity')
    output_dir.mkdir(parents=True, exist_ok=False)
    database_path = output_dir/'historical.sqlite'
    audits = []
    with sqlite3.connect(database_path) as database:
        database.executescript('''
            PRAGMA user_version=1;
            CREATE TABLE matches(id INTEGER PRIMARY KEY,season INTEGER,home INTEGER,away INTEGER,body TEXT NOT NULL);
            CREATE TABLE events(match_id INTEGER,event_id TEXT,period INTEGER,period_ms INTEGER,source_index INTEGER,body TEXT NOT NULL,
                PRIMARY KEY(match_id,event_id));
            CREATE INDEX event_window ON events(match_id,period,period_ms,source_index);
        ''')
        for ordinal, match in enumerate(sorted(calendar, key=lambda m:m.id), 1):
            lineups, events, issues, fatal = [], [], [], False
            try:
                lineups = normalize_lineups(load(f'data/lineups/{match.id}.json', 'lineups'), match)
            except (ValueError, KeyError, TypeError) as error:
                reason = str(error) if isinstance(error, SourceProblem) else 'lineups_invalid'
                issues.append(reason)
                fatal = 'integrity' in reason or reason != 'lineups_missing'
            try:
                events, event_issues = normalize_events(load(f'data/events/{match.id}.json', 'events'), match, lineups)
                issues.extend(event_issues)
            except (ValueError, KeyError, TypeError) as error:
                reason = str(error) if isinstance(error, SourceProblem) else 'events_invalid'
                issues.append(reason)
                fatal = fatal or reason != 'events_missing'
            state = 'excluded' if fatal else 'partial' if issues and set(issues) != {'repeated_identical_event'} else 'facts_ready'
            if state == 'excluded':
                events = []
            count = len(events) if events else None
            match = match.model_copy(update={'lineups':lineups, 'status':state, 'event_count':count, 'issues':sorted(set(issues))})
            database.execute('INSERT INTO matches VALUES(?,?,?,?,?)',
                (match.id, match.season_id, match.home_team.source_id, match.away_team.source_id, match.model_dump_json()))
            database.executemany('INSERT INTO events VALUES(?,?,?,?,?,?)',
                ((match.id, event.id, event.period, event.period_ms, event.source_index, event.model_dump_json()) for event in events))
            audits.append(FixtureAudit(id=match.id, season_id=match.season_id, status=state, event_count=count, issues=match.issues))
            if ordinal % 40 == 0 or ordinal == len(calendar):
                print(f'Historical import {ordinal}/{len(calendar)}', flush=True)
    database_hash = digest(database_path)
    payload = dict(snapshot=snapshot, database_sha256=database_hash, database_bytes=database_path.stat().st_size,
                   source_manifest_sha256=digest(source_manifest_path), source_files=source_manifest.files,
                   matches=audits, counts=dict(Counter(m.status for m in audits)))
    serializable = {**payload, 'source_files':[f.model_dump(mode='json') for f in source_manifest.files],
                    'matches':[m.model_dump(mode='json') for m in audits]}
    version = 'sha256:'+hashlib.sha256(canonical(serializable)).hexdigest()
    manifest = HistoricalManifest(dataset_version=version, **payload)
    (output_dir/'manifest.json').write_bytes(canonical(manifest.model_dump(mode='json')))
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--download', action='store_true')
    parser.add_argument('--pilot', action='store_true', help='Download only the fixed pilot; other fixtures remain partial')
    args = parser.parse_args()
    if args.download:
        download_snapshot(args.source_root, PINNED_SNAPSHOT, match_ids=[3754217] if args.pilot else None)
    result = build_dataset(args.source_root, args.output_dir, PINNED_SNAPSHOT)
    print(json.dumps({'dataset_version':result.dataset_version, 'fixtures':len(result.matches), 'counts':result.counts}))


if __name__ == '__main__':
    main()
