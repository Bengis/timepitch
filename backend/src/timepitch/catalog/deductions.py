"""TP214 · Official Premier League points deductions 1992/93–2025/26, versioned with their source (no I/O beyond the file).

The data lives in `points_deductions.json` next to this module (English Wikipedia season articles, CC BY-SA, with
title, revid and URL). A season listed in `seasons_checked` without an entry had no deduction.
"""
from functools import cache
from hashlib import sha256
import json
from pathlib import Path

from .models import CatalogModel

DATA = Path(__file__).with_name('points_deductions.json')


class DeductionSource(CatalogModel):
    title: str
    revid: int
    revision_timestamp: str
    url: str


class PointsDeduction(CatalogModel):
    club: str
    season_start: int
    points: int  # positive number of points removed from the raw total
    reason: str
    reason_es: str
    source: DeductionSource
    licence: str


class DeductionTable(CatalogModel):
    version: str
    seasons_checked: list[int]
    deductions: list[PointsDeduction]

    def for_season(self, season_start: int) -> dict[str, PointsDeduction]:
        return {d.club: d for d in self.deductions if d.season_start == season_start}


@cache
def load_deductions(path: Path = DATA) -> DeductionTable:
    raw = path.read_bytes()
    body = json.loads(raw)
    deductions = [PointsDeduction(**d, licence=body['licence']) for d in body['deductions']]
    if any(d.points <= 0 for d in deductions):
        raise ValueError('A points deduction must remove at least one point')
    if len({(d.club, d.season_start) for d in deductions}) != len(deductions):
        raise ValueError('One entry per club and season (sum the stages in the entry)')
    return DeductionTable(version='sha256:' + sha256(raw).hexdigest(), seasons_checked=sorted(int(y) for y in body['seasons_checked']),
                          deductions=deductions)
