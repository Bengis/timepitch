from typing import Any, Literal
import re

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

PINNED_SNAPSHOT = '4b73468fc5b0f1950f9f66fada70ad3a4f9327cb'
ProvenanceKind = Literal['source_recorded', 'derived_from_events', 'synthetic_motion', 'unavailable']
HistoricalStatus = Literal['metadata_only', 'facts_ready', 'partial', 'excluded']


class HistoricalModel(BaseModel):
    model_config = ConfigDict(frozen=True, extra='forbid', allow_inf_nan=False)


class SourceFile(HistoricalModel):
    path: str
    sha256: str | None = None
    size: int | None = Field(default=None, ge=0, le=16*1024**2)
    status: Literal['ok', 'missing', 'error']
    reason: str | None = None

    @field_validator('path')
    @classmethod
    def allowed_path(cls, value):
        if not re.fullmatch(r'(README\.md|LICENSE\.pdf|doc/[^/\\]+\.pdf|data/(matches/2/(27|44)|events/[1-9][0-9]*|lineups/[1-9][0-9]*)\.json)', value):
            raise ValueError('Unapproved source path')
        return value

    @model_validator(mode='after')
    def valid_digest(self):
        if self.status == 'ok' and (self.size is None or not re.fullmatch('[a-f0-9]{64}', self.sha256 or '')):
            raise ValueError('Available source must have size and digest')
        return self


class SourceManifest(HistoricalModel):
    snapshot: Literal[PINNED_SNAPSHOT]
    files: list[SourceFile]
    requested_matches: list[int] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)

    @model_validator(mode='after')
    def unique_paths(self):
        if len({f.path for f in self.files}) != len(self.files):
            raise ValueError('Repeated source manifest path')
        return self


class HistoricalPoint(HistoricalModel):
    x: float
    y: float


class PeriodPoint(HistoricalModel):
    period: int = Field(ge=1, le=5)
    period_ms: int = Field(ge=0)


class HistoricalPeriod(HistoricalModel):
    period: int
    duration_ms: int | None
    observed_end_ms: int
    playback_start_ms: int | None
    start_event_ids: list[str]
    end_event_ids: list[str]


class HistoricalClock(HistoricalModel):
    periods: list[HistoricalPeriod]
    issues: list[str] = Field(default_factory=list)
    provenance: Literal['derived_from_events'] = 'derived_from_events'

    def validate_point(self, point: PeriodPoint):
        part = next((p for p in self.periods if p.period == point.period), None)
        if part is None or point.period_ms > (part.duration_ms if part.duration_ms is not None else part.observed_end_ms):
            raise ValueError('Invalid historical cutoff')
        return part

    def to_playback_ms(self, period: int, period_ms: int) -> int:
        if period_ms < 0:
            raise ValueError('Invalid historical cutoff')
        part = self.validate_point(PeriodPoint(period=period, period_ms=period_ms))
        if part.duration_ms is None or part.playback_start_ms is None:
            raise ValueError('Historical clock continuity unavailable')
        return part.playback_start_ms + period_ms

    def from_playback_ms(self, value: int) -> PeriodPoint:
        if value >= 0:
            for i, part in enumerate(self.periods):
                if part.duration_ms is None or part.playback_start_ms is None:
                    break
                end = part.playback_start_ms + part.duration_ms
                if value < end or (value == end and i == len(self.periods)-1):
                    return PeriodPoint(period=part.period, period_ms=value-part.playback_start_ms)
        raise ValueError('Historical clock continuity unavailable or outside range')

    def display_label(self, point: PeriodPoint) -> str:
        self.validate_point(point)
        seconds = point.period_ms//1000
        minutes, second = divmod(seconds, 60)
        return f'{ {1:0, 2:45, 3:90, 4:105, 5:120}[point.period]+minutes:02}:{second:02}'


class HistoricalTeam(HistoricalModel):
    key: str
    source_id: int
    name: str


class HistoricalPlayer(HistoricalModel):
    key: str
    source_id: int
    name: str
    jersey_number: int | None = None
    positions: list[dict[str, Any]] = Field(default_factory=list)
    cards: list[dict[str, Any]] = Field(default_factory=list)


class HistoricalLineup(HistoricalModel):
    team_key: str
    players: list[HistoricalPlayer]


class HistoricalMatch(HistoricalModel):
    id: int
    key: str
    season_id: Literal[27, 44]
    season_name: str
    date: str
    kick_off: str | None
    home_team: HistoricalTeam
    away_team: HistoricalTeam
    final_score: dict[Literal['home', 'away'], int]
    status: HistoricalStatus
    lineups: list[HistoricalLineup] = Field(default_factory=list)
    event_count: int | None = None
    issues: list[str] = Field(default_factory=list)
    provenance: Literal['source_recorded'] = 'source_recorded'
    clock: HistoricalClock | None = None


