import importlib
import json
from uuid import UUID

import pytest

from historical_support import PIN, PILOT, encoded, fixture, records, write_source


def build(source, output):
    return importlib.import_module('timepitch.historical.import_dataset').build_dataset(source, output, PIN)


def repo(output):
    return importlib.import_module('timepitch.historical.repository').HistoricalRepository(output)


def test_calendar_has_380_and_38_scoped_matches(tmp_path):
    calendars = {27: [fixture(i, 27) for i in range(1, 381)],
                 44: [fixture(i, 44) for i in range(1000, 1038)]}
    source = write_source(tmp_path/'source', calendars=calendars)
    result = build(source, tmp_path/'dataset')
    assert len(result.matches) == 418
    seasons = {s.season_id: s for s in repo(tmp_path/'dataset').list_seasons()}
    assert seasons[27].matches_total == 380
    assert seasons[44].matches_total == 38
    assert seasons[44].coverage_scope == 'arsenal_only'


def test_same_player_name_does_not_link_sources(tmp_path):
    source = write_source(tmp_path/'source')
    build(source, tmp_path/'dataset')
    match = repo(tmp_path/'dataset').get_match(PILOT)
    players = [p for lineup in match.lineups for p in lineup.players if p.name == 'Same name']
    assert {p.key for p in players} == {'statsbomb:100', 'statsbomb:200'}
    assert 'birthday' not in match.model_dump_json()


def test_missing_event_file_is_partial_not_zero(tmp_path):
    source = write_source(tmp_path/'source', missing=(f'data/events/{PILOT}.json',))
    result = build(source, tmp_path/'dataset')
    assert result.matches[0].status == 'partial'
    assert result.matches[0].event_count is None
    assert 'events_missing' in result.matches[0].issues


def test_duplicate_uuid_conflicting_body_is_rejected(tmp_path):
    _, events = records()
    events.append({**events[-1], 'location': [10, 10]})
    source = write_source(tmp_path/'source', events=events)
    manifest = build(source, tmp_path/'dataset')
    assert manifest.matches[0].status == 'excluded'
    assert 'conflicting_event_id' in manifest.matches[0].issues


def test_identical_duplicate_uuid_is_idempotent(tmp_path):
    _, events = records()
    events.append(dict(events[-1]))
    source = write_source(tmp_path/'source', events=events)
    manifest = build(source, tmp_path/'dataset')
    assert manifest.matches[0].event_count == 3
    assert 'repeated_identical_event' in manifest.matches[0].issues


def test_event_missing_endpoint_is_preserved(tmp_path):
    _, events = records()
    del events[-1]['pass']['end_location']
    del events[-1]['duration']
    source = write_source(tmp_path/'source', events=events)
    build(source, tmp_path/'dataset')
    event = repo(tmp_path/'dataset').events(PILOT, 1, 0, 1000, 0, 100).items[-1]
    assert event.id == str(UUID(int=3))
    assert event.end_location is None and event.duration is None
    assert event.provenance == 'source_recorded'
    assert event.period_ms == 622


def test_source_tamper_is_rejected_without_overwriting_original(tmp_path):
    source = write_source(tmp_path/'source')
    path = source/f'data/events/{PILOT}.json'
    path.write_bytes(b'[]')
    result = build(source, tmp_path/'dataset')
    assert result.matches[0].status == 'excluded'
    assert 'events_integrity' in result.matches[0].issues
    assert path.read_bytes() == b'[]'


def test_build_is_reproducible_and_never_overwrites_candidate(tmp_path):
    source = write_source(tmp_path/'source')
    first = build(source, tmp_path/'one')
    second = build(source, tmp_path/'two')
    assert first.dataset_version == second.dataset_version
    assert first.database_sha256 == second.database_sha256
    with pytest.raises(FileExistsError):
        build(source, tmp_path/'one')


def test_nonfinite_source_coordinates_are_not_accepted(tmp_path):
    _, events = records()
    events[-1]['location'] = [float('nan'), 40]
    source = write_source(tmp_path/'source', events=events)
    result = build(source, tmp_path/'dataset')
    assert result.matches[0].status == 'excluded'


def test_downloader_rejects_unpinned_revision_before_network(tmp_path, monkeypatch):
    module = importlib.import_module('timepitch.historical.source')
    monkeypatch.setattr(module, 'urlopen', lambda *a, **k: pytest.fail('Unexpected network'))
    with pytest.raises(ValueError, match='snapshot'):
        module.download_snapshot(tmp_path/'source', 'main')


def test_manifest_path_traversal_is_rejected(tmp_path):
    source = write_source(tmp_path/'source')
    manifest = json.loads((source/'source-manifest.json').read_bytes())
    manifest['files'][0]['path'] = '../outside.json'
    (source/'source-manifest.json').write_bytes(encoded(manifest))
    with pytest.raises(ValueError):
        build(source, tmp_path/'dataset')


def test_changed_specification_is_not_an_accepted_input_closure(tmp_path):
    source = write_source(tmp_path/'source')
    (source/'doc/Open Data Events v4.0.0.pdf').write_bytes(b'changed')
    with pytest.raises(ValueError, match='source document'):
        build(source, tmp_path/'dataset')


