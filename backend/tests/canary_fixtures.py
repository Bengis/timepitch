"""Synthetic predecessors; never copy or initialize the original real grant."""
from hashlib import sha256
from contextlib import closing
import json
from pathlib import Path
import sqlite3

from chronicle_fixtures import canonical


PARENT='pc-worker-20261019-1'


def make_authorization(root):
    from timepitch.chronicles.canary_budget import CanaryAuthorization,canary_directory,canary_implementation_binding,BINDING_FILES
    from timepitch.chronicles.models import PROFILE,fact_pack_hash,canonical_bytes
    from timepitch.chronicles.facts import from_timepitch
    from timepitch.simulation.replay import trace_hash
    root=Path(root)
    for name in BINDING_FILES:
        path=root/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(b'synthetic-code-only')
    parent=root/'.local/ai-worker-acceptance'/PARENT;parent.mkdir(parents=True)
    record=canonical();record.trace_hash=trace_hash(record)
    raw=record.model_dump_json().encode('utf-8');(parent/'timepitch-source.json').write_bytes(raw)
    pack=from_timepitch(record)
    manifest={'grant':PARENT,'profile':PROFILE,'sources':{'timepitch':{'file':'timepitch-source.json',
        'sha256':sha256(raw).hexdigest(),'trace_hash':pack.trace_hash,'fact_hash':fact_pack_hash(pack)}}}
    (parent/'manifest.json').write_text(json.dumps(manifest),encoding='utf-8')
    (parent/'usage.anchor.json').write_text(json.dumps({'nonce':'synthetic-ancestor','manifest':sha256((parent/'manifest.json').read_bytes()).hexdigest()}),encoding='utf-8')
    with closing(sqlite3.connect(parent/'usage.sqlite')) as conn,conn:
        conn.executescript('CREATE TABLE metadata(nonce TEXT,manifest TEXT,halted INTEGER); CREATE TABLE slots(name TEXT,state TEXT,charged INTEGER,reserved INTEGER,responses INTEGER);')
        conn.execute('INSERT INTO metadata VALUES(?,?,1)',('synthetic-ancestor',sha256((parent/'manifest.json').read_bytes()).hexdigest()))
        conn.execute("INSERT INTO slots VALUES('preflight','failed',3,4,3)")
    (parent/'report.json').write_text('{"status":"failed"}',encoding='utf-8')
    quarantine=root/'.local/inference-uncertain.json';quarantine.write_text('{"synthetic":"uncertain"}',encoding='utf-8')
    hashes={name:sha256((parent/name).read_bytes()).hexdigest() for name in ('manifest.json','usage.anchor.json','usage.sqlite','report.json')}
    hashes['quarantine']=sha256(quarantine.read_bytes()).hexdigest()
    a=CanaryAuthorization(approval_ref='a'*64,workspace_root=str(root.resolve()),predecessor_hashes=hashes,source_sha256=sha256(raw).hexdigest(),
        trace_hash=pack.trace_hash,fact_hash=fact_pack_hash(pack),implementation=canary_implementation_binding(root))
    directory=canary_directory(root);directory.mkdir(parents=True)
    (directory/'authorization.json').write_bytes(canonical_bytes(a))
    return a,pack


def ancestor_bytes(root):
    base=Path(root)/'.local/ai-worker-acceptance'/PARENT
    return {p.name:p.read_bytes() for p in base.iterdir() if p.is_file()}


class FakeNative:
    def __init__(self):self.present=False;self.complete=True;self.boot='b'*64;self.calls=0;self.offset_ns=0
    def inspect_absence(self):
        from timepitch.chronicles.canary_recovery import NativeAbsenceEvidence,now_ns
        self.calls+=1
        return NativeAbsenceEvidence(boot_id=self.boot,observed_ns=now_ns()-self.offset_ns,
            processes_absent=not self.present,inventory_complete=self.complete,snapshot_digest='c'*64)


class FakeRuntime(FakeNative):
    def __init__(self,fail=False):super().__init__();self.started=False;self.restored=False;self.fail=fail
    def start_and_load(self,timeout_s=120):
        assert timeout_s==120;self.started=True
        if self.fail:raise RuntimeError('synthetic-partial-startup')
        return self.owned_changes()
    def owned_changes(self):
        from timepitch.chronicles.canary import OwnedRuntimeChanges
        return OwnedRuntimeChanges(runtime_started=self.started,model_intent=self.started,pid=123 if self.started else None)
    def restore(self,changes):
        assert changes.runtime_started==self.started;self.restored=True
