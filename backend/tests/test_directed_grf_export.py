"""G4: bind the controlled native-shape export literal to the native-1 patch text and the pure host lowering.

Reads files only. No native import, world, step, export call, match, solver or model.
"""
import copy
import hashlib
import json
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
PATCH_DIR = ROOT / "backend" / "native" / "directed-grf" / "patches" / "native-1"
LITERAL = ROOT / "web" / "src" / "match-centre" / "directed" / "grf" / "native-export-controlled-literal.json"
JOB = ROOT / "backend" / "tests" / "fixtures" / "directed-job-1.json"


def _export_source():
    patch = (PATCH_DIR / "0001-directed-native-control.patch").read_bytes()
    manifest = json.loads((PATCH_DIR / "manifest.json").read_bytes())
    assert hashlib.sha256(patch).hexdigest() == manifest["patchSha256"]
    text = patch.decode("utf-8")
    start = text.index("+std::string Director::Export() const {")
    end = text.index("+} // namespace timepitch_directed", start)
    return text[start:end]


def _emitted():
    body = _export_source()
    loops = {}
    for line in body.splitlines():
        m = re.match(r"\+\s*for\(const auto& \w+:(\w+)_\)", line)
        if m:
            loops[m.group(1)] = line
    top = set(re.findall(r'out\["(\w+)"\]', body))
    fields = {name: set(re.findall(r'd\["(\w+)"\]', line)) for name, line in loops.items()}
    fields["samplePlayers"] = set(re.findall(r'p\["(\w+)"\]', loops["samples"]))
    return top, fields


def _literal():
    from timepitch.directed.wire import _parse
    return _parse(LITERAL.read_bytes().decode("utf-8"))


def _g4_job():
    """Same aligned 300 ms variant and G4 profile as export.test.ts request()/profile(); never the 13.826 s pilot.

    Shifts the shot, its evidence actions and snapshots to fromMs+250 exactly like request(), then rebinds the
    request bytes, digest and schedule with the shared fixture helper so the host accepts it.
    """
    from directed_grf_fixtures import rebind
    job = json.loads(JOB.read_bytes())
    r = job["request"]
    start = r["clip"]["fromMs"]
    r["clip"]["toMs"] = start + 300
    r["events"][2]["elapsedMs"] = r["events"][2]["periodMs"] = start + 250
    for a in r["evidence"]["actions"]:
        a["elapsedMs"] = start + 250
    for s in r["evidence"]["snapshots"]:
        s["elapsedMs"] = s["periodMs"] = start + 250
    rebind(job)
    job["profile"].update(directorRevision="directed-grf-native-1", transformId="grf-world-110x72-canonical-105x68-v1",
                          artifactSha256="d" * 64, availableChannels=["positions", "velocity", "height", "contacts"])
    return job


def _host_preflight(job):
    """Run the G3 host's own pure preflight (schedule + command lowering) against a declared capabilities dict.

    No port object, native import or engine call. Only the source-inventory digest differs from the literal profile:
    the declared inventory must hash to it, and commands do not depend on it.
    """
    from directed_grf_fixtures import profile_fixture
    from timepitch.directed.grf_adapter import _preflight
    _, inventory = profile_fixture()
    host = copy.deepcopy(job)
    host["profile"]["sourceInventorySha256"] = inventory["artifactEvidence"]["sourceInventorySha256"]
    actors = [{"playerKey": p["playerKey"], "engineId": p["engineId"]} for p in host["initialState"]["players"]]
    caps = {"version": "grf-directed-port-1", "mode": "controlled_double", "executionMode": "disabled",
            "profile": copy.deepcopy(host["profile"]), "inventory": inventory, "actors": actors,
            "controls": ["initial_state", "pass", "receipt", "shot", "header", "keeper", "block", "recovery", "interception", "duel"],
            "bodyParts": [None, "left_foot", "right_foot", "head"], "maxStepTicks": 10}
    return _preflight(host, caps)


def test_literal_fields_match_what_native_1_export_emits():
    top, fields = _emitted()
    x = _literal()
    assert set(x) == top
    assert all(set(a) == fields["actors"] for a in x["actors"])
    assert all(set(c) == fields["commands"] for c in x["commands"])
    assert all(set(c) == fields["contacts"] for c in x["contacts"])
    assert all(set(s) == fields["samples"] for s in x["samples"])
    assert all(set(p) == fields["samplePlayers"] for s in x["samples"] for p in s["players"])


