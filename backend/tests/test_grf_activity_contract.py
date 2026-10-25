"""Activity remains explicitly versioned; old physical hashes retain meaning."""
import pytest
from grf_physical_fixtures import row
from test_grf_physical_statistics import trace
from timepitch.grf.physical_models import ActivityChunk,ActivityInput,ActivitySettings
from timepitch.grf.physical_codec import encode_chunk,decode_chunk,manifest_hash,parse_manifest


def test_activity_chunk_is_lossless_and_requires_one_state_per_player_and_sample():
    chunk=ActivityChunk(index=0,samples=[row()],activity=[[0]*22])
    assert decode_chunk(encode_chunk(chunk))==chunk
    with pytest.raises(ValueError):ActivityChunk(index=0,samples=[row()],activity=[[4]*22])
    with pytest.raises(ValueError):ActivityChunk(index=0,samples=[row()],activity=[])


def test_old_physical_input_and_manifest_keep_their_hash_and_shape():
    manifest,_=trace([row()]);raw=manifest.model_dump_json()
    assert parse_manifest(raw).model_dump_json()==raw
    assert 'rest_radius_m' not in manifest.input.settings.model_dump()
    assert manifest_hash(parse_manifest(raw))==manifest.trace_hash
    new=ActivityInput.model_validate({**manifest.input.model_dump(), 'settings':ActivitySettings().model_dump()})
    assert new.settings.motion_policy=='off-ball-activity-1'
    assert not new.settings.activity_calibrated
    with pytest.raises(ValueError):ActivitySettings(walk_speed_m_s=0)
