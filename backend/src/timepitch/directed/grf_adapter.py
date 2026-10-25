"""Controlled host orchestration, not a native runner or physical acceptance."""
import json
import re
from .grf_port import GrfDirectedPort
from .grf_profile import check_grf_profile
from .grf_coordinates import BASIS, canonical_to_grf
from .grf_schedule import plan_grf_ticks
from .wire import _keys, _number, _parse, _require, _same, _text, read_directed_job

CONTROLS = {"Pass": "pass", "Ball Receipt*": "receipt", "Shot": "shot", "Goal Keeper": "keeper",
            "Block": "block", "Ball Recovery": "recovery", "Interception": "interception", "Duel": "duel"}
MAX_TICKS, MAX_COMMANDS, MAX_PACKET_BYTES = 10000, 1000, 4 * 1024 * 1024


def _copy(value):
    raw = json.dumps(value, ensure_ascii=False).encode("utf-8")
    _require(len(raw) <= MAX_PACKET_BYTES, "controlled_packet_limit")
    return _parse(raw.decode("utf-8"))


def _invoke(port, name, *args):
    try:
        return getattr(port, name)(*args)
    except Exception:
        raise RuntimeError("port_exception") from None


def _world(value, kind="position"):
    return canonical_to_grf({**value, "space": "canonical_metres", "kind": kind,
                             **({"zUnit": "metres"} if "z" in value else {})}, BASIS)


def _actors(values):
    _require(isinstance(values, list), "native_identity")
    mapping = {}
    seen = set()
    for actor in values:
        _keys(actor, "playerKey engineId", "native_identity")
        key, native = actor["playerKey"], actor["engineId"]
        _require(_text(key) and _text(native) and re.fullmatch(r"(?:home|away):(?:[0-9]|10)", native)
                 and key not in mapping and native not in seen, "native_identity")
        mapping[key] = native
        seen.add(native)
    return mapping


def _prepare_packet(job, mapping, ticks):
    initial = job["initialState"]
    players = []
    for player in initial["players"]:
        p = _copy(player)
        p["position"]["value"] = _world(p["position"]["value"])
        p["velocity"]["value"] = _world(p["velocity"]["value"], "velocity")
        players.append(p)
    ball = _copy(initial["ball"])
    ball["position"]["value"] = _world(ball["position"]["value"])
    ball["velocity"]["value"] = _world(ball["velocity"]["value"], "velocity")
    owner = ball["ownerId"]["value"]
    ball["ownerId"]["value"] = mapping[owner] if owner is not None else None
    return {"seed": job["profile"]["seed"], "profile": job["profile"], "initialState": initial,
            "nativePlayers": players, "nativeBall": ball,
            "clock": {"startSourceMs": initial["sourceMs"], "tickMs": 10, "totalTicks": ticks}}


def _preflight(job, caps):
    _require(caps.get("mode") == "controlled_double", "native_execution_not_authorized")
    _keys(caps, "version mode executionMode profile inventory actors controls bodyParts maxStepTicks", "port_capabilities")
    _require(caps["version"] == "grf-directed-port-1" and caps["executionMode"] == "disabled", "port_mode")
    _require(_same(caps["profile"], job["profile"]) and job["request"]["backend"] == "grf", "port_profile")
    _require(check_grf_profile(job["profile"], caps["inventory"])["status"] == "prepared", "port_profile_unavailable")
    grid = plan_grf_ticks(job)
    _require(grid["status"] == "prepared", "physical_schedule_unavailable")
    ticks = grid["window"]["lastFullTick"]
    _require(0 < ticks <= MAX_TICKS and len(job["schedule"]) <= MAX_COMMANDS, "controlled_work_limit")
    chunk = caps["maxStepTicks"]
    _require(_number(chunk) and chunk == int(chunk) and 1 <= chunk <= 100, "controlled_step_limit")
    actors = [{"playerKey": p["playerKey"], "engineId": p["engineId"]} for p in job["initialState"]["players"]]
    mapping = _actors(actors)
    _require(mapping == _actors(caps["actors"]), "native_identity")
    roster = {p["playerKey"]: p for p in job["request"]["roster"]}
    for key, native in mapping.items():
        _require(native.split(":")[0] == roster[key]["side"], "native_side")
    controls = caps["controls"]
    _require(isinstance(controls, list) and all(_text(x) for x in controls) and len(controls) == len(set(controls))
             and "initial_state" in controls and isinstance(caps["bodyParts"], list), "initial_control_unavailable")
    commands = []
    for source, tick in zip(job["schedule"], grid["schedule"]):
        e = source["event"]
        _require(e["kind"] in CONTROLS and CONTROLS[e["kind"]] in controls, "event_control_unavailable")
        _require(e["bodyPart"] in caps["bodyParts"] and (e["bodyPart"] != "head" or "header" in controls), "body_control_unavailable")
        _require(e["actorId"] in mapping and e["side"] == roster[e["actorId"]]["side"], "event_actor_unavailable")
        keys = [e["actorId"]] + ([e["recipientId"]] if e["recipientId"] is not None else [])
        for key in keys:
            _require(key in mapping and any(i["period"] == e["period"] and i["fromMs"] <= e["elapsedMs"] <= i["toMs"] for i in roster[key]["activeIntervals"]), "event_actor_inactive")
        if e["kind"] == "Pass":
            _require(e["recipientId"] in mapping and e["recipientId"] != e["actorId"]
                     and roster[e["recipientId"]]["side"] == e["side"], "explicit_receiver_required")
        commands.append({"eventId": e["id"], "refs": e["refs"], "kind": e["kind"],
                         "actorEngineId": mapping[e["actorId"]], "recipientEngineId": mapping.get(e["recipientId"]),
                         "sourceMs": e["elapsedMs"], "physicalTick": tick["physicalTick"],
                         "pointNative": _world(e["start"]) if e["start"] is not None else None,
                         "targetNative": _world(e["end"]) if e["end"] is not None else None,
                         "bodyPart": e["bodyPart"], "outcomeConstraint": e["outcome"], "sourceCommand": source})
    return actors, mapping, commands, ticks, int(chunk)