def test_native_export_declares_no_body_surface_interval_or_tracking_authority():
    body = _export_source()
    assert 'out["acceptance"]="not_assessed"' in body and 'out["executionMode"]="disabled"' in body
    assert 'd["animationTargetAuthority"]="animation_target_not_body_surface"' in body
    assert 'd["bodySurface"]=bp::object()' in body and 'out["bodyIntervals"]=bp::object()' in body
    assert 'out["historicalTracking"]=false' in body
    assert "pose" not in body.lower() and "owner" not in body.lower()
    x = _literal()
    assert x["acceptance"] == "not_assessed" and x["executionMode"] == "disabled"
    assert x["bodyIntervals"] is None and x["historicalTracking"] is False
    assert all(c["bodySurface"] is None and c["animationTargetAuthority"] == "animation_target_not_body_surface" for c in x["contacts"])


def test_literal_profile_and_world_basis_bind_to_the_registered_transform():
    from timepitch.directed.grf_coordinates import TRANSFORM
    from timepitch.directed.wire import _parse
    x, job = _literal(), _g4_job()
    profile = _parse(x["profileJson"])
    assert profile == job["profile"] and profile["transformId"] == TRANSFORM
    assert x["patchRevision"] == profile["directorRevision"] == "directed-grf-native-1"
    assert profile["executionMode"] == "disabled"


def test_literal_initial_packet_is_the_pure_host_lowering_of_the_job():
    from timepitch.directed.grf_adapter import _prepare_packet
    from timepitch.directed.grf_native_packets import lower_native_initial
    from timepitch.directed.wire import _parse
    x, job = _literal(), _g4_job()
    actors, mapping, _, ticks, _ = _host_preflight(job)
    assert ticks == x["physicalTicks"] == 30
    packet = _prepare_packet(job, mapping, ticks)
    packet["initialState"]["caches"]["value"]["revision"] = "grf-directed-cold-start-1"
    assert _parse(x["initialPacketUtf8"]) == lower_native_initial(packet)
    assert x["actors"] == actors == [{"playerKey": k, "engineId": v} for k, v in mapping.items()]
    assert x["sourceStartMs"] == job["request"]["clip"]["fromMs"] and x["nativeEpochMs"] == 0


def test_literal_commands_are_the_host_lowering_of_the_job_schedule():
    """Commands come from the host's own preflight; only nativeControl (launch tick, function, power) is a declared prior."""
    from timepitch.directed.grf_native_packets import lower_native_command
    from timepitch.directed.wire import _parse
    x, job = _literal(), _g4_job()
    _, _, commands, _, _ = _host_preflight(job)
    assert [c["eventId"] for c in x["commands"]] == [c["eventId"] for c in commands] == [e["id"] for e in job["request"]["events"]]
    actions = {a["eventId"]: a for a in job["request"]["evidence"]["actions"]}
    for entry, command in zip(x["commands"], commands):
        packet = _parse(entry["inputPacketUtf8"])
        assert packet == lower_native_command(command, packet["nativeControl"])
        assert packet["sourceCommand"]["evidence"] == actions.get(entry["eventId"])
        assert packet["sourceCommand"]["event"]["elapsedMs"] == packet["sourceMs"]


def test_literal_clock_and_contacts_stay_on_the_native_fixed_grid():
    x = _literal()
    assert [s["tick"] for s in x["samples"]] == list(range(x["physicalTicks"] + 1))
    assert all(s["nativeMs"] == x["nativeEpochMs"] + 10 * s["tick"] for s in x["samples"])
    assert all(c["relativeMs"] % 10 == 0 and c["nativeMs"] == x["nativeEpochMs"] + c["relativeMs"] for c in x["contacts"])


@pytest.mark.parametrize("mutation", ["duplicate_key", "nan"])
def test_literal_parser_rejects_ambiguous_json(mutation):
    from timepitch.directed.wire import _parse
    raw = LITERAL.read_bytes().decode("utf-8")
    bad = raw.replace('"status": "captured",', '"status": "captured", "status": "failed",', 1) if mutation == "duplicate_key" \
        else raw.replace('"nativeEpochMs": 0', '"nativeEpochMs": NaN', 1)
    assert bad != raw
    with pytest.raises(ValueError):
        _parse(bad)


def test_pilot_job_cannot_be_lowered_onto_the_fixed_grid():
    """The 13.826 s pilot keeps its off-grid end and shot blocked; no literal export is claimed for it."""
    from timepitch.directed.grf_schedule import plan_grf_ticks
    job = json.loads(JOB.read_bytes())
    job["profile"] = copy.deepcopy(_g4_job()["profile"])
    plan = plan_grf_ticks(job)
    assert plan["status"] == "unavailable"
    codes = {i["code"] for i in plan["issues"]}
    assert {"clip_boundary_off_grid", "between_tick_contact_unsupported"} <= codes