class HistoricalEvent(HistoricalModel):
    id: str
    source_index: int
    period: int = Field(ge=1, le=5)
    period_ms: int = Field(ge=0)
    minute: int = Field(ge=0)
    second: int = Field(ge=0, le=59)
    type: str
    team_key: str | None
    player_key: str | None
    location_source: list[float] | None = None
    end_location_source: list[float] | None = None
    location: HistoricalPoint | None = None
    end_location: HistoricalPoint | None = None
    duration: float | None = Field(default=None, ge=0)
    duration_source: float | None = None
    related_events: list[str] = Field(default_factory=list)
    possession: int | None = None
    possession_team_key: str | None = None
    details: dict[str, Any] = Field(default_factory=dict)
    issues: list[str] = Field(default_factory=list)
    provenance: Literal['source_recorded'] = 'source_recorded'
    canonical_location: HistoricalPoint | None = None
    canonical_end_location: HistoricalPoint | None = None
    canonical_frame: Literal['display-home-right-first-half-105x68'] | None = None
    coordinate_provenance: Literal['derived_from_events', 'unavailable'] = 'unavailable'


class ParticipationIncident(HistoricalModel):
    code: str
    at: PeriodPoint | None = None
    event_ids: list[str] = Field(default_factory=list)


class ParticipationInterval(HistoricalModel):
    player_key: str
    team_key: str
    start: PeriodPoint
    end: PeriodPoint | None = None
    event_ids: list[str]


class FormationChange(HistoricalModel):
    team_key: str
    at: PeriodPoint
    formation: int | None
    player_keys: list[str]
    event_id: str


class ParticipationTimeline(HistoricalModel):
    clock: HistoricalClock
    players: list[HistoricalPlayer]
    teams: dict[str, str]
    intervals: list[ParticipationInterval]
    incidents: list[ParticipationIncident]
    formations: list[FormationChange]
    provenance: Literal['derived_from_events'] = 'derived_from_events'

    @property
    def issues(self) -> list[str]:
        return sorted({i.code for i in self.incidents})

    def active_players(self, period: int, period_ms: int) -> tuple[HistoricalPlayer, ...]:
        point = PeriodPoint(period=period, period_ms=period_ms)
        self.clock.validate_point(point)
        key = (period, period_ms)
        active = {i.player_key for i in self.intervals
                  if (i.start.period,i.start.period_ms) <= key and
                  (i.end is None or key < (i.end.period,i.end.period_ms))}
        return tuple(p for p in self.players if p.key in active)

    def played_ms(self, player_key: str, cutoff: PeriodPoint) -> int | None:
        self.clock.validate_point(cutoff)
        cut = (cutoff.period,cutoff.period_ms)
        if any(i.code.endswith(':'+player_key) and i.code.startswith(('unresolved_lineup_entry:', 'unknown_starting_xi:'))
               and (i.at is None or (i.at.period,i.at.period_ms) <= cut) for i in self.incidents):
            return None
        total = 0
        for interval in self.intervals:
            if interval.player_key != player_key or (interval.start.period,interval.start.period_ms) > cut:
                continue
            for part in self.clock.periods:
                if part.period < interval.start.period or part.period > cutoff.period:
                    continue
                if interval.end and part.period > interval.end.period:
                    continue
                begin = interval.start.period_ms if part.period == interval.start.period else 0
                end = cutoff.period_ms if part.period == cutoff.period else part.duration_ms
                if interval.end and part.period == interval.end.period:
                    end = min(end, interval.end.period_ms) if end is not None else interval.end.period_ms
                if end is None:
                    return None
                total += max(0, end-begin)
        return total


class HistoricalMetric(HistoricalModel):
    value: int | float | None
    provenance: Literal['derived_from_events','unavailable'] = 'derived_from_events'
    event_ids: list[str] = Field(default_factory=list)
    variant: str | None = None
    reason: str | None = None
    observed_value: float | None = None
    missing_count: int = 0


class HistoricalTeamStatistics(HistoricalModel):
    team_key: str
    metrics: dict[str, HistoricalMetric]


class HistoricalPlayerStatistics(HistoricalModel):
    player_key: str
    team_key: str
    active: bool
    metrics: dict[str, HistoricalMetric]


class HistoricalGoal(HistoricalModel):
    at: PeriodPoint
    team_key: str
    kind: Literal['regular','own_goal']
    player_key: str | None = None
    own_goal_player_key: str | None = None
    event_ids: list[str]


