import copy
import pytest
from directed_grf_adapter_fixtures import adapter_fixture
from directed_grf_fixtures import rebind


def run(job, port):
    from timepitch.directed.grf_adapter import run_grf_directed
    return run_grf_directed(job, port)


def test_controlled_capture_preserves_ids_constraints_and_native_geometry():
    job, port = adapter_fixture()
    before = copy.deepcopy(job)
    result = run(job, port)
    assert result["status"] == "captured_controlled"
    assert result["acceptance"] == "not_assessed" and result["measured"] is False
    assert result["raw"] == port.raw and result["raw"] is not port.raw
    assert job == before
    names = [name for name, _ in port.calls]
    assert names == ["capabilities", "prepare", "queue", "queue", "queue", "step", "step", "step", "export", "close"]
    prep = port.calls[1][1]
    assert prep["seed"] == 42 and prep["initialState"] == job["initialState"]
    assert prep["nativePlayers"][0]["position"]["value"]["x"] == pytest.approx(12 * 110 / 105 - 55)
    command = port.calls[2][1]
    assert command["actorEngineId"] == "home:1" and command["recipientEngineId"] == "home:2"
    assert command["physicalTick"] == 10 and command["sourceMs"] == job["request"]["events"][0]["elapsedMs"]
    assert "z" not in command["pointNative"]
    assert command["sourceCommand"] == job["schedule"][0]


@pytest.mark.parametrize("kind", ["id", "header", "keeper", "offgrid", "profile", "native_disabled", "initial_state", "body_part", "bad_engine_id", "max_step", "duplicate_native_id"])
def test_rejects_unavailable_controls_or_identity_before_prepare(kind):
    job, port = adapter_fixture()
    if kind == "id": port.caps["actors"][0]["engineId"] = "away:1"
    if kind == "header":
        job["request"]["events"][2]["bodyPart"] = "head"
        port.caps["controls"].remove("header")
    if kind == "keeper":
        job["request"]["events"][2]["kind"] = "Goal Keeper"
        port.caps["controls"].remove("keeper")
    if kind == "offgrid": job["request"]["events"][2]["elapsedMs"] = job["request"]["events"][2]["periodMs"] = job["request"]["clip"]["fromMs"] + 100.325
    if kind == "profile": port.caps["profile"]["engineRevision"] = "wrong"
    if kind == "native_disabled": port.caps["mode"] = "native_disabled"
    if kind == "initial_state": port.caps["controls"].remove("initial_state")
    if kind == "body_part": job["request"]["events"][2]["bodyPart"] = "unknown"
    if kind == "max_step": port.caps["maxStepTicks"] = True
    if kind in ("bad_engine_id", "duplicate_native_id"):
        value = "home:99" if kind == "bad_engine_id" else "home:1"
        job["initialState"]["players"][1]["engineId"] = job["request"]["roster"][1]["engineId"] = value
        port.caps["actors"][1]["engineId"] = value
    rebind(job)
    result = run(job, port)
    assert result["status"] == "unavailable"
    assert not any(name == "prepare" for name, _ in port.calls)
    assert port.calls[-1][0] == "close"


@pytest.mark.parametrize("stage", ["capabilities", "prepare", "queue", "step", "export", "close"])
def test_exception_closes_once_without_reset_retry_or_export_on_failure(stage):
    job, port = adapter_fixture()
    port.raise_at = stage
    result = run(job, port)
    assert result["status"] == "unavailable"
    assert sum(name == "close" for name, _ in port.calls) == 1
    assert sum(name == "prepare" for name, _ in port.calls) <= 1
    if stage in ("prepare", "queue", "step"): assert not any(name == "export" for name, _ in port.calls)
    assert "literal injected failure" not in str(result["issues"])


@pytest.mark.parametrize("stage", ["prepare", "queue", "step"])
def test_unsupported_result_stops_immediately_and_closes(stage):
    job, port = adapter_fixture()
    port.reject_at = stage
    result = run(job, port)
    assert result["status"] == "unavailable"
    assert not any(name == "export" for name, _ in port.calls)
    assert sum(name == stage for name, _ in port.calls) == 1
    assert port.calls[-1][0] == "close"


@pytest.mark.parametrize("kind", ["receiver", "goal", "actor", "time", "order", "clock", "discontinuity", "build", "duplicate_event"])
def test_contradictory_export_fails_and_preserves_original_evidence(kind):
    job, port = adapter_fixture()
    if kind == "receiver": port.raw["events"][0]["recipientEngineId"] = "home:1"
    if kind == "goal": port.raw["events"][2]["outcome"] = "Saved"
    if kind == "actor": port.raw["events"][0]["actorEngineId"] = "away:1"
    if kind == "time": port.raw["events"][0]["sourceMs"] += 10
    if kind == "order": port.raw["events"].reverse()
    if kind == "clock": port.raw["clock"]["physicalMs"] += 10
    if kind == "discontinuity": port.raw["clock"]["discontinuities"] = [1]
    if kind == "build": port.raw["profile"]["artifactSha256"] = "f" * 64
    if kind == "duplicate_event": port.raw["events"].append(copy.deepcopy(port.raw["events"][0]))
    before = copy.deepcopy(port.raw)
    result = run(job, port)
    assert result["status"] == "unavailable"
    assert result["raw"] == before and port.raw == before
    assert result["acceptance"] == "not_assessed"


def test_mutating_dependency_cannot_change_owned_job_or_commands():
    job, port = adapter_fixture()
    port.mutate = True
    before = copy.deepcopy(job)
    result = run(job, port)
    assert result["status"] == "captured_controlled" and job == before


def test_missing_or_invalid_job_still_tears_down_without_capability_probe():
    _, port = adapter_fixture()
    result = run({}, port)
    assert result["status"] == "unavailable" and port.calls == [("close", None)]


def test_dependency_value_error_is_not_exposed_as_a_validation_reason():
    job, port = adapter_fixture()
    def private_error(): raise ValueError("private dependency state")
    port.capabilities = private_error
    result = run(job, port)
    assert "private dependency state" not in str(result)
    assert port.calls == [("close", None)]


def test_dependency_descriptor_error_is_also_sanitized():
    job, port = adapter_fixture()
    class PrivateDescriptorPort:
        @property
        def capabilities(self): raise ValueError("private descriptor state")
        def close(self): port.close()
    result = run(job, PrivateDescriptorPort())
    assert "private descriptor state" not in str(result)
    assert result["status"] == "unavailable" and port.calls == [("close", None)]


@pytest.mark.parametrize("kind", ["too_long", "unknown_event", "inactive_receiver", "missing_receiver", "nonfinite_export"])
def test_additional_bounds_do_not_allow_uncontrolled_work(kind):
    job, port = adapter_fixture()
    if kind == "too_long": job["request"]["clip"]["toMs"] = job["request"]["clip"]["fromMs"] + 100010
    if kind == "unknown_event": job["request"]["events"][0]["kind"] = "unlocated_control"
    if kind == "inactive_receiver": job["request"]["roster"][1]["activeIntervals"][0]["toMs"] = job["request"]["clip"]["fromMs"] + 50
    if kind == "missing_receiver": job["request"]["events"][0]["recipientId"] = None
    if kind == "nonfinite_export": port.raw["samples"] = [{"x": float("nan")}]
    rebind(job)
    result = run(job, port)
    assert result["status"] == "unavailable"
    if kind != "nonfinite_export": assert not any(name == "prepare" for name, _ in port.calls)
    assert port.calls[-1][0] == "close"
