import copy
import pytest
from directed_grf_fixtures import job_fixture, rebind
from timepitch.directed.grf_schedule import plan_grf_ticks


def test_prepares_aligned_controlled_grid_without_running_or_extending_actions():
    job = job_fixture(aligned=True)
    before = copy.deepcopy(job)
    result = plan_grf_ticks(job)
    assert result["status"] == "prepared"
    assert [e["physicalTick"] for e in result["schedule"]] == [10, 20, 30]
    assert result["window"]["durationMs"] == 300
    assert result["executionMode"] == "disabled" and result["measured"] is False
    assert job == before


def test_reports_unrounded_13_826_second_boundary_on_controlled_fixture():
    job = job_fixture()
    before = copy.deepcopy(job)
    result = plan_grf_ticks(job)
    assert result["status"] == "unavailable"
    assert result["window"] == {"fromMs": 1684024, "toMs": 1697850, "durationMs": 13826, "lastFullTick": 1382, "rawBracketTick": 1383, "boundaryExact": False}
    assert any(i["code"] == "clip_boundary_off_grid" for i in result["issues"])
    assert job == before


def test_fractional_contact_is_not_rounded_or_aliased_to_neighbour_tick():
    job = job_fixture(aligned=True)
    event = job["request"]["events"][2]
    event["elapsedMs"] = event["periodMs"] = job["request"]["clip"]["fromMs"] + 100.325
    rebind(job)
    result = plan_grf_ticks(job)
    assert result["status"] == "unavailable"
    item = next(x for x in result["schedule"] if x["eventId"] == "shot")
    assert item["sourceMs"] == event["elapsedMs"] and item["physicalTick"] is None
    assert any(i["code"] == "between_tick_contact_unsupported" and "shot" in i["refs"] for i in result["issues"])


@pytest.mark.parametrize("kind", ["period", "period_time", "outside", "clock", "hash", "nonfinite"])
def test_rejects_invalid_schedule_without_fallback(kind):
    job = job_fixture(aligned=True)
    if kind == "period": job["request"]["events"][0]["period"] = 2
    if kind == "period_time": job["request"]["events"][0]["periodMs"] += .325
    if kind == "outside": job["request"]["events"][0]["elapsedMs"] -= 1000
    if kind == "clock": job["profile"]["clock"]["kind"] = "event_subdivision"
    if kind == "hash": job["request"]["requestDigest"] = "f" * 64
    if kind == "nonfinite": job["request"]["events"][0]["elapsedMs"] = float("inf")
    if kind not in ("hash", "nonfinite"): rebind(job)
    assert plan_grf_ticks(job)["status"] == "unavailable"


def test_json_integer_storage_and_retained_alias_are_not_new_physical_constraints():
    job = job_fixture(aligned=True)
    job["request"]["clip"]["period"] = job["initialState"]["period"] = 1.0
    for e in job["request"]["events"]: e["period"] = 1.0
    rebind(job)
    before = copy.deepcopy(job)
    result = plan_grf_ticks(job)
    assert result["status"] == "prepared"
    assert result["boundaryIssues"] == job["request"]["boundaryIssues"]
    assert job["request"]["aliases"][0]["deltaMs"] == -.5
    assert job == before
