from typing import Literal

from pydantic import Field

from ..historical.models import HistoricalModel, HistoricalPoint


class MotionProfile(HistoricalModel):
    version: Literal['synthetic-motion-1'] = 'synthetic-motion-1'
    tick_ms: Literal[100] = 100
    segment_ms: Literal[60000] = 60000
    player_max_speed: float = Field(default=9,gt=0,le=9)
    player_max_acceleration: float = Field(default=4,gt=0,le=4)
    ball_max_speed: float = Field(default=45,gt=0,le=45)
    max_ball_gap_ms: int = Field(default=5000,gt=0,le=5000)


class EventAnchor(HistoricalModel):
    id: str
    event_id: str
    source_index: int
    period: int
    period_ms: int | None
    entity_key: str
    location: HistoricalPoint | None
    status: Literal['placed','conflict','insufficient']
    reason: str | None = None
    provenance: Literal['derived_from_events'] = 'derived_from_events'


class MotionCut(HistoricalModel):
    id: str
    period: int
    from_ms: int
    to_ms: int
    entity_key: str
    reason: str
    event_ids: list[str] = Field(default_factory=list)


class MotionPlayer(HistoricalModel):
    index: int
    key: str
    team_key: str


class MotionRole(HistoricalModel):
    period: int
    period_ms: int
    player_key: str
    team_key: str
    position_id: int


class AnchorSet(HistoricalModel):
    items: list[EventAnchor]
    resets: list[MotionCut]
    roles: list[MotionRole]
    roster: list[MotionPlayer]
    source_event_count: int
    issues: list[str]


class ReconstructionFrame(HistoricalModel):
    period: int
    period_ms: int
    # index resolves through the manifest's source-ID roster; no repeated names.
    players: list[tuple[int,float,float]]
    ball: tuple[float,float] | None
    ball_reason: str | None = None
    anchor_ids: list[str] = Field(default_factory=list)
    provenance: Literal['synthetic_motion'] = 'synthetic_motion'


class PeriodMotion(HistoricalModel):
    period: int
    duration_ms: int
    frames: list[ReconstructionFrame]
    anchors: list[EventAnchor]
    cuts: list[MotionCut]
    ball_unavailable_ms: int
    ball_unavailable_ranges: list[tuple[int,int,str]]
    provenance: Literal['synthetic_motion'] = 'synthetic_motion'


class ReconstructionSegment(HistoricalModel):
    reconstruction_id: str
    match_id: int
    period: int
    index: int
    from_ms: int
    to_ms: int
    includes_period_end: bool
    status: Literal['ready','partial']
    frames: list[ReconstructionFrame]
    anchors: list[EventAnchor]
    cuts: list[MotionCut]
    ball_unavailable_ms: int
    provenance: Literal['synthetic_motion'] = 'synthetic_motion'


class SegmentReference(HistoricalModel):
    period: int
    index: int
    from_ms: int
    to_ms: int
    bytes: int
    sha256: str
    status: Literal['ready','partial']


class ReconstructionManifest(HistoricalModel):
    reconstruction_id: str
    dataset_version: str
    match_id: int
    profile: MotionProfile
    roster: list[MotionPlayer]
    segments: list[SegmentReference]
    status: Literal['ready','partial','unavailable']
    issues: list[str]
    anchor_counts: dict[str,int]
    cut_counts: dict[str,int]
    ball_unavailable_ms: int
    duration_ms: int
    provenance: Literal['synthetic_motion'] = 'synthetic_motion'
    label_en: Literal['Real match events · Synthetic tracking'] = 'Real match events · Synthetic tracking'
    label_es: Literal['Eventos reales · Tracking sintético'] = 'Eventos reales · Tracking sintético'
    local_use_only: Literal[True] = True


class ReconstructionCatalogEntry(HistoricalModel):
    match_id: int = Field(gt=0)
    manifest_bytes: int = Field(gt=0,le=1024**2)
    manifest_sha256: str = Field(pattern='^[a-f0-9]{64}$')


class ReconstructionCatalog(HistoricalModel):
    version: Literal['reconstruction-catalog-1'] = 'reconstruction-catalog-1'
    dataset_version: str
    entries: list[ReconstructionCatalogEntry]
