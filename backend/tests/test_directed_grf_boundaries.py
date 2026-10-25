import ast
import importlib
import inspect
import sys
import pytest


def test_imports_only_protocol_and_pure_helpers_without_native_loader():
    before = set(sys.modules)
    modules = [importlib.import_module("timepitch.directed." + name) for name in ("grf_port", "grf_adapter")]
    assert not any(name.startswith(("gfootball", "_gameplayfootball")) for name in set(sys.modules) - before)
    for module in modules:
        tree = ast.parse(inspect.getsource(module))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import): assert all(x.name in {"json", "re"} for x in node.names)
            if isinstance(node, ast.ImportFrom):
                assert (node.level == 1 and node.module in {"wire", "grf_port", "grf_profile", "grf_coordinates", "grf_schedule"}) or (node.level == 0 and node.module == "typing")
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name): assert node.func.id not in {"open", "eval", "exec", "__import__"}


def test_port_is_an_interface_without_default_native_factory():
    from timepitch.directed.grf_port import GrfDirectedPort
    assert set(GrfDirectedPort.__annotations__) == set()
    assert all(callable(getattr(GrfDirectedPort, name)) for name in ("capabilities", "prepare", "queue", "step", "export", "close"))
    with pytest.raises(TypeError): GrfDirectedPort()


def _patch_outputs(revision="guard-1"):
    """Apply checked context hunks in memory only; never run git/CMake/native code."""
    import hashlib
    import json
    import re
    from pathlib import Path
    root = Path(__file__).resolve().parents[2]
    folder = root / "backend/native/directed-grf/patches" / revision
    manifest = json.loads((folder / "manifest.json").read_bytes())
    patch = (folder / manifest.get("patchFile", "0001-disabled-directed-abi.patch")).read_bytes()
    assert hashlib.sha256(patch).hexdigest() == manifest["patchSha256"]
    lines = patch.decode("utf-8").splitlines(keepends=True)
    native = root / ".local/grf-native/source/gfootball-2.10.2/third_party/gfootball_engine"
    outputs, i = {}, 0
    while i < len(lines):
        assert lines[i].startswith("--- ") and lines[i+1].startswith("+++ b/")
        old_name, name = lines[i][4:].strip(), lines[i+1][6:].strip()
        assert not Path(name).is_absolute() and ".." not in Path(name).parts
        record = manifest["files"][name]
        old = b"" if old_name == "/dev/null" else (native / name).read_bytes()
        assert (None if not old else hashlib.sha256(old).hexdigest()) == record["baseSha256"]
        original = old.decode().splitlines(keepends=True)
        output, cursor = [], 0
        i += 2
        while i < len(lines) and lines[i].startswith("@@"):
            match = re.match(r"@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@", lines[i])
            assert match
            start, consumed, produced = int(match[1]), 0, 0
            target = max(0, start - 1)
            assert cursor <= target <= len(original)
            output.extend(original[cursor:target]);cursor = target;i += 1
            while i < len(lines) and not lines[i].startswith(("@@", "--- ")):
                prefix, text = lines[i][0], lines[i][1:]
                assert prefix in " +-"
                if prefix in " -": assert cursor < len(original) and original[cursor] == text;cursor += 1;consumed += 1
                if prefix in " +": output.append(text);produced += 1
                i += 1
            assert consumed == int(match[2] or 1) and produced == int(match[4] or 1)
        output.extend(original[cursor:])
        value = "".join(output).encode()
        assert hashlib.sha256(value).hexdigest() == record["outputSha256"]
        outputs[name] = value.decode()
    assert set(outputs) == set(manifest["files"])
    return manifest, outputs


def test_native_patch_applies_in_memory_to_pinned_texts_and_keeps_build_opt_in():
    manifest, files = _patch_outputs()
    assert set(files) == {"ai.cpp", "CMakeLists.txt", "src/directed_reconstruction.hpp", "src/directed_reconstruction.cpp"}
    assert manifest["compiled"] is False and manifest["executionControls"] == []
    assert 'option(TIMEPITCH_DIRECTED_RECONSTRUCTION "Build disabled directed ABI guard" OFF)' in files["CMakeLists.txt"]
    assert 'if(TIMEPITCH_DIRECTED_RECONSTRUCTION)' in files["CMakeLists.txt"]
    assert '#ifdef TIMEPITCH_DIRECTED_RECONSTRUCTION' in files["ai.cpp"]
    for name in ("directed_capabilities_v1", "directed_prepare_v1", "directed_queue_v1", "directed_step_v1", "directed_export_v1"):
        assert name in files["ai.cpp"]


def test_native_guard_has_no_state_mutator_step_ai_override_or_fabricated_evidence():
    _, files = _patch_outputs()
    code = files["src/directed_reconstruction.cpp"]
    assert '"native_disabled"' in code and '"executionMode":"disabled"' in code
    assert '"controls":[]' in code and '"measured":false' in code
    assert '"samples":null' in code and '"contacts":null' in code
    assert 'prepare_attempted_' in code and 'prepare_already_attempted' in code
    for forbidden in ("ContextHolder", "GetMatch", "SetPosition", "SetScore", "Ball()->Touch", "RequestCommand", "std::rand", "GetGame", "get_state", "set_state", "probe_test", "core.step"):
        assert forbidden not in code
