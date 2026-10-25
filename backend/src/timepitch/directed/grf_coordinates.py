"""Canonical/native geometry only; never GRF observations or engine state."""
from .wire import _number, _require

BASIS = "canonical-world-v1"
TRANSFORM = "grf-world-110x72-canonical-105x68-v1"


def _convert(point, orientation, inverse):
    _require(orientation == BASIS and isinstance(point, dict), "orientation_unverified")
    allowed = {"x", "y", "space", "kind", "z", "zUnit"}
    _require(set(point) <= allowed and {"x", "y", "space"} <= set(point), "coordinate_fields")
    kind = point.get("kind", "position")
    source = "canonical_metres" if inverse else "grf_world_metres"
    _require(point["space"] == source and kind in ("position", "velocity", "acceleration"), "coordinate_space")
    x, y = point["x"], point["y"]
    _require(_number(x) and _number(y), "coordinate_nonfinite")
    _require(("z" in point) == ("zUnit" in point), "height_unit")
    if "z" in point:
        _require(point["zUnit"] == "metres" and _number(point["z"]), "height_unit")
        _require(kind != "position" or point["z"] >= 0, "height_negative")
    if kind == "position":
        _require((0 <= x <= 105 and 0 <= y <= 68) if inverse else (-55 <= x <= 55 and -36 <= y <= 36), "coordinate_bounds")
        cx, cy = ((x * 110 / 105 - 55, 36 - y * 72 / 68) if inverse else ((x + 55) * 105 / 110, (36 - y) * 68 / 72))
    else:
        cx, cy = ((x * 110 / 105, -y * 72 / 68) if inverse else (x * 105 / 110, -y * 68 / 72))
    _require(_number(cx) and _number(cy), "coordinate_overflow")
    result = {"x": cx, "y": cy, "space": "grf_world_metres" if inverse else "canonical_metres"}
    if "kind" in point: result["kind"] = kind
    if "z" in point: result.update(z=point["z"], zUnit="metres")
    return result


def canonical_to_grf(point: dict, orientation: str) -> dict:
    return _convert(point, orientation, True)


def grf_to_canonical(point: dict, orientation: str) -> dict:
    return _convert(point, orientation, False)
