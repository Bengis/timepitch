"""Audited snapshot access. Connections are read-only and every value is bound."""
from contextlib import contextmanager
from functools import cached_property
from hashlib import sha256
from pathlib import Path
import sqlite3

from .adapters import adapt_epl_player, adapt_fpl_player
from .models import TeamSummary, TeamSeason
from .advanced import AdvancedCatalogRepository
from .deductions import load_deductions
from .results import HeadToHead, MatchResult, TeamSeasonRecord, head_to_head, league_table

CLUB_NAMES = {
    'arsenal': 'Arsenal', 'astonvilla': 'Aston Villa', 'barnsley': 'Barnsley',
    'birmingham': 'Birmingham City', 'blackburn': 'Blackburn Rovers', 'blackpool': 'Blackpool',
    'bolton': 'Bolton Wanderers', 'bournemouth': 'Bournemouth', 'bradford': 'Bradford City',
    'brentford': 'Brentford', 'brighton': 'Brighton & Hove Albion', 'burnley': 'Burnley',
    'cardiff': 'Cardiff City', 'charlton': 'Charlton Athletic', 'chelsea': 'Chelsea',
    'coventry': 'Coventry City', 'crystalpalace': 'Crystal Palace', 'derby': 'Derby County',
    'everton': 'Everton', 'fulham': 'Fulham', 'huddersfield': 'Huddersfield Town',
    'hull': 'Hull City', 'ipswich': 'Ipswich Town', 'leeds': 'Leeds United',
    'leicester': 'Leicester City', 'liverpool': 'Liverpool', 'luton': 'Luton Town',
    'mancity': 'Manchester City', 'manunited': 'Manchester United', 'middlesbrough': 'Middlesbrough',
    'newcastle': 'Newcastle United', 'norwich': 'Norwich City', 'nottmforest': 'Nottingham Forest',
    'oldham': 'Oldham Athletic', 'portsmouth': 'Portsmouth', 'qpr': 'Queens Park Rangers',
    'reading': 'Reading', 'sheffieldutd': 'Sheffield United', 'sheffieldwed': 'Sheffield Wednesday',
    'southampton': 'Southampton', 'stoke': 'Stoke City', 'sunderland': 'Sunderland',
    'swansea': 'Swansea City', 'swindon': 'Swindon Town', 'tottenham': 'Tottenham Hotspur',
    'watford': 'Watford', 'westbrom': 'West Bromwich Albion', 'westham': 'West Ham United',
    'wigan': 'Wigan Athletic', 'wimbledon': 'Wimbledon', 'wolves': 'Wolverhampton Wanderers',
}
FORMATIONS = ('4-4-2', '4-3-3', '3-5-2', '4-5-1')


