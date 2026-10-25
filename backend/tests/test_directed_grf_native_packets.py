import copy
import pytest
from directed_grf_adapter_fixtures import adapter_fixture
from test_directed_grf_boundaries import _patch_outputs


def initial_packet():
    from timepitch.directed.grf_adapter import _prepare_packet
    job, _ = adapter_fixture()
    packet = _prepare_packet(job, {p["playerKey"]: p["engineId"] for p in job["initialState"]["players"]}, 30)
    packet["initialState"]["caches"]["value"]["revision"] = "grf-directed-cold-start-1"
    return packet


def test_lowers_explicit_inferred_cold_start_without_mutating_or_enabling_job():
    from timepitch.directed.grf_native_packets import lower_native_initial
    packet = initial_packet()
    before = copy.deepcopy(packet)
    result = lower_native_initial(packet)
    assert packet == before and result is not packet
    assert result["initialState"] == before["initialState"]
    assert result["nativeOptions"] == {"version": "grf-directed-native-options-1", "initialStatePolicy": "grf-directed-cold-start-1"}
    assert result["profile"]["executionMode"] == "disabled"


@pytest.mark.parametrize("kind", ["memory", "cache", "phase", "owner", "seed", "moving_z", "position_provenance"])
def test_unrepresentable_initial_state_is_not_silently_reset(kind):
    from timepitch.directed.grf_native_packets import lower_native_initial
    packet = initial_packet()
    if kind == "memory": packet["initialState"]["players"][0]["memory"]["value"] = {"unknown": 1}
    if kind == "cache": packet["initialState"]["caches"]["value"]["revision"] = "unreviewed"
    if kind == "phase": packet["initialState"]["phase"]["value"] = "set_piece"
    if kind == "owner": packet["initialState"]["ball"]["ownerId"]["value"] = "historical:statsbomb:1"
    if kind == "seed": packet["seed"] = 2**32
    if kind == "moving_z": packet["nativePlayers"][0]["velocity"]["value"]["z"] = 1
    if kind == "position_provenance": packet["initialState"]["players"][0]["position"]["provenance"] = "observed"
    with pytest.raises(ValueError): lower_native_initial(packet)


def test_command_keeps_historical_time_and_result_as_constraints():
    from timepitch.directed.grf_native_packets import lower_native_command
    command = {"eventId": "pass", "kind": "Pass", "physicalTick": 40, "sourceMs": 1040,
               "actorEngineId": "home:1", "recipientEngineId": "home:2", "bodyPart": None,
               "outcomeConstraint": None, "sourceCommand": {"event": {"id": "pass"}}}
    before = copy.deepcopy(command)
    result = lower_native_command(command, {"function": "short_pass", "launchTick": 10, "power": .5})
    assert command == before and result["sourceMs"] == 1040 and result["physicalTick"] == 40
    assert result["sourceCommand"] == before["sourceCommand"]
    assert result["nativeControl"]["launchTick"] == 10


@pytest.mark.parametrize("control", [{"function": "shot", "launchTick": 41, "power": .5},
                                    {"function": "short_pass", "launchTick": True, "power": .5},
                                    {"function": "short_pass", "launchTick": 0, "power": float("nan")},
                                    {"function": "teleport", "launchTick": 0, "power": .5}])
def test_rejects_invalid_native_controls_before_any_engine_call(control):
    from timepitch.directed.grf_native_packets import lower_native_command
    with pytest.raises(ValueError):
        lower_native_command({"kind": "Pass", "physicalTick": 40, "recipientEngineId": "home:2"}, control)


def test_native_patch_hooks_initialization_commands_and_actual_contact_paths():
    manifest, files = _patch_outputs("native-1")
    assert manifest["executed"] is False
    source = files["src/directed_reconstruction.cpp"]
    assert "Director::Prepare" in source and "Director::Queue" in source and "Director::Step" in source
    assert "Director::RequestCommand" in source and "Director::ObserveContact" in source
    assert "forcedTargetPlayer" in source and "SetGoalCount" not in source
    assert "directed.RequestCommand" in files["src/onthepitch/player/controller/elizacontroller.cpp"]
    assert "directed.ObserveContact" in files["src/game_env.cpp"]
    assert "DirectedInitialise" in files["src/onthepitch/player/humanoid/humanoidbase.cpp"]
    assert "directed.AfterTick" in files["src/onthepitch/match.cpp"]
    assert 'OFF)' in files["CMakeLists.txt"]


