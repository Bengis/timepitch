"""G2 literals derived only from the controlled G1 fixture, never saved-play data."""
import copy
import hashlib
import json
from pathlib import Path

ABI = ["directed_capabilities_v1", "directed_prepare_v1", "directed_queue_v1", "directed_step_v1", "directed_export_v1"]


def profile_fixture():
    profile = json.loads((Path(__file__).parent / "fixtures" / "directed-job-1.json").read_bytes())["profile"]
    profile["artifactSha256"] = "d" * 64
    profile["transformId"] = "grf-world-110x72-canonical-105x68-v1"
    manifest = {"version": "directed-grf-source-profile-1", "engineRevision": profile["engineRevision"], "sourceBindingPolicySha256": profile["sourceBindingPolicySha256"],
                "sourceFiles": {"fixture.cpp": "c" * 64},
                "coordinates": {"transformId": profile["transformId"], "orientation": "canonical-world-v1", "nativeHalfLengthM": 55, "nativeHalfWidthM": 36, "canonicalLengthM": 105, "canonicalWidthM": 68, "heightUnit": "metres"},
                "clock": {"basis": "native_physical_ticks", "tickMs": 10, "subTickContact": False},
                "requiredAbi": ABI[:], "implementedAbi": ABI[:], "referenceArtifacts": []}
    raw = json.dumps(manifest, separators=(",", ":"))
    digest = hashlib.sha256(raw.encode()).hexdigest()
    profile["sourceInventorySha256"] = digest
    inventory = {"payloadUtf8": raw, "observedSourceHashes": copy.deepcopy(manifest["sourceFiles"]),
                 "artifactEvidence": {"sha256": profile["artifactSha256"], "sourceInventorySha256": digest, "sourceEquivalent": True, "symbols": ABI[:]}}
    return profile, inventory


def job_fixture(aligned=False):
    job = json.loads((Path(__file__).parent / "fixtures" / "directed-job-1.json").read_bytes())
    if aligned:
        r = job["request"]
        r["clip"]["toMs"] = r["clip"]["fromMs"] + 300
        r["events"][2]["elapsedMs"] = r["events"][2]["periodMs"] = r["clip"]["toMs"]
        for a in r["evidence"]["actions"]: a["elapsedMs"] = r["events"][2]["elapsedMs"]
        for s in r["evidence"]["snapshots"]: s["elapsedMs"] = s["periodMs"] = r["events"][2]["elapsedMs"]
        rebind(job)
    return job


def rebind(job):
    r = job["request"]
    r["events"].sort(key=lambda e: (e["elapsedMs"], e["sourceIndex"]))
    r["sourceKey"] = json.dumps([r["sourceIdentity"], r["motionRevision"], r["sourceDigest"], r["clip"]], ensure_ascii=False, separators=(",", ":"))
    r["evidence"]["sourceKey"] = r["sourceKey"]
    job["requestPayloadUtf8"] = json.dumps({k: v for k, v in r.items() if k != "requestDigest"}, ensure_ascii=False, separators=(",", ":"))
    r["requestDigest"] = hashlib.sha256(job["requestPayloadUtf8"].encode()).hexdigest()
    actions = {a["eventId"]: a for a in r["evidence"]["actions"]}
    aliases = {a["eventId"]: a for a in r["aliases"]}
    job["schedule"] = copy.deepcopy([{"event": e, "evidence": actions.get(e["id"]), "alias": aliases.get(e["id"])} for e in sorted(r["events"], key=lambda e: (e["elapsedMs"], e["sourceIndex"]))])
