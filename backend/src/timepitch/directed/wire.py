"""Read the immutable cross-language job, without importing an engine."""
import hashlib
import json
import math
import re


def _require(condition, code):
    if not condition:
        raise ValueError(code)


def _keys(value, expected, code):
    _require(isinstance(value, dict) and set(value) == set(expected.split()), code)


def _text(value):
    return isinstance(value, str) and bool(value)


def _number(value):
    return type(value) in (int, float) and math.isfinite(value)


def _hash(value):
    return isinstance(value, str) and re.fullmatch(r"[a-f0-9]{64}", value) is not None


def _pairs(items):
    result = {}
    for key, value in items:
        _require(key not in result, "duplicate_json_key")
        result[key] = value
    return result


def _finite_tree(value, depth=0):
    _require(depth <= 64, "json_depth")
    if type(value) in (int, float):
        _require(_number(value), "nonfinite_json")
    elif isinstance(value, dict):
        for v in value.values():
            _finite_tree(v, depth + 1)
    elif isinstance(value, list):
        for v in value:
            _finite_tree(v, depth + 1)


def _parse(raw):
    def reject_constant(_):
        raise ValueError("nonfinite_json")
    value = json.loads(raw, object_pairs_hook=_pairs, parse_constant=reject_constant)
    _finite_tree(value)
    return value


def _same(a, b):
    # JSON numbers share one type in TS; booleans must never compare as 0/1.
    if _number(a) and _number(b):
        return a == b
    if type(a) is not type(b):
        return False
    if isinstance(a, dict):
        return a.keys() == b.keys() and all(_same(v, b[k]) for k, v in a.items())
    if isinstance(a, list):
        return len(a) == len(b) and all(_same(x, y) for x, y in zip(a, b))
    return a == b


def _vector(v):
    return isinstance(v, dict) and set(v) == {"x", "y", "z"} and all(_number(x) for x in v.values())


def _position(v):
    return _vector(v) and 0 <= v["x"] <= 105 and 0 <= v["y"] <= 68 and v["z"] >= 0


def _prior(value, predicate):
    _keys(value, "value provenance refs reason", "initial_prior")
    _require(value["provenance"] in ("observed", "inferred") and value["reason"] is None
             and isinstance(value["refs"], list) and bool(value["refs"]) and all(_text(x) for x in value["refs"])
             and predicate(value["value"]), "initial_unavailable")


def _profile(p, request):
    _keys(p, "version backend engineRevision directorRevision sourceInventorySha256 artifactSha256 sourceBindingPolicySha256 seed transformId clock availableChannels unsupported executionMode", "profile_fields")
    _require(p["version"] == "directed-profile-1" and p["backend"] == request["backend"] and p["engineRevision"] == request["backendRevision"] and _text(p["directorRevision"]), "profile_identity")
    _require(_hash(p["sourceInventorySha256"]) and _hash(p["sourceBindingPolicySha256"]) and (p["artifactSha256"] is None or _hash(p["artifactSha256"])), "profile_hash")
    _require(p["executionMode"] == "disabled" and _number(p["seed"]) and 0 <= p["seed"] <= 9007199254740991 and p["seed"] == int(p["seed"]) and _text(p["transformId"]), "profile_disabled")
    clock = p["clock"]
    _keys(clock, "kind maxStepMs", "profile_clock")
    _require(clock["kind"] in ("fixed_10ms", "event_subdivision") and _number(clock["maxStepMs"]) and clock["maxStepMs"] > 0 and (clock["kind"] != "fixed_10ms" or clock["maxStepMs"] == 10), "profile_clock")
    channels = p["availableChannels"]
    _require(isinstance(channels, list) and all(isinstance(x, str) for x in channels), "profile_channels")
    _require("positions" in channels and len(set(channels)) == len(channels) and all(x in ("positions", "velocity", "direction", "height", "pose", "contacts", "body_intervals") for x in channels), "profile_channels")
    _require(isinstance(p["unsupported"], list), "profile_issues")
    for issue in p["unsupported"]:
        _keys(issue, "code refs", "profile_issue")
        _require(_text(issue["code"]) and isinstance(issue["refs"], list) and all(_text(x) for x in issue["refs"]), "profile_issue")


