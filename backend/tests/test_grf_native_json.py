"""Exact worker-wire compatibility without native GRF or match generation."""
import importlib
import io
import json
import math

import pytest

pytest.register_assert_rewrite('grf_json_fixtures')
from grf_json_fixtures import derived_native_payload, saved_record, no_match_or_model, UBUNTU


def native_json():
    assert importlib.util.find_spec('timepitch.grf.native_json'), 'Missing bulk JSON module'
    return importlib.import_module('timepitch.grf.native_json')


@pytest.mark.parametrize('payload,expected', [
    ({'z': 'é⚽', 'a': [-0.0, 1e-300, 1.0]}, '{"z":"\\u00e9\\u26bd","a":[-0.0,1e-300,1.0]}'),
    ({'telemetry': {'events': [], 'overflowed': False}}, '{"telemetry":{"events":[],"overflowed":false}}'),
    ({}, '{}'),
])
def test_bulk_wire_matches_independent_literal(payload, expected):
    codec = native_json()
    assert codec.encode_native_result(payload) == expected
    stream = io.StringIO()
    codec.write_native_json(codec.encode_native_result(payload), stream)
    assert stream.getvalue() == expected


@pytest.mark.parametrize('source', ['v1', 'v2', 'flota', 'ubuntu'])
def test_bulk_matches_legacy_dump_on_complete_derived_payload(source):
    from grf_fixtures import replay_fixture, full_replay
    codec = native_json()
    record = replay_fixture() if source=='v1' else full_replay() if source=='v2' else saved_record(UBUNTU) if source=='ubuntu' else saved_record()
    payload = derived_native_payload(record)
    old = io.StringIO()
    json.dump(payload, old, separators=(',', ':'), allow_nan=False)
    assert codec.encode_native_result(payload).encode('ascii') == old.getvalue().encode('ascii')


def test_finite_extremes_remain_exact():
    codec = native_json()
    values = [0., -0., math.ulp(0.), -math.ulp(0.), math.nextafter(1., 0.),
              math.nextafter(1., math.inf), 1.7976931348623157e308]
    payload = {'values': values}
    old = io.StringIO(); json.dump(payload, old, separators=(',', ':'), allow_nan=False)
    assert codec.encode_native_result(payload) == old.getvalue()


def test_wire_budget_exact_boundary_and_nonfinite(monkeypatch):
    codec = native_json()
    from timepitch.grf.codec import MAX_BYTES
    assert codec.MAX_BYTES == MAX_BYTES == 16*1024*1024
    monkeypatch.setattr(codec, 'MAX_BYTES', 16)
    assert len(codec.encode_native_result({'a': 'x'*8})) == 16
    with pytest.raises(ValueError): codec.encode_native_result({'a': 'x'*9})
    for value in (math.nan, math.inf, -math.inf):
        with pytest.raises(ValueError): codec.encode_native_result({'bad': value})


def test_write_once_flush_and_propagate_partial_or_failed_io():
    codec = native_json()
    class Stream:
        def __init__(self, result=2, error=False): self.result=result; self.error=error; self.writes=[]; self.flushed=False
        def write(self, text):
            self.writes.append(text)
            if self.error: raise BrokenPipeError('closed')
            return self.result
        def flush(self): self.flushed=True
    good=Stream();codec.write_native_json('{}', good)
    assert good.writes == ['{}'] and good.flushed
    for count in (0, 1, None):
        stream=Stream(count)
        with pytest.raises(OSError): codec.write_native_json('{}', stream)
        assert stream.writes == ['{}'] and not stream.flushed
    with pytest.raises(BrokenPipeError): codec.write_native_json('{}', Stream(error=True))
    class FailedFlush(Stream):
        def flush(self): raise OSError('flush failed')
    with pytest.raises(OSError): codec.write_native_json('{}', FailedFlush())


def test_new_nested_json_spans_and_legacy_profiles_are_accepted():
    from timepitch.grf.performance import PROFILE_PREFIX, read_worker_profile
    for stages in ({'json_output': 30}, {'json_output': 30, 'json_encode': 10, 'json_write': 15}):
        report=dict(schema='grf-worker-profile-1',input_hash='a'*64,status='passed',wall_ns=40,
            timings_ns=stages,calls={key:1 for key in stages},native_step_ns=None)
        status,actual=read_worker_profile((PROFILE_PREFIX+json.dumps(report)+'\n').encode(),'a'*64)
        assert status == 'available' and actual['timings_ns'] == stages
