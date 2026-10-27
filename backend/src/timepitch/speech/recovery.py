"""Single-parent recovery; no original ledger is opened for writing or recreated."""
from hashlib import sha256
import json
from pathlib import Path
import sqlite3

from .ledger import SpeechLedger, SpeechRefused
from .provider import require, validate_inputs


def _local(path: Path, root: Path) -> Path:
    require(path.is_absolute() and path.is_relative_to(root / '.local'), 'recovery_path')
    for node in [path, *path.parents]:
        require(not node.is_symlink() and not node.is_junction(), 'recovery_linked_path')
        if node == root:
            break
    require(path.exists(), 'recovery_evidence_missing')
    return path


def _readonly(path: Path, root: Path):
    _local(path, root)
    # Closed evidence must be checkpointed. Never hide pending WAL via immutable=1.
    for suffix in ('-wal', '-journal'):
        sidecar = Path(str(path) + suffix)
        require(not sidecar.exists() or sidecar.stat().st_size == 0, 'recovery_uncheckpointed')
    connection = sqlite3.connect(path.as_uri() + '?mode=ro&immutable=1', uri=True)
    try:
        require(connection.execute('PRAGMA quick_check').fetchone()[0] == 'ok', 'recovery_database_invalid')
    except Exception:
        connection.close()
        raise
    return connection


def read_parent_state(plan: dict, authorization: dict, root: Path) -> dict:
    try:
        return _read_parent_state(plan, authorization, root.resolve())
    except SpeechRefused:
        raise
    except (OSError, sqlite3.Error, ValueError, KeyError, TypeError):
        raise SpeechRefused('recovery_evidence_invalid') from None


def _read_parent_state(plan: dict, auth: dict, root: Path) -> dict:
    lineage = plan['lineage']
    binding = lineage['parent_proposal_sha256']
    require(auth.get('recovery_parent_sha256') == binding, 'recovery_parent_binding')
    db = _readonly(root / '.local/speech-canary-grants.sqlite3', root)
    try:
        row = db.execute('SELECT grant_id,binding,output FROM grants WHERE binding=?', (binding,)).fetchone()
    finally:
        db.close()
    require(row is not None and row[0] == lineage['parent_grant_id'], 'recovery_parent_claim')
    output = _local(Path(row[2]), root)
    proposal_path = _local(root / '.local/speech-tp286/canary-proposal.json', root)
    manifest_path = _local(root / '.local/speech-tp283/verified.json', root)
    auth_path = _local(output / 'authorization.json', root)
    result_path = _local(output / 'result.json', root)
    ledger_path = _local(output / 'speech-ledger.sqlite3', root)
    parent_raw, manifest_raw = proposal_path.read_bytes(), manifest_path.read_bytes()
    parent_auth_raw, result_raw = auth_path.read_bytes(), result_path.read_bytes()
    parent_auth = json.loads(parent_auth_raw)
    require(sha256(parent_raw).hexdigest() == binding, 'recovery_parent_proposal')
    require(sha256(result_raw).hexdigest() == lineage['parent_result_sha256'], 'recovery_parent_result')
    parent_plan = validate_inputs(parent_raw, parent_auth, manifest_raw)
    require(parent_auth['id'] == row[0] and Path(parent_auth['output_root']) == output, 'recovery_parent_authorization')
    require(parent_plan['subscription_id'] == plan['subscription_id'], 'recovery_subscription')
    before = sha256(ledger_path.read_bytes()).hexdigest()
    db = _readonly(ledger_path, root)
    try:
        run = db.execute('SELECT grant_id,binding,status FROM run WHERE id=1').fetchone()
        attempts = db.execute('SELECT bytes,sent FROM attempts').fetchall()
    finally:
        db.close()
    require(run == (row[0], binding, 'stopped'), 'recovery_parent_not_stopped')
    require(all(isinstance(size, int) and size > 0 and sent in (0, 1) for size, sent in attempts), 'recovery_attempt_invalid')
    require(before == sha256(ledger_path.read_bytes()).hexdigest(), 'recovery_parent_changed')
    require(not Path(str(ledger_path) + '-wal').exists() or Path(str(ledger_path) + '-wal').stat().st_size == 0, 'recovery_uncheckpointed')
    count, sent, size = len(attempts), sum(a[1] for a in attempts), sum(a[0] for a in attempts)
    result = json.loads(result_raw)
    require(result['status'] == 'stopped' and result['usage'] == {'reservations': count, 'sent': sent, 'reserved_ssml_bytes': size}, 'recovery_result_mismatch')
    usage = {'requests': max(count, sent), 'reservations': count, 'ssml_utf8_bytes': size, 'speech_cost_eur': 0}
    require(usage == plan['cumulative_budget']['observed_prior'] == auth.get('expected_parent_usage'), 'recovery_usage_changed')
    require(plan['cumulative_budget']['ceiling'] == {'requests': 4, 'reservations': 4, 'ssml_utf8_bytes': 4000, 'speech_cost_eur': 0}, 'recovery_ceiling')
    payload = sum(i['ssml_utf8_bytes'] for i in plan['items'])
    require(payload == auth.get('exact_payload_bytes'), 'recovery_payload_bytes')
    require(usage['requests'] + len(plan['items']) <= 4 and usage['reservations'] + len(plan['items']) <= 4
            and usage['ssml_utf8_bytes'] + payload <= 4000, 'recovery_budget_exhausted')
    return {'binding': binding, 'grant_id': row[0], 'registry_parent': list(row), 'usage': usage, 'reported_sent': sent,
            'evidence': {'proposal': binding, 'manifest': sha256(manifest_raw).hexdigest(), 'authorization': sha256(parent_auth_raw).hexdigest(),
                         'result': sha256(result_raw).hexdigest(), 'ledger': before}}


class RecoveryLedger(SpeechLedger):
    def __init__(self, path: Path, parent: dict, verify_parent):
        self.parent = parent
        self.verify_parent = verify_parent
        super().__init__(path)

    def reserve(self, item: int, digest: str, size: int):
        require(self.verify_parent() == self.parent, 'recovery_parent_changed')
        self._reserve(item, digest, size, self.parent['usage'])

    def cumulative_summary(self):
        child = super().cumulative_summary()
        for key in ('requests', 'reservations', 'ssml_utf8_bytes'):
            child[key] += self.parent['usage'][key]
        child['synthesis_sent'] += self.parent['reported_sent']
        return child