def _request_bindings(request):
    """Wire-level invariants, not another historical normalizer or source attestation."""
    _require(_hash(request["sourceDigest"]) and _hash(request["evidenceDigest"]), "source_digest")
    _require(_same(request["policy"], {"version": "directed-physical-1", "playerSpeedMps": 9, "playerAccelerationMps2": 4,
              "ballGroundSpeedMps": 45, "contactM": 0.08, "stanceM": 0.03, "rootClearanceM": 0.5}), "physical_policy")
    evidence, caps = request["evidence"], request["capabilities"]
    _require(evidence["version"] == "sequence-performance-evidence-1" and evidence["sourceKey"] == request["sourceKey"]
             and evidence["evidenceDigest"] == request["evidenceDigest"], "evidence_binding")
    _require(caps["version"] == "directed-engine-capabilities-1" and caps["sourceDigest"] == request["sourceDigest"]
             and caps["evidenceDigest"] == request["evidenceDigest"], "capability_binding")
    _require(request["sourceIdentity"]["source"] == "historical" and _text(request["motionRevision"]), "source_identity")
    _require(_same(_parse(request["sourceKey"]), [request["sourceIdentity"], request["motionRevision"], request["sourceDigest"], request["clip"]]), "source_key")


def _initial(initial, request):
    _keys(initial, "version period sourceMs units players ball phase caches", "initial_fields")
    clip = request["clip"]
    _require(initial["version"] == "directed-initial-1" and initial["units"] == "metres"
             and _same(initial["period"], clip["period"]) and _same(initial["sourceMs"], clip["fromMs"]), "initial_identity")
    active = {p["playerKey"]: p["engineId"] for p in request["roster"] if any(i["period"] == clip["period"] and i["fromMs"] <= clip["fromMs"] <= i["toMs"] for i in p["activeIntervals"])}
    _require(isinstance(initial["players"], list) and len(initial["players"]) == len(active), "initial_roster")
    seen = set()
    for p in initial["players"]:
        _keys(p, "playerKey engineId position velocity phase energy memory", "initial_player")
        _require(_text(p["playerKey"]) and p["playerKey"] not in seen and active.get(p["playerKey"]) == p["engineId"], "initial_player")
        seen.add(p["playerKey"])
        _prior(p["position"], _position)
        _prior(p["velocity"], _vector)
        _prior(p["phase"], _text)
        _prior(p["energy"], lambda v: _number(v) and 0 <= v <= 1)
        _prior(p["memory"], lambda v: isinstance(v, dict))
    _keys(initial["ball"], "position velocity ownerId", "initial_ball")
    _prior(initial["ball"]["position"], _position)
    _prior(initial["ball"]["velocity"], _vector)
    _prior(initial["ball"]["ownerId"], lambda v: v is None or _text(v) and v in seen)
    _prior(initial["phase"], _text)
    _prior(initial["caches"], lambda v: isinstance(v, dict) and set(v) == {"revision", "values"} and _text(v["revision"]) and isinstance(v["values"], dict))


def read_directed_job(payload: bytes) -> dict:
    """Validate bytes/declarations only. No source authentication or execution permit."""
    try:
        _require(isinstance(payload, bytes), "wire_bytes")
        job = _parse(payload.decode("utf-8"))
        _keys(job, "version request requestPayloadUtf8 profile initialState schedule", "job_fields")
        _require(job["version"] == "directed-job-1", "job_version")
        request = job["request"]
        _keys(request, "version backend backendRevision executionAvailable sourceKey sourceDigest evidenceDigest sourceIdentity motionRevision clip events evidence roster aliases cuts policy capabilities boundaryIssues requestDigest", "request_fields")
        _require(request["version"] == "directed-request-1" and request["executionAvailable"] is False
                 and request["backend"] in ("grf", "touchlines") and _hash(request["requestDigest"]), "request_identity")
        _require(isinstance(job["requestPayloadUtf8"], str), "payload_utf8")
        raw = job["requestPayloadUtf8"].encode("utf-8")
        bound = _parse(raw.decode("utf-8"))
        _require(hashlib.sha256(raw).hexdigest() == request["requestDigest"] and _same(bound, {k: v for k, v in request.items() if k != "requestDigest"}), "request_byte_identity")
        _request_bindings(request)
        _profile(job["profile"], request)
        _initial(job["initialState"], request)
        actions = {a["eventId"]: a for a in request["evidence"]["actions"]}
        aliases = {a["eventId"]: a for a in request["aliases"]}
        events = request["events"]
        _require(len(actions) == len(request["evidence"]["actions"]) and len(aliases) == len(request["aliases"])
                 and len({e["id"] for e in events}) == len(events), "schedule_duplicate")
        _require(all(k in {e["id"] for e in events} for k in (*actions, *aliases)), "schedule_reference")
        expected = [{"event": e, "evidence": actions.get(e["id"]), "alias": aliases.get(e["id"])} for e in sorted(events, key=lambda e: (e["elapsedMs"], e["sourceIndex"]))]
        _require(_same(job["schedule"], expected), "schedule_identity")
        return job
    except (KeyError, TypeError, IndexError, UnicodeError, RecursionError, OverflowError) as exc:
        raise ValueError("invalid_directed_wire") from exc