class HistoricalPassEdge(HistoricalModel):
    team_key: str
    player_key: str
    recipient_key: str
    count: int
    event_ids: list[str]


class HistoricalChange(HistoricalModel):
    at: PeriodPoint
    team_key: str | None
    player_key: str | None
    replacement_key: str | None = None
    card: str | None = None
    event_ids: list[str]


class HistoricalActionPoint(HistoricalModel):
    event_id: str
    type: str
    team_key: str
    player_key: str | None
    location: HistoricalPoint
    end_location: HistoricalPoint | None
    provenance: Literal['derived_from_events'] = 'derived_from_events'


class HistoricalStatistics(HistoricalModel):
    dataset_version: str | None = None
    match_id: int
    cutoff: PeriodPoint
    display_clock: str
    playback_ms: int | None
    definition_version: Literal['statsbomb-events-1'] = 'statsbomb-events-1'
    provenance: Literal['derived_from_events'] = 'derived_from_events'
    score: dict[Literal['home','away'], int] | None
    reconciliation: Literal['matched','mismatch','not_final','unavailable']
    clock_status: Literal['ready','partial','unavailable']
    participation_status: Literal['ready','partial','unavailable']
    summary_reconciled: bool
    teams: list[HistoricalTeamStatistics]
    players: list[HistoricalPlayerStatistics]
    goals: list[HistoricalGoal]
    substitutions: list[HistoricalChange]
    cards: list[HistoricalChange]
    formations: list[FormationChange]
    pass_network: list[HistoricalPassEdge]
    action_map: list[HistoricalActionPoint]
    issues: list[str]


class FixtureAudit(HistoricalModel):
    id: int
    season_id: int
    status: HistoricalStatus
    event_count: int | None
    issues: list[str]


class HistoricalManifest(HistoricalModel):
    schema_version: Literal['historical-events-1'] = 'historical-events-1'
    snapshot: Literal[PINNED_SNAPSHOT]
    dataset_version: str
    database_sha256: str
    database_bytes: int
    source_manifest_sha256: str
    source_files: list[SourceFile]
    matches: list[FixtureAudit]
    counts: dict[str, int]
    local_use_only: Literal[True] = True
    publication_status: Literal['blocked_pending_permission'] = 'blocked_pending_permission'
    attribution: str = 'StatsBomb Open Data; StatsBomb brand logo required for published analysis.'


class HistoricalSeason(HistoricalModel):
    season_id: int
    label: str
    matches_total: int
    facts_ready: int
    coverage_scope: Literal['full_season', 'partial_calendar', 'arsenal_only']
    calendar_complete: bool


class HistoricalPage(HistoricalModel):
    dataset_version: str
    total: int
    offset: int
    limit: int
    items: list[HistoricalMatch]


class HistoricalEventPage(HistoricalModel):
    dataset_version: str
    match_id: int
    total: int
    offset: int
    limit: int
    items: list[HistoricalEvent]
    availability: HistoricalStatus


class HistoricalCapabilities(HistoricalModel):
    two_modes_ui: bool
    reconstruction_enabled: bool
    dataset_state: Literal['absent', 'invalid', 'ready']
    dataset_version: str | None = None
    publication_status: Literal['blocked_pending_permission', 'operator_confirmed_permission'] = 'blocked_pending_permission'


class MatchupTeam(HistoricalModel):
    source_team_key: str
    catalog_key: str | None
    source_formation: str | None
    source_players: list[str]
    player_keys: list[str] | None
    supported_formations: list[str]
    differences: list[str]


class MatchupPrefill(HistoricalModel):
    historical_match_id: int
    historical_dataset_version: str | None = None
    catalog_dataset_version: str
    crosswalk_version: str
    available: bool
    exact_xi_available: bool
    home: MatchupTeam
    away: MatchupTeam


class ComparisonValues(HistoricalModel):
    home: float | None
    away: float | None


class ComparisonMetric(ComparisonValues):
    definition: str


class ComparisonRow(HistoricalModel):
    metric: Literal['goals','shots','xg','completed_passes']
    historical: ComparisonMetric
    simulated: ComparisonMetric
    status: Literal['comparable','different_definition','unavailable']
    delta: ComparisonValues | None
    reason: str | None = None


class HistoricalComparison(HistoricalModel):
    historical_match_id: int
    historical_dataset_version: str | None
    historical_reconciliation: str
    engine: Literal['timepitch','grf']
    simulation_id: str
    trace_hash: str
    engine_version: str
    seed: int
    home_key: str
    away_key: str
    historical_formations: dict[str,str | None]
    simulated_formations: dict[str,str]
    lineup_differences: list[str]
    issues: list[str]
    rows: list[ComparisonRow]