def test_downloader_reuses_only_hash_verified_cache_and_detects_tamper(tmp_path, monkeypatch):
    import io
    from urllib.parse import unquote
    module = importlib.import_module('timepitch.historical.source')
    lineups, events = records()
    bodies = {f'data/matches/2/{s}.json': encoded([fixture()] if s == 27 else []) for s in (27,44)}
    bodies.update({f'data/lineups/{PILOT}.json':encoded(lineups), f'data/events/{PILOT}.json':encoded(events)})
    calls = []
    class Response(io.BytesIO):
        status = 200
        def geturl(self): return self.url
    def request(req, timeout):
        relative = unquote(req.full_url.split(PIN+'/')[1])
        calls.append(relative)
        response = Response(bodies.get(relative, b'Synthetic document'))
        response.url = req.full_url
        return response
    monkeypatch.setattr(module, 'urlopen', request)
    first = module.download_snapshot(tmp_path/'source', PIN)
    assert len(calls) == 9
    assert len(first.files) == 9
    calls.clear()
    second = module.download_snapshot(tmp_path/'source', PIN)
    assert calls == [] and first == second
    (tmp_path/'source'/f'data/events/{PILOT}.json').write_bytes(b'[]')
    with pytest.raises(ValueError, match='changed'):
        module.download_snapshot(tmp_path/'source', PIN)
    assert calls == []


def test_required_download_failure_stops_without_retry(tmp_path, monkeypatch):
    from urllib.error import HTTPError
    module = importlib.import_module('timepitch.historical.source')
    calls = []
    def fail(req, timeout):
        calls.append(req.full_url)
        raise HTTPError(req.full_url, 404, 'Synthetic missing file', {}, None)
    monkeypatch.setattr(module, 'urlopen', fail)
    with pytest.raises(ValueError, match='Required source'):
        module.download_snapshot(tmp_path/'source', PIN)
    assert len(calls) == 1


def test_source_file_limit_does_not_write_oversized_file(tmp_path, monkeypatch):
    import io
    module = importlib.import_module('timepitch.historical.source')
    class Response(io.BytesIO):
        status = 200
        def geturl(self): return self.url
    def request(req, timeout):
        response = Response(b'x'*65)
        response.url = req.full_url
        return response
    monkeypatch.setattr(module, 'MAX_SOURCE_BYTES', 64)
    monkeypatch.setattr(module, 'urlopen', request)
    with pytest.raises(ValueError, match='too large'):
        module.download_snapshot(tmp_path/'source', PIN)
    assert not (tmp_path/'source'/'README.md').exists()
    assert list((tmp_path/'source').glob('*.part')) == []


@pytest.mark.parametrize('damage', ['uuid_integer', 'uuid_null', 'tactics_null', 'pass_null'])
def test_bad_fixture_is_isolated_and_another_fixture_survives(tmp_path, damage):
    _, events = records()
    if damage.startswith('uuid'):
        events[-1]['id'] = 123 if damage == 'uuid_integer' else None
    elif damage == 'tactics_null':
        events[0]['tactics'] = None
    else:
        events[-1]['pass'] = None
    second = PILOT+1
    source = write_source(tmp_path/'source', calendars={27:[fixture(), fixture(second)],44:[]},
                          events=events, additional=[second])
    manifest = build(source, tmp_path/'dataset')
    statuses = {m.id:m.status for m in manifest.matches}
    assert statuses == {PILOT:'excluded',second:'facts_ready'}


def test_foreign_possession_team_is_retained_but_not_facts_ready(tmp_path):
    _, events = records()
    events[-1]['possession_team'] = {'id':9999}
    source = write_source(tmp_path/'source', events=events)
    manifest = build(source, tmp_path/'dataset')
    assert manifest.matches[0].status == 'partial'
    assert 'unknown_possession_team' in manifest.matches[0].issues
    event = repo(tmp_path/'dataset').events(PILOT, 1, 0, 1000, 0, 100).items[-1]
    assert event.possession_team_key == 'statsbomb:9999'


def test_repeated_starting_player_does_not_count_as_eleven(tmp_path):
    _, events = records()
    events[0]['tactics']['lineup'] = [events[0]['tactics']['lineup'][0]]*11
    source = write_source(tmp_path/'source', events=events)
    manifest = build(source, tmp_path/'dataset')
    assert manifest.matches[0].status == 'partial'
    assert 'starting_xi_incomplete' in manifest.matches[0].issues


def test_negative_optional_duration_is_preserved_but_unavailable(tmp_path):
    _, events = records()
    events[-1]['duration'] = -.12
    source = write_source(tmp_path/'source', events=events)
    manifest = build(source, tmp_path/'dataset')
    assert manifest.matches[0].status == 'partial'
    assert manifest.matches[0].event_count == 3
    event = repo(tmp_path/'dataset').events(PILOT, 1, 0, 1000, 0, 100).items[-1]
    assert event.duration is None
    assert event.duration_source == -.12
    assert 'invalid_source_duration' in event.issues


def test_outside_coordinate_keeps_original_without_clamping(tmp_path):
    _, events = records()
    events[-1]['location'] = [121, 40]
    source = write_source(tmp_path/'source', events=events)
    manifest = build(source, tmp_path/'dataset')
    assert manifest.matches[0].status == 'partial'
    event = repo(tmp_path/'dataset').events(PILOT, 1, 0, 1000, 0, 100).items[-1]
    assert event.location_source == [121, 40]
    assert event.location is None
    assert 'location_outside_nominal_pitch' in event.issues
