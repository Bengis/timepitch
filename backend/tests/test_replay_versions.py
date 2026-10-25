"""The original bytes/hash remain readable; new wire coordinates cannot coerce."""
import json
from pathlib import Path
import zlib
import pytest
from timepitch.simulation import replay
from timepitch.simulation.replay_models import MatchRecordV2, MotionSample
from timepitch.matches.repository import MatchRepository


LEGACY_HASH = 'b6670fb5b528a3a2caf2a225cc69f24e9ed0673487b7a4b2db747cb94c064755'


def legacy_record():
    return replay.parse_replay(zlib.decompress((Path(__file__).parent / 'fixtures/legacy-engine1.json.zlib').read_bytes()))


def small_v2():
    old = legacy_record()
    data = old.model_dump(exclude={'events', 'trace_hash', 'engine_version', 'rules_version'})
    xy = [round(c * 1000) for p in old.initial_frame.players for c in (p.x, p.y)]
    sample = [0, 1, 0, 0, 0, 0, 0, 1, *xy[:2], xy]
    return MatchRecordV2(**data, format_version=2, engine_version='engine-2', rules_version='rules-2',
                         motion=[sample], events=[])


def test_old_hash_and_round_trip_are_unchanged():
    record = legacy_record()
    assert replay.trace_hash(record) == record.trace_hash == LEGACY_HASH
    assert replay.parse_replay(replay.encode_replay(record)) == record
    assert len({p.key for p in record.initial_frame.players}) == 22


def test_compact_v2_round_trip_omits_null_extension_and_hashes_canonical_bytes():
    record = small_v2()
    record.trace_hash = replay.trace_hash(record)
    raw = replay.encode_replay(record)
    wire = json.loads(raw)
    assert 'statistics' not in wire
    assert isinstance(wire['motion'][0], list)
    assert len(wire['motion'][0][-1]) == 44
    assert replay.parse_replay(raw) == record
    assert replay.trace_hash(replay.parse_replay(raw)) == record.trace_hash
    assert replay.frame_at(record, 0).players == record.initial_frame.players


@pytest.mark.parametrize('value', [True, 0.0, '0'])
@pytest.mark.parametrize('index', [0, 4, 9])
def test_compact_sample_rejects_noncanonical_integers(value, index):
    wire = json.loads(replay.encode_replay(small_v2()))
    wire['motion'][0][index] = value
    with pytest.raises(ValueError):
        replay.parse_replay(wire)


@pytest.mark.parametrize('mutation', [dict(format_version=3), dict(format_version=True), dict(motion=[]), dict(unrelated='x')])
def test_unknown_version_or_incompatible_extra_structure_never_falls_back(mutation):
    wire = json.loads(replay.encode_replay(legacy_record()))
    wire.update(mutation)
    with pytest.raises(ValueError):
        replay.parse_replay(wire)


@pytest.mark.parametrize('factory', [legacy_record, small_v2])
def test_repository_preserves_each_format_and_owner(tmp_path, factory):
    record = factory()
    record.trace_hash = replay.trace_hash(record)
    repository = MatchRepository(tmp_path / 'match.sqlite')
    job = repository.create(record.config, 'owner')
    repository.start(job.id, 'owner')
    repository.finish(job.id, 'owner', record)
    assert repository.get_record(job.id, 'owner') == record
    with pytest.raises(KeyError):
        repository.get_record(job.id, 'other-owner')


def test_size_invalid_json_and_duplicate_keys_rejected():
    for raw in [b'{', b' ' * (16 * 1024 * 1024 + 1), b'{"format_version":2,"format_version":1}']:
        with pytest.raises(ValueError):
            replay.parse_replay(raw)
