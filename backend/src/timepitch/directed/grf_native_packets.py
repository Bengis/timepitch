"""Pure lowering of explicit native priors/controls. Never creates a native port."""
from .grf_adapter import _copy, _world
from .wire import _require, _number, _same


def lower_native_initial(packet: dict) -> dict:
    p = _copy(packet)
    initial = p["initialState"]
    _require(_number(p["seed"]) and p["seed"] == int(p["seed"]) and 0 <= p["seed"] < 2**32, "native_seed")
    _require(initial["phase"]["value"] == "open_play" and initial["ball"]["ownerId"]["value"] is None, "native_initial_phase_owner")
    _require(initial["caches"]["value"] == {"revision": "grf-directed-cold-start-1", "values": {}}, "native_initial_cache")
    _require(len(initial["players"]) == len(p["nativePlayers"]), "native_initial_roster")
    for source, native in zip(initial["players"], p["nativePlayers"]):
        expected = _copy(source)
        expected["position"]["value"] = _world(source["position"]["value"])
        expected["velocity"]["value"] = _world(source["velocity"]["value"], "velocity")
        _require(_same(expected, native), "native_initial_prior_binding")
        _require(source["memory"]["value"] == {} and source["position"]["provenance"] == "inferred", "native_initial_memory_root")
        _require(source["phase"]["value"] in ("standing", "moving"), "native_player_phase")
        _require(native["position"]["value"]["z"] == 0 and native["velocity"]["value"]["z"] == 0, "native_ground_root")
        _require(_number(source["energy"]["value"]) and 0.01 <= source["energy"]["value"] <= 1, "native_energy")
        speed_squared = sum(v*v for v in source["velocity"]["value"].values())
        _require((source["phase"]["value"] == "standing") == (speed_squared == 0) and speed_squared <= 81, "native_phase_velocity")
    expected_ball = _copy(initial["ball"])
    expected_ball["position"]["value"] = _world(initial["ball"]["position"]["value"])
    expected_ball["velocity"]["value"] = _world(initial["ball"]["velocity"]["value"], "velocity")
    _require(_same(expected_ball, p["nativeBall"]), "native_initial_ball_binding")
    p["nativeOptions"] = {"version": "grf-directed-native-options-1", "initialStatePolicy": "grf-directed-cold-start-1"}
    return p


def lower_native_command(command: dict, control: dict) -> dict:
    c, n = _copy(command), _copy(control)
    _require(set(n) == {"function", "launchTick", "power"}, "native_control_fields")
    functions = {"Pass": ("short_pass", "long_pass", "high_pass"), "Shot": ("shot",),
                 "Ball Receipt*": ("trap",), "Ball Recovery": ("trap",), "Block": ("interfere",),
                 "Interception": ("interfere",), "Goal Keeper": ("deflect",), "Duel": ("interfere",)}
    _require(n["function"] in functions.get(c["kind"], ()), "native_control_function")
    _require(_number(n["launchTick"]) and n["launchTick"] == int(n["launchTick"]) and
             _number(c["physicalTick"]) and c["physicalTick"] == int(c["physicalTick"]) and
             0 <= n["launchTick"] <= c["physicalTick"] <= 10000, "native_control_time")
    _require(_number(n["power"]) and 0 <= n["power"] <= 1, "native_control_power")
    if c["kind"] == "Pass": _require(isinstance(c["recipientEngineId"], str), "explicit_receiver_required")
    c["nativeControl"] = n
    return c
