import copy
import pytest
from timepitch.directed.grf_coordinates import canonical_to_grf, grf_to_canonical

BASIS = "canonical-world-v1"


@pytest.mark.parametrize("native,canonical", [((-55, 36), (0, 0)), ((55, -36), (105, 68)), ((0, 0), (52.5, 34)), ((55, 36), (105, 0))])
def test_physical_corners_and_centre(native, canonical):
    result = grf_to_canonical({"x": native[0], "y": native[1], "space": "grf_world_metres"}, BASIS)
    assert (result["x"], result["y"]) == pytest.approx(canonical)
    assert "z" not in result
    back = canonical_to_grf(result, BASIS)
    assert (back["x"], back["y"]) == pytest.approx(native)


@pytest.mark.parametrize("kind", ["velocity", "acceleration"])
def test_derivatives_have_no_translation_and_keep_signed_height(kind):
    value = {"x": -11, "y": 7.2, "z": -2, "zUnit": "metres", "space": "grf_world_metres", "kind": kind}
    before = copy.deepcopy(value)
    result = grf_to_canonical(value, BASIS)
    assert (result["x"], result["y"], result["z"]) == pytest.approx((-10.5, -6.8, -2))
    assert canonical_to_grf(result, BASIS) == pytest.approx(value)
    assert value == before


@pytest.mark.parametrize("kind", ["orientation", "observation", "units", "nonfinite", "height", "field", "extra"])
def test_rejects_unknown_basis_or_undeclared_units(kind):
    value = {"x": 0, "y": 0, "space": "grf_world_metres"}
    basis = BASIS
    if kind == "orientation": basis = "home"
    if kind == "observation": value.update(x=1, y=.42, space="grf_observation")
    if kind == "units": value.update(z=1.3, zUnit="unverified")
    if kind == "nonfinite": value["x"] = float("nan")
    if kind == "height": value.update(z=-1, zUnit="metres")
    if kind == "field": value["x"] = 56
    if kind == "extra": value["scale"] = 54.4
    with pytest.raises(ValueError): grf_to_canonical(value, basis)
