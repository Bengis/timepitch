"""Audit the static artwork against the independent, immutable league catalogue."""
import csv
import hashlib
import json
from pathlib import Path
import re

ROOT=Path(__file__).resolve().parents[2]

def test_every_complete_premier_team_season_has_an_attributed_pinned_local_crest():
    manifest=json.loads((ROOT/'web/src/catalog/historical-crests.json').read_text(encoding='utf-8'))
    with (ROOT/'research/data-audit/2026-10-16/derived/team_season_results.csv').open(encoding='utf-8-sig') as file:
        rows=[row for row in csv.DictReader(file) if 1992<=int(row['season_start'])<=2025]
    expected={f"{row['club']}:{row['season_start']}" for row in rows}
    assert len(expected)==686
    assert set(manifest['seasons'])==expected
    assert len({key.split(':')[0] for key in expected})==51
    assert set(manifest['seasons'].values())==set(manifest['assets'])
    for key,asset_id in manifest['seasons'].items():
        assert manifest['assets'][asset_id]['club']==key.split(':')[0]
    for asset in manifest['assets'].values():
        assert re.fullmatch(r'/assets/crests/[a-z0-9-]+\.(gif|jpg|png)',asset['src'])
        assert asset['source'].startswith(('https://www.historicalkits.co.uk/','https://news.adidas.com/'))
        raw=(ROOT/'web/public'/asset['src'].lstrip('/')).read_bytes()
        assert raw.startswith((b'GIF87a',b'GIF89a',b'\xff\xd8\xff',b'\x89PNG\r\n\x1a\n'))
        assert hashlib.sha256(raw).hexdigest()==asset['sha256']
        assert len(raw)==asset['bytes']
