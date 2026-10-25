"""Declared port responses for host tests; no physics or saved-play reader."""
import copy
from directed_grf_fixtures import job_fixture, profile_fixture


def adapter_fixture():
    job = job_fixture(aligned=True)
    profile, inventory = profile_fixture()
    job["profile"] = profile
    actors = [{"playerKey": p["playerKey"], "engineId": p["engineId"]} for p in job["initialState"]["players"]]
    ids = {p["playerKey"]: p["engineId"] for p in actors}
    caps = {"version": "grf-directed-port-1", "mode": "controlled_double", "executionMode": "disabled",
            "profile": copy.deepcopy(profile), "inventory": inventory, "actors": actors,
            "controls": ["initial_state", "pass", "receipt", "shot", "header", "keeper", "block", "recovery", "interception", "duel"],
            "bodyParts": [None, "left_foot", "right_foot", "head"], "maxStepTicks": 10}
    raw = {"version": "grf-directed-raw-1", "profile": copy.deepcopy(profile), "actors": copy.deepcopy(actors),
           "clock": {"ticks": 30, "physicalMs": 300, "discontinuities": []},
           "events": [{"eventId": e["id"], "sourceMs": e["elapsedMs"], "kind": e["kind"],
                       "actorEngineId": ids[e["actorId"]], "recipientEngineId": ids.get(e["recipientId"]),
                       "outcome": e["outcome"], "bodyPart": e["bodyPart"]} for e in job["request"]["events"]],
           "contacts": [], "samples": [], "unavailableChannels": ["body_intervals", "pose"]}
    return job, LiteralPort(caps, raw)


class LiteralPort:
    """Only returns literals and records host calls, never simulates a match."""
    def __init__(self, caps, raw):
        self.caps, self.raw, self.calls = caps, raw, []
        self.raise_at = None
        self.reject_at = None
        self.mutate = False

    def _call(self, name, arg=None):
        self.calls.append((name, copy.deepcopy(arg)))
        if name == self.raise_at: raise RuntimeError("literal injected failure")
        if self.mutate and isinstance(arg, dict): arg.clear()
        if name == self.reject_at: return {"status": "unsupported", "reason": "literal_control_unavailable"}
        return {"status": "ok"}

    def capabilities(self):
        self._call("capabilities")
        return self.caps

    def prepare(self, initial): return self._call("prepare", initial)
    def queue(self, command): return self._call("queue", command)

    def step(self, ticks):
        assert type(ticks) is int and ticks > 0, "action fixture fallback forbidden"
        return self._call("step", ticks)

    def export(self):
        self._call("export")
        return self.raw

    def close(self): self._call("close")
    def reset(self, *_): raise AssertionError("reset forbidden")
    def seek(self, *_): raise AssertionError("seek forbidden")

    @property
    def core(self): raise AssertionError("core/action fixture fallback forbidden")
