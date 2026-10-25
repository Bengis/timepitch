"""Pure pinned profile preflight; no native import or file loader."""
import hashlib
import json
from .grf_coordinates import BASIS, TRANSFORM
from .wire import _hash, _keys, _parse, _profile, _require, _same, _text

REQUIRED_ABI = ("directed_capabilities_v1", "directed_prepare_v1", "directed_queue_v1", "directed_step_v1", "directed_export_v1")


def check_grf_profile(profile: dict, inventory: dict) -> dict:
    """Compare supplied declarations. Prepared never means authenticated or executable."""
    issues = []
    def gap(code, refs=()): issues.append({"code": code, "refs": list(refs)})
    try:
        owned = _parse(json.dumps({"profile": profile, "inventory": inventory}, ensure_ascii=False))
        p, inv = owned["profile"], owned["inventory"]
        _keys(inv, "payloadUtf8 observedSourceHashes artifactEvidence", "inventory_fields")
        _require(isinstance(inv["payloadUtf8"], str), "inventory_utf8")
        raw = inv["payloadUtf8"].encode("utf-8")
        manifest = _parse(raw.decode("utf-8"))
        _keys(manifest, "version engineRevision sourceBindingPolicySha256 sourceFiles coordinates clock requiredAbi implementedAbi referenceArtifacts", "source_profile_fields")
        _require(manifest["version"] == "directed-grf-source-profile-1", "source_profile_version")
        _profile(p, {"backend": "grf", "backendRevision": manifest["engineRevision"]})
        digest = hashlib.sha256(raw).hexdigest()
        if p["sourceInventorySha256"] != digest: gap("inventory_hash_mismatch")
        _require(_hash(manifest["sourceBindingPolicySha256"]), "binding_policy_hash")
        if p["sourceBindingPolicySha256"] != manifest["sourceBindingPolicySha256"]: gap("source_binding_policy_mismatch")
        sources = manifest["sourceFiles"]
        _require(isinstance(sources, dict) and bool(sources) and all(_text(k) and _hash(v) for k, v in sources.items()), "source_hashes")
        if inv["observedSourceHashes"] != sources: gap("source_hash_mismatch")
        expected = {"transformId": TRANSFORM, "orientation": BASIS, "nativeHalfLengthM": 55, "nativeHalfWidthM": 36,
                    "canonicalLengthM": 105, "canonicalWidthM": 68, "heightUnit": "metres"}
        if not _same(manifest["coordinates"], expected) or p["transformId"] != TRANSFORM: gap("orientation_or_transform_unverified")
        if not _same(manifest["clock"], {"basis": "native_physical_ticks", "tickMs": 10, "subTickContact": False}) or not _same(p["clock"], {"kind": "fixed_10ms", "maxStepMs": 10}):
            gap("physical_clock_unverified")
        _require(isinstance(manifest["requiredAbi"], list) and set(manifest["requiredAbi"]) == set(REQUIRED_ABI) and len(manifest["requiredAbi"]) == len(REQUIRED_ABI), "required_abi")
        _require(isinstance(manifest["implementedAbi"], list) and all(_text(x) for x in manifest["implementedAbi"]), "source_abi")
        for name in REQUIRED_ABI:
            if name not in manifest["implementedAbi"]: gap("source_symbol_missing", [name])
        artifact = inv["artifactEvidence"]
        if artifact is None or p["artifactSha256"] is None: gap("artifact_evidence_unavailable")
        else:
            _keys(artifact, "sha256 sourceInventorySha256 sourceEquivalent symbols", "artifact_evidence")
            if artifact["sha256"] != p["artifactSha256"] or artifact["sourceInventorySha256"] != digest: gap("artifact_binding_mismatch")
            if artifact["sourceEquivalent"] is not True: gap("source_artifact_equivalence_unverified")
            _require(isinstance(artifact["symbols"], list) and all(_text(x) for x in artifact["symbols"]), "artifact_symbols")
            for name in REQUIRED_ABI:
                if name not in artifact["symbols"]: gap("artifact_symbol_missing", [name])
        issues.extend(p["unsupported"])
    except (ValueError, KeyError, TypeError, IndexError, UnicodeError, OverflowError, RecursionError) as exc:
        gap(str(exc) if isinstance(exc, ValueError) else "invalid_grf_profile")
    return {"status": "unavailable" if issues else "prepared", "issues": issues, "executionMode": "disabled", "measured": False, "authority": "inventory_declarations_only"}
