from typing import Literal
from pydantic import BaseModel
from ..simulation.models import MatchConfig, MatchMetrics


class MatchSummary(BaseModel):
    home_name: str
    away_name: str
    trace_hash: str
    metrics: MatchMetrics


class MatchJob(BaseModel):
    id: str
    state: Literal['queued', 'running', 'ready', 'failed']
    config: MatchConfig
    error: str | None = None
    summary: MatchSummary | None = None
