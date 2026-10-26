"""Fictional league (TP259): invented club and player names for the hackathon demo.

The catalogue, the engines and every recording keep the real names (they are part of each trace hash). The web shows
the fictional names at the presentation layer, and the live AI report swaps them into the fact pack here, before the
request hash, so the report names exactly what the viewer sees. ``web/src/catalog/fictional.ts`` implements the same
mapping over the same JSON file, and a test checks both files are identical and give the same names.
"""
from __future__ import annotations

from functools import lru_cache
import json
from pathlib import Path
import re
import unicodedata

from ..chronicles.models import FactPack

_SEASON = re.compile(r'\s+(\d{4}/\d{2,4})$')


@lru_cache(maxsize=1)
def league() -> dict:
    return json.loads(Path(__file__).with_name('fictional-league.json').read_text(encoding='utf-8'))


def _normal(name: str) -> str:
    return ' '.join(unicodedata.normalize('NFC', name).strip().lower().split())


def fnv1a(text: str) -> int:
    value = 0x811C9DC5
    for byte in text.encode('utf-8'):
        value = ((value ^ byte) * 0x01000193) & 0xFFFFFFFF
    return value


def club_name(real: str) -> str:
    """«Arsenal 2003/04» → «North London Reds 2003/04». A club the league does not know keeps its name."""
    season = _SEASON.search(real)
    base = real[:season.start()] if season else real
    club = league()['clubs'].get(_normal(base))
    if club is None:
        return real
    return club['name'] + (' ' + season.group(1) if season else '')


def player_name(real: str) -> str:
    key = _normal(real)
    if not key:
        return real
    first, surnames = league()['first_names'], league()['surnames']
    return f"{first[fnv1a(key + '|f') % len(first)]} {surnames[fnv1a(key + '|s') % len(surnames)]}"


def fictional_pack(pack: FactPack) -> FactPack:
    """The same facts with fictional club and player names (validated again as a new FactPack)."""
    data = pack.model_dump(mode='json')
    data['home_name'], data['away_name'] = club_name(pack.home_name), club_name(pack.away_name)
    for fact in data['facts']:
        fact['player_names'] = [player_name(n) for n in fact['player_names']]
    return FactPack.model_validate(data)
