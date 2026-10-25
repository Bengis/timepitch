"""Recorded replays (`.json.gz`, outside git) served as plain bytes under /replays (TP201).

The tracked index stores the SHA-256 of the *served* gzip bytes, so the response must never carry
`Content-Encoding` (the browser would inflate it and the size/hash check would fail). Only
`*.json.gz` files are exposed; anything else in the folder (SHA256SUMS, notes) answers 404.
"""
import re

from starlette.exceptions import HTTPException
from starlette.staticfiles import StaticFiles

SAFE = re.compile(r'^[\w./-]+\.json\.gz$')


class ReplayFiles(StaticFiles):
    async def get_response(self, path, scope):
        # Starlette hands over an OS-normalised path (backslashes on Windows).
        rel = path.replace('\\', '/')
        if not SAFE.match(rel) or '..' in rel.split('/'):
            raise HTTPException(404)
        response = await super().get_response(path, scope)
        # mimetypes maps `.json.gz` to application/json + gzip encoding; keep them opaque bytes.
        response.headers['content-type'] = 'application/octet-stream'
        if 'content-encoding' in response.headers:
            del response.headers['content-encoding']
        response.headers['cache-control'] = 'no-cache'
        return response