def _check_export(raw, profile, actors, commands, ticks):
    # This consistency check is deliberately weaker than G4's independent evidence audit.
    _keys(raw, "version profile actors clock events contacts samples unavailableChannels", "raw_export")
    _require(raw["version"] == "grf-directed-raw-1" and _same(raw["profile"], profile), "raw_profile")
    _require(_actors(raw["actors"]) == _actors(actors), "raw_identity")
    _require(_same(raw["clock"], {"ticks": ticks, "physicalMs": ticks * 10, "discontinuities": []}), "raw_clock")
    expected = [{"eventId": c["eventId"], "sourceMs": c["sourceMs"], "kind": c["kind"],
                 "actorEngineId": c["actorEngineId"], "recipientEngineId": c["recipientEngineId"],
                 "outcome": c["outcomeConstraint"], "bodyPart": c["bodyPart"]} for c in commands]
    _require(_same(raw["events"], expected), "event_result_mismatch")
    _require(isinstance(raw["contacts"], list) and isinstance(raw["samples"], list)
             and isinstance(raw["unavailableChannels"], list), "raw_channels")


def run_grf_directed(job: dict, port: GrfDirectedPort) -> dict:
    """Only injected controlled doubles in G3. No default port, loader or retry."""
    issues, raw, status, stage = [], None, "unavailable", "job"
    try:
        owned = read_directed_job(json.dumps(_copy(job), ensure_ascii=False).encode("utf-8"))
        stage = "capabilities"
        caps = _copy(_invoke(port, "capabilities"))
        actors, mapping, commands, ticks, chunk = _preflight(owned, caps)
        stage = "prepare"
        _require(_same(_copy(_invoke(port, "prepare", _copy(_prepare_packet(owned, mapping, ticks)))), {"status": "ok"}), "prepare_unsupported")
        stage = "queue"
        for command in commands:
            _require(_same(_copy(_invoke(port, "queue", _copy(command))), {"status": "ok"}), "queue_unsupported")
        stage = "step"
        remaining = ticks
        while remaining:
            count = min(chunk, remaining)
            _require(_same(_copy(_invoke(port, "step", count)), {"status": "ok"}), "step_unsupported")
            remaining -= count
        stage = "export"
        raw = _copy(_invoke(port, "export"))
        _check_export(raw, owned["profile"], actors, commands, ticks)
        status = "captured_controlled"
    except Exception as exc:
        # Never expose dependency exception text (which may include private state).
        issues.append({"code": "controlled_" + stage + "_failed", "refs": [], "reason": str(exc) if isinstance(exc, ValueError) else "port_exception"})
    finally:
        try:
            port.close()
        except Exception:
            issues.append({"code": "controlled_close_failed", "refs": []})
            status = "unavailable"
    return {"status": status, "issues": issues, "raw": raw, "executionMode": "disabled", "measured": False,
            "acceptance": "not_assessed", "authority": "controlled_port_declarations_only"}
