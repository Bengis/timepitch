import copy
import hashlib
import json
import pytest
from directed_grf_fixtures import profile_fixture
from timepitch.directed.grf_profile import check_grf_profile


def test_prepares_consistent_declarations_without_native_readiness():
    p, inventory = profile_fixture()
    before = copy.deepcopy((p, inventory))
    result = check_grf_profile(p, inventory)
    assert result["status"] == "prepared"
    assert result["executionMode"] == "disabled" and result["measured"] is False
    assert result["authority"] == "inventory_declarations_only"
    assert (p, inventory) == before


@pytest.mark.parametrize("kind", ["inventory_hash", "source_hash", "binding_policy", "artifact", "abi", "source_symbol", "revision", "orientation", "clock", "fake_subtick_flag", "equivalence", "enabled"])
def test_blocks_profile_mismatch_or_missing_native_evidence(kind):
    p, inventory = profile_fixture()
    if kind == "inventory_hash": p["sourceInventorySha256"] = "f" * 64
    if kind == "source_hash": inventory["observedSourceHashes"]["fixture.cpp"] = "f" * 64
    if kind == "binding_policy": p["sourceBindingPolicySha256"] = "f" * 64
    if kind == "artifact": inventory["artifactEvidence"]["sha256"] = "f" * 64
    if kind == "abi": inventory["artifactEvidence"]["symbols"].pop()
    if kind == "revision": p["engineRevision"] = "wrong"
    if kind == "equivalence": inventory["artifactEvidence"]["sourceEquivalent"] = False
    if kind == "enabled": p["executionMode"] = "enabled"
    if kind in ("source_symbol", "orientation", "clock", "fake_subtick_flag"):
        m = json.loads(inventory["payloadUtf8"])
        if kind == "source_symbol": m["implementedAbi"].pop()
        if kind == "orientation": m["coordinates"]["orientation"] = "unverified"
        if kind == "clock": m["clock"]["basis"] = "compressed_match_time"
        if kind == "fake_subtick_flag": m["clock"]["subTickContact"] = 0
        inventory["payloadUtf8"] = json.dumps(m, separators=(",", ":"))
        p["sourceInventorySha256"] = hashlib.sha256(inventory["payloadUtf8"].encode()).hexdigest()
        inventory["artifactEvidence"]["sourceInventorySha256"] = p["sourceInventorySha256"]
    assert check_grf_profile(p, inventory)["status"] == "unavailable"


def test_g2_modules_have_no_engine_loader_io_or_execution_dependency():
    import ast
    import inspect
    from timepitch.directed import grf_coordinates, grf_profile, grf_schedule
    for module in (grf_coordinates, grf_profile, grf_schedule):
        tree = ast.parse(inspect.getsource(module))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import): assert all(x.name in {"json", "hashlib"} for x in node.names)
            if isinstance(node, ast.ImportFrom):
                assert (node.level == 1 and node.module in {"wire", "grf_coordinates"}) or (node.level == 0 and node.module == "fractions")
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
                assert node.func.id not in {"open", "exec", "eval", "__import__"}
