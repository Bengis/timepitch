"""Bounded, explicit offline download of the approved immutable snapshot."""
import hashlib
import json
from pathlib import Path
import tempfile
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from .models import PINNED_SNAPSHOT, SourceFile, SourceManifest

MAX_SOURCE_BYTES = 16*1024**2
DOCUMENTS = ('README.md', 'LICENSE.pdf', 'doc/Open Data Events v4.0.0.pdf',
             'doc/Open Data Lineups v2.0.0.pdf', 'doc/Open Data Matches v3.0.0.pdf')


def canonical(value) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode('utf-8')


def digest(path: Path) -> str:
    result = hashlib.sha256()
    with path.open('rb') as stream:
        while block := stream.read(1024*1024):
            result.update(block)
    return result.hexdigest()


def contained(root: Path, relative: str) -> Path:
    path = root/relative
    if not path.resolve().is_relative_to(root.resolve()):
        raise ValueError('Source path escapes selected root')
    return path


def read_json(path: Path):
    if path.stat().st_size > MAX_SOURCE_BYTES:
        raise ValueError('Source too large')
    def nonfinite(_):
        raise ValueError('Nonfinite JSON number')
    return json.loads(path.read_text(encoding='utf-8'), parse_constant=nonfinite)


def atomic_write(path: Path, body: bytes):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False, suffix='.part') as stream:
        temp = Path(stream.name)
        stream.write(body)
    try:
        temp.replace(path)
    finally:
        temp.unlink(missing_ok=True)


def download_snapshot(output_root: Path, snapshot: str, *, match_ids=None) -> SourceManifest:
    if snapshot != PINNED_SNAPSHOT:
        raise ValueError('Unapproved snapshot')
    output_root = Path(output_root)
    output_root.mkdir(parents=True, exist_ok=True)
    manifest_path = output_root/'source-manifest.json'
    previous = SourceManifest.model_validate(read_json(manifest_path)) if manifest_path.exists() else None
    entries = {entry.path: entry for entry in previous.files} if previous else {}
    errors = []

    def save(requested):
        manifest = SourceManifest(snapshot=snapshot, files=sorted(entries.values(), key=lambda f:f.path),
                                  requested_matches=sorted(requested), errors=errors)
        atomic_write(manifest_path, canonical(manifest.model_dump(mode='json')))
        return manifest

    def fetch(relative, *, required=False):
        # Validate before constructing a local path or URL.
        SourceFile(path=relative, status='missing')
        target = contained(output_root, relative)
        old = entries.get(relative)
        if old and old.status == 'ok' and target.is_file():
            if target.stat().st_size != old.size or digest(target) != old.sha256:
                raise ValueError('Previously downloaded source changed')
            return True
        try:
            request = Request(f'https://raw.githubusercontent.com/hudl/open-data/{snapshot}/{quote(relative)}',
                              headers={'User-Agent':'TimePitch-historical-research'})
            with urlopen(request, timeout=30) as response:
                if response.status != 200 or response.geturl() != request.full_url:
                    raise ValueError('Unexpected source response')
                body = response.read(MAX_SOURCE_BYTES+1)
            if len(body) > MAX_SOURCE_BYTES:
                raise ValueError('Source too large')
            if target.exists():
                if target.read_bytes() != body:
                    raise ValueError('Unverified existing source differs')
            else:
                atomic_write(target, body)
            entries[relative] = SourceFile(path=relative, size=len(body), sha256=hashlib.sha256(body).hexdigest(), status='ok')
            return True
        except HTTPError as error:
            reason = 'http_'+str(error.code)
            status = 'missing' if error.code == 404 else 'error'
        except (URLError, TimeoutError, OSError):
            reason, status = 'request_failed', 'error'
        # Integrity/size/path errors are not recoverable downloads and propagate.
        entries[relative] = SourceFile(path=relative, status=status, reason=reason)
        errors.append(relative+':'+reason)
        if required:
            save(set())
            raise ValueError('Required source unavailable')
        return False

    for relative in DOCUMENTS:
        fetch(relative, required=True)
    available = set()
    for season in (27, 44):
        relative = f'data/matches/2/{season}.json'
        fetch(relative, required=True)
        calendar = read_json(contained(output_root, relative))
        for match in calendar:
            identifier = match['match_id']
            if type(identifier) is not int or identifier <= 0:
                raise ValueError('Invalid fixture identity')
            available.add(identifier)
    requested = available if match_ids is None else set(match_ids)
    if not requested.issubset(available):
        raise ValueError('Requested fixture is outside approved calendars')
    retained = requested | (set(previous.requested_matches) if previous else set())
    for index, identifier in enumerate(sorted(requested), 1):
        for kind in ('lineups', 'events'):
            fetch(f'data/{kind}/{identifier}.json')
        save(retained)
        if index % 20 == 0 or index == len(requested):
            print(f'StatsBomb source {index}/{len(requested)}; source errors {len(errors)}', flush=True)
    return save(retained)
