"""Read-only, hash-bound access to a separately built historical snapshot."""
from contextlib import contextmanager
import hashlib
from pathlib import Path
import sqlite3

from .models import HistoricalEvent, HistoricalEventPage, HistoricalManifest, HistoricalMatch, HistoricalPage, HistoricalSeason
from .source import canonical, digest
from .clock import build_clock, orient_event
from .models import PeriodPoint
from .statistics import reduce_statistics


class HistoricalRepository:
    def __init__(self, dataset_dir: Path):
        self.root = Path(dataset_dir).resolve()
        self.path = self.root/'historical.sqlite'
        self.manifest_path = self.root/'manifest.json'
        if self.manifest_path.stat().st_size > 1024**2:
            raise ValueError('Historical manifest too large')
        self.manifest = HistoricalManifest.model_validate_json(self.manifest_path.read_bytes())
        identity_fields = ('snapshot', 'database_sha256', 'database_bytes', 'source_manifest_sha256',
                           'source_files', 'matches', 'counts')
        payload = self.manifest.model_dump(mode='json')
        version = 'sha256:'+hashlib.sha256(canonical({k:payload[k] for k in identity_fields})).hexdigest()
        if version != self.manifest.dataset_version:
            raise ValueError('Historical manifest identity differs')
        if (self.path.stat().st_size != self.manifest.database_bytes or
                digest(self.path) != self.manifest.database_sha256):
            raise ValueError('Historical dataset integrity failed')
        self.dataset_version = self.manifest.dataset_version
        self._stamps = self._current_stamps()
        with self.connection() as connection:
            if connection.execute('PRAGMA user_version').fetchone()[0] != 1:
                raise ValueError('Unsupported historical database')
            if connection.execute('SELECT count(*) FROM matches').fetchone()[0] != len(self.manifest.matches):
                raise ValueError('Historical fixture count differs')

    def _current_stamps(self):
        return tuple((s.st_size, s.st_mtime_ns, s.st_ino) for s in (self.path.stat(), self.manifest_path.stat()))

    @contextmanager
    def connection(self):
        if self._current_stamps() != self._stamps:
            raise ValueError('Historical dataset changed; restart required')
        connection = sqlite3.connect(self.path.as_uri()+'?mode=ro&immutable=1', uri=True)
        try:
            yield connection
            if self._current_stamps() != self._stamps:
                raise ValueError('Historical dataset changed; restart required')
        finally:
            connection.close()

    def list_seasons(self):
        with self.connection() as connection:
            result = []
            for season, expected, label in ((27, 380, '2015/2016'), (44, 38, '2003/2004')):
                count = connection.execute('SELECT count(*) FROM matches WHERE season=?', (season,)).fetchone()[0]
                ready = sum(m.status == 'facts_ready' for m in self.manifest.matches if m.season_id == season)
                result.append(HistoricalSeason(season_id=season, label=label, matches_total=count, facts_ready=ready,
                    coverage_scope='arsenal_only' if season == 44 else 'full_season' if count == expected else 'partial_calendar',
                    calendar_complete=count == expected))
            return result

    def list_matches(self, season_id, team_id=None, offset=0, limit=24):
        if season_id not in (27, 44) or not 1 <= limit <= 50 or offset < 0:
            raise ValueError('Invalid historical page')
        where, params = 'season=?', [season_id]
        if team_id is not None:
            where += ' AND (home=? OR away=?)'
            params.extend([team_id, team_id])
        with self.connection() as connection:
            total = connection.execute('SELECT count(*) FROM matches WHERE '+where, params).fetchone()[0]
            rows = connection.execute('SELECT body FROM matches WHERE '+where+' ORDER BY json_extract(body,\'$.date\'), id LIMIT ? OFFSET ?', params+[limit, offset])
            items = [HistoricalMatch.model_validate_json(row[0]) for row in rows]
        return HistoricalPage(dataset_version=self.dataset_version, total=total, offset=offset, limit=limit, items=items)

    def _read_match(self, match_id):
        with self.connection() as connection:
            row = connection.execute('SELECT body FROM matches WHERE id=?', (match_id,)).fetchone()
        if row is None:
            raise KeyError(match_id)
        return HistoricalMatch.model_validate_json(row[0])

    def _all_events(self, match_id):
        with self.connection() as connection:
            rows=connection.execute('SELECT body FROM events WHERE match_id=? ORDER BY period,period_ms,source_index', (match_id,))
            return [HistoricalEvent.model_validate_json(row[0]) for row in rows]

    def get_match(self, match_id):
        match=self._read_match(match_id)
        return match.model_copy(update={'clock':build_clock(self._all_events(match_id))})

    def statistics(self, match_id, period, at_ms):
        if not 1 <= period <= 5 or not 0 <= at_ms <= 10_800_000:
            raise ValueError('Invalid historical cutoff')
        match=self._read_match(match_id)
        result=reduce_statistics(match,self._all_events(match_id),PeriodPoint(period=period,period_ms=at_ms))
        return result.model_copy(update={'dataset_version':self.dataset_version})

    def events(self, match_id, period, from_ms, to_ms, offset=0, limit=100):
        if not 1 <= period <= 5 or not 0 <= from_ms < to_ms <= 10_800_000 or to_ms-from_ms > 60_000 or offset < 0 or not 1 <= limit <= 200:
            raise ValueError('Invalid historical window')
        match = self._read_match(match_id)
        with self.connection() as connection:
            params = (match_id, period, from_ms, to_ms)
            where = 'match_id=? AND period=? AND period_ms>=? AND period_ms<?'
            total = connection.execute('SELECT count(*) FROM events WHERE '+where, params).fetchone()[0]
            rows = connection.execute('SELECT body FROM events WHERE '+where+' ORDER BY period_ms,source_index LIMIT ? OFFSET ?', (*params, limit, offset))
            items = [orient_event(match,HistoricalEvent.model_validate_json(row[0])) for row in rows]
        return HistoricalEventPage(dataset_version=self.dataset_version, match_id=match_id,
            total=total, offset=offset, limit=limit, items=items, availability=match.status)