class CatalogRepository:
    def __init__(self, path: Path, advanced_path:Path|None=None):
        self.path = path.resolve()
        stamp = self.path.stat()
        self._snapshot_stamp = (stamp.st_size, stamp.st_mtime_ns)
        self.advanced=AdvancedCatalogRepository(advanced_path)

    def _assert_unchanged(self):
        self.advanced._assert_unchanged()
        stamp = self.path.stat()
        if (stamp.st_size, stamp.st_mtime_ns) != self._snapshot_stamp:
            raise ValueError('Historical dataset changed; restart to use the new version')

    @contextmanager
    def connection(self):
        self._assert_unchanged()
        connection = sqlite3.connect(self.path.as_uri() + '?mode=ro', uri=True)
        connection.row_factory = sqlite3.Row
        try:
            yield connection
        finally:
            connection.close()

    @cached_property
    def dataset_version(self) -> str:
        return 'sha256:' + sha256(self.path.read_bytes()).hexdigest()

    @cached_property
    def _summaries(self) -> dict[str, TeamSummary]:
        with self.connection() as conn:
            result_sources: dict[int, list[str]] = {}
            for year, source in conn.execute('SELECT DISTINCT season_start,source FROM matches ORDER BY season_start,source'):
                result_sources.setdefault(year, []).append(source)
            rows = conn.execute('''SELECT r.* FROM team_season_readiness AS r
                JOIN season_coverage AS s USING (season_start)
                WHERE s.complete_season_target=1 AND s.result_complete=1
                ORDER BY r.club,r.season_start''').fetchall()
            disagreements = {f"{r[0]}:{r[1]}": (r[2], r[3]) for r in conn.execute('''
                SELECT club,season_start,SUM(score_issue),SUM(date_issue) FROM (
                    SELECT home AS club,season_start,1-same_score AS score_issue,1-same_date AS date_issue
                    FROM epl_match_score_reconciliation WHERE _merge='both'
                    UNION ALL
                    SELECT away,season_start,1-same_score,1-same_date
                    FROM epl_match_score_reconciliation WHERE _merge='both'
                ) GROUP BY club,season_start''')}
        teams = {}
        for row in rows:
            key = f"{row['club']}:{row['season_start']}"
            source = row['source']
            flags = []
            if row['unknown_role_rows']:
                flags.append('unknown_roles')
            if source == 'epldata':
                flags.append('minutes_estimated')
                score, date = disagreements.get(key, (0, 0))
                if score:
                    flags.append('source_scores_disagree')
                if date:
                    flags.append('source_dates_disagree')
            else:
                flags.append('assists_fpl_definition')
            if row['season_start'] == 2022:
                flags.append('xg_partial_2022')
            team = TeamSummary(key=key, club=row['club'], name=CLUB_NAMES[row['club']],
                season_start=row['season_start'], season_label=f"{row['season_start']}/{str(row['season_start']+1)[-2:]}",
                source=source, results_sources=result_sources[row['season_start']], dataset_version=self.dataset_version, player_count=row['players'],
                matches=row['matches'], goals_for=row['goals_for'], goals_against=row['goals_against'],
                available_formations=[f for f in FORMATIONS if row[f]],
                coverage={'roster': 'league_participants', 'results': 'complete',
                          'minutes': 'estimated' if source == 'epldata' else 'measured',
                          'advanced': ('fields_vary' if source=='fpl' else 'source_unlinked')
                              if self.advanced.dataset_version else 'not_imported'}, quality_flags=flags)
            teams[key] = team
        return teams

    def list_teams(self, query: str = '', season_start: int | None = None) -> list[TeamSummary]:
        self._assert_unchanged()
        needle = query.strip().casefold()
        return [t for t in self._summaries.values() if
                (season_start is None or t.season_start == season_start) and
                (not needle or needle in f'{t.name} {t.club} {t.season_label}'.casefold())]

    def get_team(self, key: str) -> TeamSeason:
        summary = self._summaries.get(key)
        if summary is None:
            raise KeyError(key)
        table, adapter = ('epl_player_season', adapt_epl_player) if summary.source == 'epldata' else ('fpl_player_season', adapt_fpl_player)
        with self.connection() as conn:
            rows = conn.execute(f'SELECT * FROM {table} WHERE club=? AND season_start=?',
                                (summary.club, summary.season_start)).fetchall()
        players = [player for row in rows if (player := adapter(dict(row))) is not None]
        players = [p.model_copy(update={'advanced_stats':self.advanced.player_stats(p.key)}) for p in players]
        players.sort(key=lambda p: (('GK', 'DEF', 'MID', 'FWD', None).index(p.role),
                                    -(p.stats['minutes'].value or 0), p.key))
        return TeamSeason(**summary.model_dump(),players=players,advanced_dataset_version=self.advanced.dataset_version)

    # ---------- TP213 · season record and head-to-head (audited results, catalogue seasons only) ----------

    def _results(self, where: str, params: tuple) -> list[MatchResult]:
        """Results restricted to the complete seasons of the catalogue (the partial current season never counts)."""
        with self.connection() as conn:
            rows = conn.execute(f'''SELECT m.source,m.season_start,m.date,m.home,m.away,m.FTHG,m.FTAG FROM matches AS m
                JOIN season_coverage AS s USING (season_start)
                WHERE s.complete_season_target=1 AND s.result_complete=1 AND {where}
                ORDER BY m.date,m.home''', params).fetchall()
        return [MatchResult(source=r[0], season_start=r[1], date=r[2], home=r[3], away=r[4], home_goals=r[5], away_goals=r[6])
                for r in rows]

    def team_record(self, key: str) -> TeamSeasonRecord:
        summary = self._summaries.get(key)
        if summary is None:
            raise KeyError(key)
        deductions = load_deductions()
        season = deductions.for_season(summary.season_start)
        table = league_table(self._results('m.season_start=?', (summary.season_start,)), {c: d.points for c, d in season.items()})
        row = next(r for r in table if r.club == summary.club)
        return TeamSeasonRecord(key=key, club=summary.club, season_start=summary.season_start, season_label=summary.season_label,
            played=row.played, wins=row.wins, draws=row.draws, losses=row.losses, goals_for=row.goals_for,
            goals_against=row.goals_against, goal_difference=row.goals_for - row.goals_against, points=row.points,
            raw_points=row.raw_points, deduction=season.get(summary.club), position=row.position, position_shared=row.position_shared, teams=len(table),
            results_sources=summary.results_sources, dataset_version=self.dataset_version,
            deductions_version=deductions.version)

    def head_to_head(self, club_a: str, club_b: str) -> HeadToHead:
        if club_a not in CLUB_NAMES or club_b not in CLUB_NAMES:
            raise KeyError(club_a if club_a not in CLUB_NAMES else club_b)
        if club_a == club_b:
            raise ValueError('A club cannot face itself in the results')
        meetings = self._results('((m.home=? AND m.away=?) OR (m.home=? AND m.away=?))', (club_a, club_b, club_b, club_a))
        counts = head_to_head(meetings, club_a, club_b)
        return HeadToHead(**counts.model_dump(), results_sources=sorted({m.source for m in meetings}),
                          seasons_covered=sorted({m.season_start for m in meetings}), dataset_version=self.dataset_version)
