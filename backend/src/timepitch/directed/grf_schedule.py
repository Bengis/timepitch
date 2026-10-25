"""Plan the physical tick grid without creating or stepping a world."""
import json
from fractions import Fraction
from .wire import _number, _require, read_directed_job

CONTACT_EVENTS = {"Pass", "Shot", "Ball Receipt*", "Goal Keeper", "Block", "Ball Recovery", "Interception", "Duel"}


def plan_grf_ticks(job: dict) -> dict:
    issues, schedule, window, boundary = [], [], None, []
    try:
        j = read_directed_job(json.dumps(job, ensure_ascii=False).encode("utf-8"))
        _require(j["profile"]["clock"] == {"kind": "fixed_10ms", "maxStepMs": 10}, "physical_clock_unverified")
        r, clip = j["request"], j["request"]["clip"]
        _require(_number(clip["fromMs"]) and _number(clip["toMs"]) and 0 <= clip["fromMs"] < clip["toMs"] and _number(clip["period"]) and clip["period"] == 1, "clip_time")
        start, end = Fraction(str(clip["fromMs"])), Fraction(str(clip["toMs"]))
        ticks = (end - start) / 10
        full = ticks.numerator // ticks.denominator
        bracket = -(-ticks.numerator // ticks.denominator)
        duration = end - start
        window = {"fromMs": clip["fromMs"], "toMs": clip["toMs"], "durationMs": int(duration) if duration.denominator == 1 else float(duration),
                  "lastFullTick": full, "rawBracketTick": bracket, "boundaryExact": ticks.denominator == 1}
        if ticks.denominator != 1: issues.append({"code": "clip_boundary_off_grid", "refs": [clip["id"]]})
        boundary = r["boundaryIssues"]
        for command in j["schedule"]:
            e = command["event"]
            _require(_number(e["elapsedMs"]) and _number(e["periodMs"]) and e["periodMs"] == e["elapsedMs"] and _number(e["period"]) and e["period"] == clip["period"] and clip["fromMs"] <= e["elapsedMs"] <= clip["toMs"], "event_time")
            ratio = (Fraction(str(e["elapsedMs"])) - start) / 10
            aligned = ratio.denominator == 1
            schedule.append({"eventId": e["id"], "sourceMs": e["elapsedMs"], "period": e["period"], "physicalTick": int(ratio) if aligned else None, "refs": e["refs"]})
            if not aligned: issues.append({"code": "between_tick_contact_unsupported" if e["kind"] in CONTACT_EVENTS else "event_boundary_off_grid", "refs": [e["id"], *e["refs"]]})
        # Durations and aliases remain source metadata. No extra inferred contact or endpoint is scheduled.
    except (ValueError, TypeError, KeyError, IndexError, OverflowError, RecursionError) as exc:
        issues.append({"code": str(exc) if isinstance(exc, ValueError) else "invalid_tick_request", "refs": []})
    return {"status": "unavailable" if issues else "prepared", "issues": issues, "schedule": schedule, "window": window,
            "boundaryIssues": boundary, "executionMode": "disabled", "measured": False, "acceptance": "not_assessed"}
