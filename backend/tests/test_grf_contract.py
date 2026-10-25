import json
import pytest
from grf_fixtures import request_fixture, replay_fixture
from timepitch.grf.codec import encode_grf, parse_grf, grf_hash, grf_input_hash, MAX_BYTES
from timepitch.grf.models import GrfReplay


@pytest.fixture(scope='module')
def grf_input(): return request_fixture()


def reseal(record):
    record.input.input_hash = grf_input_hash(record.input)
    record.trace_hash = grf_hash(record)
    return encode_grf(record)


def test_round_trip_and_mirror_keep_side_scoped_identities(grf_input):
    record = replay_fixture(grf_input)
    assert parse_grf(encode_grf(record), grf_input) == record
    mirror = request_fixture(mirror=True)
    assert len({p.id for p in mirror.players}) == 22
    assert len({p.source_key for p in mirror.players}) == 11
    assert record.samples[0].engine_step == -1


@pytest.mark.parametrize('mutate', [
    lambda r: setattr(r.input.players[0], 'source_key', 'forged'),
    lambda r: setattr(r.samples[1], 'score', (1, 0)),
    lambda r: setattr(r.samples[1], 'index', 0),
    lambda r: setattr(r.samples[1], 'engine_step', -1),
    lambda r: setattr(r.samples[-1], 'engine_step', 2999),
    lambda r: setattr(r, 'duration_ms', 300),
    lambda r: setattr(r.samples[1], 'owner_slot', -1),
    lambda r: setattr(r.attribute_readbacks[0], 'base', .999),
    lambda r: setattr(r.input, 'home_name', 'forged'),
])
def test_semantic_tampering_is_rejected_even_with_new_hash(grf_input, mutate):
    record = replay_fixture(grf_input).model_copy(deep=True)
    mutate(record)
    with pytest.raises(ValueError): parse_grf(reseal(record), grf_input)


@pytest.mark.parametrize('bad', [float('nan'), float('inf'), -float('inf'), 1.51])
def test_nonfinite_or_excessive_coordinates_are_rejected(grf_input, bad):
    record = replay_fixture(grf_input).model_dump(mode='json')
    record['samples'][1]['home_xy'][0][0] = bad
    with pytest.raises(ValueError): parse_grf(json.dumps(record).encode(), grf_input)


def test_native_margin_is_preserved_and_final_episode_is_required(grf_input):
    record = replay_fixture(grf_input)
    record.samples[1].home_xy[0] = (-1.01, -.43)
    assert parse_grf(reseal(record), grf_input).samples[1].home_xy[0] == (-1.01, -.43)
    raw = record.model_dump(mode='json');raw['steps_left'] = 1
    with pytest.raises(ValueError): GrfReplay.model_validate(raw)


def test_duplicate_keys_oversize_unknown_fields_and_hash_are_rejected(grf_input):
    record = replay_fixture(grf_input)
    raw = encode_grf(record)
    with pytest.raises(ValueError): parse_grf(b'{"schema_version":"forged",'+raw[1:], grf_input)
    with pytest.raises(ValueError): parse_grf(b' '*(MAX_BYTES+1), grf_input)
    with pytest.raises(ValueError): parse_grf(raw+b'{}', grf_input)
    value = json.loads(raw);value['command'] = 'arbitrary'
    with pytest.raises(ValueError): parse_grf(json.dumps(value).encode(), grf_input)
    record.trace_hash = '0'*64
    with pytest.raises(ValueError): parse_grf(encode_grf(record), grf_input)


def test_tactics_not_mapped_and_changed_membership_are_rejected(grf_input):
    from timepitch.grf.input import make_grf_input
    from timepitch.catalog.repository import CatalogRepository
    from grf_fixtures import DATASET
    catalog = CatalogRepository(DATASET)
    for cfg in (grf_input.config.model_copy(update={'home_tactic':'press'}),
                grf_input.config.model_copy(update={'home_players':['forged']*11})):
        with pytest.raises(ValueError): make_grf_input(cfg, catalog)
