import sqlite3
import hashlib
import json

import pytest

from historical_support import PILOT, write_source
from test_historical_import import build, repo


def test_repository_is_readonly_and_paginates_without_invented_zeros(tmp_path):
    source = write_source(tmp_path/'source')
    build(source, tmp_path/'dataset')
    repository = repo(tmp_path/'dataset')
    page = repository.list_matches(27, 33, 0, 24)
    assert page.total == 1 and len(page.items) == 1
    assert repository.list_matches(27, 9999, 0, 24).total == 0
    with repository.connection() as connection:
        with pytest.raises(sqlite3.OperationalError, match='readonly'):
            connection.execute('DELETE FROM matches')
    assert repository.events(PILOT, 1, 0, 622, 0, 100).total == 2
    assert repository.events(PILOT, 1, 622, 1000, 0, 1).items[0].period_ms == 622


def test_repository_detects_changed_dataset(tmp_path):
    source = write_source(tmp_path/'source')
    build(source, tmp_path/'dataset')
    repository = repo(tmp_path/'dataset')
    database = tmp_path/'dataset'/'historical.sqlite'
    with database.open('ab') as stream:
        stream.write(b'changed')
    with pytest.raises(ValueError, match='changed'):
        repository.get_match(PILOT)


def test_startup_rejects_corrupt_database(tmp_path):
    source = write_source(tmp_path/'source')
    build(source, tmp_path/'dataset')
    (tmp_path/'dataset'/'historical.sqlite').write_bytes(b'invalid')
    with pytest.raises(ValueError):
        repo(tmp_path/'dataset')


def test_unknown_match_is_not_an_empty_replay(tmp_path):
    source = write_source(tmp_path/'source')
    build(source, tmp_path/'dataset')
    with pytest.raises(KeyError):
        repo(tmp_path/'dataset').get_match(99999)


def test_manifest_metadata_must_match_its_dataset_version(tmp_path):
    source = write_source(tmp_path/'source')
    build(source, tmp_path/'dataset')
    path = tmp_path/'dataset'/'manifest.json'
    manifest = json.loads(path.read_bytes())
    manifest['matches'][0]['issues'] = ['unbound_changed_metadata']
    path.write_text(json.dumps(manifest), encoding='utf-8')
    with pytest.raises(ValueError, match='manifest'):
        repo(tmp_path/'dataset')