@pytest.mark.parametrize("kind", ["position", "velocity", "phase", "ball"])
def test_lowering_rejects_changed_native_priors_instead_of_believing_both_copies(kind):
    from timepitch.directed.grf_native_packets import lower_native_initial
    packet = initial_packet()
    if kind in ("position", "velocity"): packet["nativePlayers"][0][kind]["value"]["x"] += 1
    if kind == "phase": packet["initialState"]["players"][0]["phase"]["value"] = "moving"
    if kind == "ball": packet["nativeBall"]["position"]["value"]["x"] += 1
    with pytest.raises(ValueError): lower_native_initial(packet)


def test_native_patch_prevents_restore_reset_and_compressed_step_after_prepare():
    _, files = _patch_outputs("native-1")
    source = files["src/game_env.cpp"]
    assert source.count('directed_state_mutation_forbidden') >= 4
    assert 'directed.Initialized()' in files["src/onthepitch/ball.cpp"]
    assert 'directed.Initialized()' in files["src/onthepitch/player/humanoid/humanoidbase.cpp"]


def test_rejects_fractional_physical_tick_in_native_control():
    from timepitch.directed.grf_native_packets import lower_native_command
    with pytest.raises(ValueError):
        lower_native_command({"kind": "Shot", "physicalTick": 40.5}, {"function": "shot", "launchTick": 0, "power": .5})


def test_rejects_boolean_energy_even_when_both_prior_copies_agree():
    from timepitch.directed.grf_native_packets import lower_native_initial
    packet = initial_packet()
    packet["initialState"]["players"][0]["energy"]["value"] = packet["nativePlayers"][0]["energy"]["value"] = True
    with pytest.raises(ValueError): lower_native_initial(packet)


def test_lowers_a_declared_moving_prior_without_turning_it_into_a_standing_reset():
    from timepitch.directed.grf_adapter import _world
    from timepitch.directed.grf_native_packets import lower_native_initial
    packet = initial_packet()
    source = packet["initialState"]["players"][0]
    source["velocity"]["value"] = {"x": 3, "y": 4, "z": 0}
    source["phase"]["value"] = "moving"
    packet["nativePlayers"][0] = copy.deepcopy(source)
    packet["nativePlayers"][0]["position"]["value"] = _world(source["position"]["value"])
    packet["nativePlayers"][0]["velocity"]["value"] = _world(source["velocity"]["value"], "velocity")
    before = copy.deepcopy(packet)
    lowered = lower_native_initial(packet)
    assert packet == before and lowered["nativePlayers"][0]["velocity"]["value"]["x"] != 0


def test_native_contact_without_an_aim_uses_the_observed_ball_not_a_zero_target():
    _, files = _patch_outputs("native-1")
    source = files["src/directed_reconstruction.cpp"]
    assert "c.hasTarget" in source and "nativeBallTarget" in source


def test_native_failure_callback_does_not_call_python_without_the_gil():
    _, files = _patch_outputs("native-1")
    source = files["src/directed_reconstruction.cpp"]
    helper = source.split("std::string Unsupported(", 1)[1].split("\n}\n", 1)[0]
    assert "Json(" not in helper and "bp::" not in helper


def test_legacy_python_wrappers_refuse_mutation_before_releasing_the_gil():
    _, files = _patch_outputs("native-1")
    source = files["ai.cpp"]
    for signature in ("void step_python() {", "void reset_python(ScenarioConfig& game_config, bool init_animation) {"):
        wrapper = source.split(signature, 1)[1].split("Py_UNBLOCK_THREADS", 1)[0]
        assert "directed.Locked()" in wrapper
