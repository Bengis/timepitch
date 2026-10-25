"""Controlled wire fixtures only; no GRF, model, source loader or subprocess."""
import copy
import hashlib
import json
from pathlib import Path

import pytest
from timepitch.directed.wire import read_directed_job

FIXTURE = Path(__file__).parent / "fixtures" / "directed-job-1.json"


def fixture():
    return json.loads(FIXTURE.read_bytes())


def encoded(job):
    return json.dumps(job, ensure_ascii=False).encode("utf-8")


def test_reads_exact_utf8_payload_without_python_reserialization():
    job = fixture()
    result = read_directed_job(encoded(job))
    assert result == job
    raw = result["requestPayloadUtf8"].encode("utf-8")
    assert hashlib.sha256(raw).hexdigest() == result["request"]["requestDigest"]
    assert b'\xc3\xa9' in raw and b'\xe2\x9a\xbd' in raw
    assert hashlib.sha256(json.dumps({k: v for k, v in job["request"].items() if k != "requestDigest"}).encode()).hexdigest() != job["request"]["requestDigest"]
    result["initialState"]["players"][0]["position"]["value"]["x"] = 99
    assert fixture()["initialState"]["players"][0]["position"]["value"]["x"] == 12


@pytest.mark.parametrize("kind", ["digest", "payload_bytes", "request_content", "revision", "backend", "enabled", "schedule_event", "schedule_alias", "duplicate_initial", "unknown_owner", "missing_cache", "nonfinite", "unknown_field", "unavailable_prior", "bool_seed"])
def test_rejects_changed_or_incomplete_wire(kind):
    job = copy.deepcopy(fixture())
    if kind == "digest": job["request"]["requestDigest"] = "f" * 64
    if kind == "payload_bytes": job["requestPayloadUtf8"] += " "
    if kind == "request_content": job["request"]["events"][2]["outcome"] = "Saved"
    if kind == "revision": job["profile"]["engineRevision"] = "other"
    if kind == "backend": job["profile"]["backend"] = "touchlines"
    if kind == "enabled": job["profile"]["executionMode"] = "enabled"
    if kind == "schedule_event": job["schedule"][2]["event"]["outcome"] = "Saved"
    if kind == "schedule_alias": job["schedule"][0]["alias"]["deltaMs"] = 0
    if kind == "duplicate_initial": job["initialState"]["players"][1] = job["initialState"]["players"][0]
    if kind == "unknown_owner": job["initialState"]["ball"]["ownerId"]["value"] = "foreign"
    if kind == "missing_cache": del job["initialState"]["caches"]
    if kind == "nonfinite": job["initialState"]["players"][0]["velocity"]["value"]["x"] = float("inf")
    if kind == "unknown_field": job["run"] = True
    if kind == "unavailable_prior": job["initialState"]["phase"] = {"value": None, "provenance": "unavailable", "refs": [], "reason": "unknown"}
    if kind == "bool_seed": job["profile"]["seed"] = True
    with pytest.raises(ValueError): read_directed_job(encoded(job))


@pytest.mark.parametrize("raw", [b'{"version":1,"version":2}', b'{"x":NaN}', b'{"x":1e9999}', b'\xff', b'[]', b'null'])
def test_rejects_nonfinite_duplicates_and_invalid_utf8(raw):
    with pytest.raises(ValueError): read_directed_job(raw)


def test_duplicate_key_inside_bound_payload_is_not_hidden_by_last_value():
    job = fixture()
    job["requestPayloadUtf8"] = job["requestPayloadUtf8"].replace('"backend":"grf"', '"backend":"touchlines","backend":"grf"', 1)
    job["request"]["requestDigest"] = hashlib.sha256(job["requestPayloadUtf8"].encode()).hexdigest()
    with pytest.raises(ValueError): read_directed_job(encoded(job))


@pytest.mark.parametrize("kind", ["policy", "source_digest", "evidence_digest", "source_key", "request_version"])
def test_hash_is_not_permission_to_change_request_declarations(kind):
    job = fixture()
    if kind == "policy": job["request"]["policy"]["playerSpeedMps"] = 90
    if kind == "source_digest": job["request"]["sourceDigest"] = "f" * 64
    if kind == "evidence_digest": job["request"]["evidenceDigest"] = "f" * 64
    if kind == "source_key": job["request"]["sourceKey"] = "[]"
    if kind == "request_version": job["request"]["evidence"]["version"] = "other"
    job["requestPayloadUtf8"] = json.dumps({k: v for k, v in job["request"].items() if k != "requestDigest"}, ensure_ascii=False, separators=(",", ":"))
    job["request"]["requestDigest"] = hashlib.sha256(job["requestPayloadUtf8"].encode()).hexdigest()
    with pytest.raises(ValueError): read_directed_job(encoded(job))


def test_wire_module_has_only_stdlib_dependencies_and_no_execution_entrypoint():
    import ast
    import inspect
    from timepitch.directed import wire
    tree = ast.parse(inspect.getsource(wire))
    assert {n.names[0].name for n in ast.walk(tree) if isinstance(n, ast.Import)} <= {"hashlib", "json", "math", "re"}
    assert not any(isinstance(n, ast.ImportFrom) for n in ast.walk(tree))
    assert not any(isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id in {"open", "exec", "eval", "__import__"} for n in ast.walk(tree))


def test_json_integral_number_is_not_confused_with_python_numeric_storage():
    job = fixture()
    job["profile"]["seed"] = 42.0
    assert read_directed_job(encoded(job))["profile"]["seed"] == 42
