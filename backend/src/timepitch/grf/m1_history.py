"""Immutable TP058 source archive; live successors never renew old identities."""
from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path

from .physical_wire import canonical, digest

STUDY = 'research/engine-evaluation/2026-10-18-grf-clock-m1-worker'
ARCHIVE = '.local/grf-m1-worker-tp058-source-archive'
ARCHIVE_WITNESS = ARCHIVE+'-initialized.json'
BINDING = STUDY+'/tp058-source-binding.json'
DESCRIPTOR = 'research/engine-evaluation/2026-10-18-grf-priority-continuity/continuity.json'
PROFILE_WITNESS = '.local/grf-priority-continuity-profile-initialized.json'


def artifact(root, name):
    root = Path(root).resolve()
    if type(name) is not str or Path(name).is_absolute() or '..' in Path(name).parts:
        raise ValueError('Archive path outside project')
    path = (root/name).resolve()
    if not path.is_relative_to(root): raise ValueError('Archive path escaped project')
    return path


def sha(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda: f.read(1024*1024), b''): h.update(block)
    return h.hexdigest()


def _read(path):
    def unique(pairs):
        value = {}
        for k, v in pairs:
            if k in value: raise ValueError('Duplicate archive JSON field')
            value[k] = v
        return value
    with Path(path).open('rb') as f: raw = f.read(8*1024*1024+1)
    if len(raw) > 8*1024*1024: raise ValueError('Archive metadata size limit')
    return json.loads(raw, object_pairs_hook=unique,
                      parse_constant=lambda x: (_ for _ in ()).throw(ValueError('Nonfinite archive metadata')))


def _binding(root, doc):
    if doc.get('schema_version') != 'm1-continuity-profile-1': raise ValueError('Original TP058 profile required')
    expected = dict(schema_version='m1-profile-initialized-1', profile_identity=digest(doc),
                    descriptor_sha256=sha(artifact(root, DESCRIPTOR)))
    if _read(artifact(root, PROFILE_WITNESS)) != expected: raise ValueError('Original TP058 witness changed')
    return dict(schema_version='m1-tp058-source-archive-1', parent_profile=digest(doc),
        descriptor=DESCRIPTOR, witness=PROFILE_WITNESS, descriptor_sha256=expected['descriptor_sha256'],
        witness_sha256=sha(artifact(root, PROFILE_WITNESS)), source_sha256=doc['measurement_sha256'],
        artifact_maps_sha256={g: digest(doc[g]) for g in ('static_files','runtime_files')},
        parent_files_sha256=digest(doc['parent']['files']))


def _exclusive(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('xb') as f: f.write(data); f.flush(); os.fsync(f.fileno())


def _protected(root, doc):
    for group in ('static_files','runtime_files'):
        for name, h in doc[group].items():
            if sha(artifact(root,name)) != h: raise ValueError('TP058 artifact changed: '+name)
    for name, h in doc['parent']['files'].items():
        if sha(artifact(root,name)) != h: raise ValueError('TP058 parent changed: '+name)


@dataclass(frozen=True)
class ArchiveReceipt:
    profile_identity: str
    binding_sha256: str
    source_count: int
    live_modified: tuple[str,...]
    live_added: tuple[str,...]
    live_missing: tuple[str,...]


def archive_tp058(project):
    root = Path(project).resolve(); archive = artifact(root, ARCHIVE)
    if any(p.exists() for p in (archive,artifact(root,ARCHIVE_WITNESS),artifact(root,BINDING))):
        raise ValueError('TP058 archive already attempted; never renew')
    try:
        doc = _read(artifact(root,DESCRIPTOR)); binding = _binding(root,doc)
        for name,h in doc['measurement_sha256'].items():
            if sha(artifact(root,name)) != h: raise ValueError('Live TP058 source changed before archive')
        backend = {p.relative_to(root).as_posix() for p in (root/'backend/src/timepitch').rglob('*.py')}
        expected = {n for n in doc['measurement_sha256'] if n.startswith('backend/src/timepitch/') and n.endswith('.py')}
        if backend != expected: raise ValueError('Live TP058 membership changed before archive')
        _protected(root,doc)
        archive.mkdir(parents=True,exist_ok=False)
        for name in doc['measurement_sha256']:
            _exclusive(artifact(archive/'source',name),artifact(root,name).read_bytes())
        for name in (DESCRIPTOR,PROFILE_WITNESS):
            _exclusive(artifact(archive/'metadata',name),artifact(root,name).read_bytes())
        for p in (archive/'binding.json',artifact(root,ARCHIVE_WITNESS),artifact(root,BINDING)):
            _exclusive(p,canonical(binding)+b'\n')
        return verify_tp058_archive(root)
    except (OSError,KeyError,TypeError) as e: raise ValueError('Cannot initialize TP058 archive') from e


def verify_tp058_archive(project):
    root = Path(project).resolve(); archive = artifact(root,ARCHIVE)
    try:
        doc = _read(artifact(root,DESCRIPTOR)); binding = _binding(root,doc)
        copies = (archive/'binding.json',artifact(root,ARCHIVE_WITNESS),artifact(root,BINDING))
        if any(_read(p) != binding for p in copies): raise ValueError('TP058 archive binding/witness changed')
        expected = doc['measurement_sha256']
        actual = {p.relative_to(archive/'source').as_posix() for p in (archive/'source').rglob('*') if p.is_file()}
        if actual != set(expected): raise ValueError('TP058 archived membership changed')
        metadata = {p.relative_to(archive/'metadata').as_posix() for p in (archive/'metadata').rglob('*') if p.is_file()}
        if metadata != {DESCRIPTOR,PROFILE_WITNESS}: raise ValueError('TP058 metadata membership changed')
        for name in metadata:
            if artifact(archive/'metadata',name).read_bytes() != artifact(root,name).read_bytes():
                raise ValueError('TP058 archived metadata changed')
        for name,h in expected.items():
            if sha(artifact(archive/'source',name)) != h: raise ValueError('TP058 archived bytes changed')
        _protected(root,doc)
        live = {p.relative_to(root).as_posix():sha(p) for p in (root/'backend/src/timepitch').rglob('*.py')}
        for name in expected:
            if not name.startswith('backend/src/timepitch/') or not name.endswith('.py'):
                p = artifact(root,name)
                if p.is_file(): live[name] = sha(p)
        return ArchiveReceipt(binding['parent_profile'],sha(artifact(root,BINDING)),len(expected),
            tuple(sorted(n for n in set(live)&set(expected) if live[n] != expected[n])),
            tuple(sorted(set(live)-set(expected))),tuple(sorted(set(expected)-set(live))))
    except (OSError,KeyError,TypeError,json.JSONDecodeError) as e: raise ValueError('Invalid TP058 archive') from e
