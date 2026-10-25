"""Read-only folders of the built web (`web/dist`) that Vite copies from `web/public` (TP207).

`/data` holds the public player cards (`data/players/<club>-<season>.json`, TP198) and `/licenses` the third-party
licence texts linked from Credits. Only the expected file type is exposed: anything else, directories (no listing)
and traversal answer 404. File names are not content-hashed, so the browser revalidates (`no-cache` + ETag).
"""
import re

from starlette.exceptions import HTTPException
from starlette.staticfiles import StaticFiles


class WebDistFiles(StaticFiles):
    def __init__(self, *, directory, suffix: str, media_type: str):
        super().__init__(directory=directory)
        self.safe = re.compile(r'^[\w./-]+' + re.escape(suffix) + '$')
        self.media_type = media_type

    async def get_response(self, path, scope):
        # Starlette hands over an OS-normalised path (backslashes on Windows).
        rel = path.replace('\\', '/')
        if not self.safe.match(rel) or '..' in rel.split('/'):
            raise HTTPException(404)
        response = await super().get_response(path, scope)
        response.headers['content-type'] = self.media_type
        response.headers['cache-control'] = 'no-cache'
        return response
