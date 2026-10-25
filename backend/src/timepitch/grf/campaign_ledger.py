"""Single append-only M1 ledger engine; authorization is supplied by fixed wrappers."""
import hashlib
import os
from pathlib import Path
from .continuity_profile import RUN_ROOT,sha,read
from .physical_wire import canonical,digest
from .m1_verifier import ALL_IDS as IDS


def digest_bytes(data):return hashlib.sha256(data).hexdigest()


def global_lock(project):
    from .continuity_budget import global_lock as shared_lock
    return shared_lock(project)


def payload_key(run_id):
    from .continuity_budget import payload_key as shared_key
    return shared_key(run_id)


def _exclusive(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('xb') as f: f.write(canonical(value)); f.flush(); os.fsync(f.fileno())


def _replace(path, value):
    temporary = path.with_name(path.name+'.pending')
    _exclusive(temporary, value); os.replace(temporary, path)


class CampaignLedger:
    """An existing, witnessed ledger is mandatory. No method initializes a grant."""
    def __init__(self, project, profile, authorization_verifier):
        self._authorization_verifier = authorization_verifier
        self.project = Path(project).resolve(); self.root = self.project/RUN_ROOT; self.profile = profile
        self.authorization = self._authorization_verifier(self.project, profile)
        with self.locked(): self._load()

    def locked(self): return global_lock(self.project)

    def _require_lock(self):
        from .continuity_budget import _held
        if not getattr(_held, 'counts', {}).get(str(self.project), 0): raise ValueError('Global campaign lock required')

    def _load(self):
        self._require_lock()
        if self._authorization_verifier(self.project, self.profile) != self.authorization: raise ValueError('Authorization changed')
        try:
            state = read(self.root/'checkpoint.json'); journal = self.root/'events.jsonl'
            if journal.stat().st_size > 2*1024*1024: raise ValueError('M1 journal bound')
            raw = journal.read_bytes()
            receipt = dict(grant_sha256=self.authorization.grant_sha256, checkpoint_sha256=digest(state), events_sha256=digest_bytes(raw))
            if read(self.root/'registration.json') != receipt or read(self.root/'initialized.json') != receipt:
                raise ValueError('Missing/changed M1 checkpoint witness; no reinitialization')
            if set(state) != {'schema_version', 'grant_sha256', 'runs', 'terminal_failure', 'observe_proof', 'calibration_report', 'selection', 'heldout_opened'}:
                raise ValueError('M1 checkpoint schema')
            if state['schema_version'] != 'm1-ledger-1' or state['grant_sha256'] != self.authorization.grant_sha256 or not set(state['runs']) <= set(IDS) or len(state['runs']) > 35:
                raise ValueError('M1 checkpoint identity/bounds')
            prefix = b''
            if not raw: raise ValueError('Original linked initialization event required')
            from .shot_context_wire import _json
            for seq, line in enumerate(raw.splitlines(keepends=True)):
                event = _json(line)
                if event['seq'] != seq or event['previous'] != digest_bytes(prefix): raise ValueError('M1 append-only journal changed')
                prefix += line
            if event['checkpoint'] != digest(state): raise ValueError('M1 journal head differs from checkpoint')
            for id, entry in state['runs'].items():
                if (entry['state'] not in ('reserved', 'ready', 'failed') or entry['profile_identity'] != self.profile.identity or
                    entry['payload_sha256'] != digest(self.profile.payload(payload_key(id)))):
                    raise ValueError('Consumed run identity changed')
                if entry['state'] != 'reserved': self._row(id, entry)
            return state
        except (OSError, KeyError, TypeError, AttributeError) as e: raise ValueError('Missing/invalid M1 ledger; no reset') from e

    def _save(self, state, event):
        self._require_lock(); journal = self.root/'events.jsonl'; before = journal.read_bytes()
        record = dict(seq=len(before.splitlines()), previous=digest_bytes(before), checkpoint=digest(state), event=event)
        data = canonical(record)+b'\n'
        if len(before)+len(data) > 2*1024*1024: raise ValueError('M1 journal bound')
        with journal.open('ab') as f: f.write(data); f.flush(); os.fsync(f.fileno())
        _replace(self.root/'checkpoint.json', state)
        receipt = dict(grant_sha256=self.authorization.grant_sha256, checkpoint_sha256=digest(state), events_sha256=digest_bytes(before+data))
        for name in ('registration.json', 'initialized.json'): _replace(self.root/name, receipt)

    def usage(self):
        with self.locked(): state = self._load()
        return dict(used=41+len(state['runs']), maximum=76, candidates=6 if state['runs'] else 5, candidate_limit=6)

    def _row(self, id, entry):
        path = self.root/'evidence'/id/'measurement.json'
        if sha(path) != entry['result_sha256']: raise ValueError('Consumed evidence changed')
        value = read(path)
        if value['run_id'] != id or value['profile_identity'] != self.profile.identity or value['payload_sha256'] != entry['payload_sha256']:
            raise ValueError('Evidence identity changed')
        return value

    def assert_stage(self, stage):
        state = self._load()
        if stage not in ('observe', 'calibration', 'heldout'): raise ValueError('Fixed M1 research stages only')
        if state['terminal_failure'] is not None: raise ValueError('Study stopped: first technical/equivalence failure')
        if stage != 'observe' and state['observe_proof'] is None: raise ValueError('Accepted exact passive C4 equivalence required')
        if stage == 'observe' and any(id != 'M-observe-42' for id in state['runs']): raise ValueError('Observation cannot reopen after calibration')
        if stage == 'calibration' and (state['selection'] is not None or state['heldout_opened']): raise ValueError('Calibration permanently closed after selection')
        if stage == 'heldout' and (state['calibration_report'] is None or state['calibration_report']['qualified'] is not True):
            raise ValueError('Complete qualified eight-match calibration required')
        return state

    def reserve(self, id, payload):
        self._require_lock(); key = payload_key(id); stage = 'observe' if id == 'M-observe-42' else id.split('/')[1]
        state = self.assert_stage(stage)
        if digest(payload) != digest(self.profile.payload(key)): raise ValueError('Full original fixed payload required')
        if id in state['runs']:
            entry = state['runs'][id]
            if entry['state'] != 'ready': raise ValueError('Consumed reserved/failed ID cannot retry')
            return dict(reused=True, row=self._row(id, entry))
        if state['runs'] and id == 'M-observe-42': raise ValueError('One passive control only')
        if stage in ('calibration', 'heldout'):
            index = int(id.rsplit('/', 1)[1])
            if any(state['runs'].get(f'm1/{stage}/{i:02}', {}).get('state') != 'ready' for i in range(1, index)):
                raise ValueError('Fixed original order; no skipped/failed predecessor')
        if stage == 'heldout':
            self.verify_selection(state); state['heldout_opened'] = True
        if 41+len(state['runs']) >= self.authorization.maximum: raise ValueError('Cumulative 76-attempt ceiling exhausted')
        state['runs'][id] = dict(state='reserved', profile_identity=self.profile.identity, payload_sha256=digest(payload), result_sha256=None)
        self._save(state, dict(type='reserve', id=id, candidates=6)); return dict(reused=False, row=None)

    def finish(self, id, row, *, failed=False):
        self._require_lock(); state = self._load(); entry = state['runs'].get(id)
        if entry is None or entry['state'] != 'reserved': raise ValueError('Existing consumed reservation required')
        value = dict(row, run_id=id, profile_identity=self.profile.identity, payload_sha256=entry['payload_sha256'], native_sha256=self.profile.native_sha256)
        path = self.root/'evidence'/id/'measurement.json'; _exclusive(path, value)
        entry.update(state='failed' if failed else 'ready', result_sha256=sha(path))
        if failed: state['terminal_failure'] = dict(id=id, state='failed')
        self._save(state, dict(type='finish', id=id, failed=failed)); return value

    def accept_observation(self, proof):
        state = self._load()
        entry = state['runs'].get('M-observe-42', {})
        if (entry.get('state') != 'ready' or proof.get('complete') is not True or proof.get('equivalent') is not True or
            type(proof.get('exact_transactions')) is not int or proof['exact_transactions'] <= 0 or proof != self._row('M-observe-42', entry)):
            raise ValueError('Complete exact passive observation required')
        state['observe_proof'] = proof; self._save(state, dict(type='observe_accepted'))

    def stop(self, reason):
        state = self._load(); state['terminal_failure'] = dict(reason=str(reason)[:2000]); self._save(state, dict(type='stopped'))

    def record_calibration(self, report):
        from .continuity_campaign import evaluate_continuity_gates
        state = self._load()
        rows = [self._row(id, state['runs'][id]) for id in [f'm1/calibration/{i:02}' for i in range(1, 9)]]
        gates = evaluate_continuity_gates(rows, expected=8)
        if report['rows'] != rows or report['gates'] != gates or report['qualified'] != all(gates.values()): raise ValueError('Complete immutable calibration report required')
        if state['calibration_report'] is not None and state['calibration_report'] != report: raise ValueError('Calibration already frozen')
        state['calibration_report'] = report; self._save(state, dict(type='calibration_report'))

    def seal_selection(self):
        state = self.assert_stage('heldout')
        value = dict(profile_identity=self.profile.identity, calibration_report_sha256=digest(state['calibration_report']),
            payload_sha256={f'heldout/{i:02}': digest(self.profile.payload(f'heldout/{i:02}')) for i in range(1, 25)})
        if state['selection'] is not None: self.verify_selection(state); return
        paths = self._selection_paths()
        if any(p.exists() for p in paths): raise ValueError('Partial selection witness; never renew')
        state['selection'] = value; self._save(state, dict(type='selection_sealed'))
        for p in paths: _exclusive(p, value)

    def _selection_paths(self): return [self.root/'selection/freeze.json', self.root/'selection-registration.json', self.root/'selection-initialized.json']

    def verify_selection(self, state):
        expected = dict(profile_identity=self.profile.identity, calibration_report_sha256=digest(state['calibration_report']),
            payload_sha256={f'heldout/{i:02}': digest(self.profile.payload(f'heldout/{i:02}')) for i in range(1, 25)})
        if state['selection'] != expected or any(read(p) != expected for p in self._selection_paths()):
            raise ValueError('Missing/changed sealed selection; never reopen calibration or heldout')
