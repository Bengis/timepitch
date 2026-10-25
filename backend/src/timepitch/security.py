"""A loopback application still rejects foreign hosts and controls its HTTP surface."""
from fastapi import FastAPI, Request
from fastapi import Response
from fastapi.responses import JSONResponse, RedirectResponse
import hashlib
import hmac
import re
import secrets
import os
import shutil
import threading
from collections import OrderedDict
from math import ceil
from time import monotonic
from urllib.parse import urlsplit
from pathlib import Path
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware

MAX_PUBLIC_RUNTIME_BYTES=512*1024**2


def public_origin(value=None):
    value=(os.getenv('TIMEPITCH_PUBLIC_ORIGIN','') if value is None else value).strip()
    if not value:return ''
    url=urlsplit(value)
    if (url.scheme!='https' or not url.hostname or url.netloc!=url.hostname or
        url.path not in ('','/') or url.query or url.fragment or
        not re.fullmatch(r'[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?',url.hostname) or
        any(not part or len(part)>63 or part.startswith('-') or part.endswith('-') for part in url.hostname.split('.'))):
        raise ValueError('TIMEPITCH_PUBLIC_ORIGIN must be a canonical HTTPS origin')
    return 'https://'+url.hostname


def public_storage_available(runtime):
    try:
        if shutil.disk_usage(runtime).free<1024**3:return False
        total=0
        for path in runtime.glob('*.sqlite*'):
            try:total+=path.stat().st_size
            except FileNotFoundError:continue  # SQLite may remove/checkpoint a WAL concurrently.
        return total<MAX_PUBLIC_RUNTIME_BYTES
    except OSError:
        return False


class PublicWriteLimiter:
    """One-process demo budgets: 6/IP/minute, 30 globally, bounded client map."""
    def __init__(self, per_client=6):
        self.clients=OrderedDict();self.window=0.;self.total=0;self.lock=threading.Lock()
        self.per_client=per_client

    def admit(self,client):
        now=monotonic()
        with self.lock:
            while self.clients and next(iter(self.clients.values()))[0]<=now:
                self.clients.popitem(last=False)
            if now>=self.window:self.window=now+60;self.total=0
            if self.total>=30:return max(1,ceil(self.window-now))
            entry=self.clients.get(client)
            if entry is None:
                if len(self.clients)>=1024:
                    return max(1,ceil(next(iter(self.clients.values()))[0]-now))
                entry=[now+60,0];self.clients[client]=entry
            if entry[1]>=self.per_client:return max(1,ceil(entry[0]-now))
            entry[1]+=1;self.total+=1
            return 0


def install_security(app: FastAPI, runtime_dir: Path | None = None, worker_auth=None, public_origin_override=None):
    origin=public_origin(public_origin_override);hostname=urlsplit(origin).hostname if origin else None
    if origin and runtime_dir is None:raise ValueError('Public demo requires an explicit runtime directory')
    # Vite default (5173) and the timepitch-web-dev launch port (5178, TP216); its proxy rewrites Host, not Origin.
    development=['http://127.0.0.1:5173', 'http://localhost:5173', 'http://127.0.0.1:5178', 'http://localhost:5178']
    origins=[origin] if origin else development
    limiter=PublicWriteLimiter()
    worker_limiter=PublicWriteLimiter(per_client=30)
    from .chronicles.auth import WORKER_PATHS
    app.add_middleware(CORSMiddleware, allow_origins=origins,
                       allow_credentials=False, allow_methods=['GET', 'POST', 'OPTIONS'], allow_headers=['Content-Type'])
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=['127.0.0.1', 'localhost', '[::1]']+([hostname] if hostname else []))
    app.add_middleware(BodyLimitMiddleware)

    @app.middleware('http')
    async def headers(request: Request, call_next):
        allowed = {origin} if origin else {str(request.base_url).rstrip('/'), *development}
        if origin and request.url.hostname==hostname and request.url.scheme!='https':
            response=RedirectResponse(origin+request.url.path+('?' + request.url.query if request.url.query else ''),status_code=308)
        elif request.method=='POST' and request.url.path in WORKER_PATHS:
            if worker_auth is None or not worker_auth.authenticates(request.headers.get('authorization')):
                response=JSONResponse({'detail':'Worker authentication required'},status_code=401)
            else:
                # One authenticated identity, independent of visitor IP and quotas.
                retry=worker_limiter.admit('registered-worker')
                if retry:
                    response=JSONResponse({'detail':'Worker request limit'},status_code=429,headers={'Retry-After':str(retry)})
                else: response=await call_next(request)
        elif request.method == 'POST' and request.headers.get('origin') not in allowed:
            response = JSONResponse({'detail': 'Origin not allowed'}, status_code=403)
        elif origin and request.method=='POST':
            retry=limiter.admit(request.client.host if request.client else 'unknown')
            if retry:
                response=JSONResponse({'detail':'Too many requests. Try again shortly.'},status_code=429,
                                      headers={'Retry-After':str(retry)})
            elif not public_storage_available(runtime_dir):
                response=JSONResponse({'detail':'The demo is temporarily at capacity'},status_code=503)
            else:response=await call_next(request)
        else:
            response = await call_next(request)
        for key, value in {
            'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
            'Referrer-Policy': 'no-referrer',
            'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
        }.items():
            response.headers.setdefault(key, value)
        if request.url.scheme == 'https':
            response.headers.setdefault('Strict-Transport-Security', 'max-age=31536000')
        if request.url.path.startswith('/api/'):
            response.headers['Cache-Control']='no-store'
        return response


def load_session_key(path: Path) -> bytes:
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with path.open('xb') as stream:
            stream.write(secrets.token_bytes(32))
    except FileExistsError:
        pass
    value = path.read_bytes()
    if len(value) != 32: raise RuntimeError('Invalid local session key')
    return value


def owner_session(request: Request, response: Response) -> str:
    cookie = request.cookies.get('timepitch_session', '')
    key = request.app.state.session_key
    if re.fullmatch(r'[a-f0-9]{32}\.[a-f0-9]{64}', cookie):
        owner, signature = cookie.split('.')
        expected = hmac.new(key, owner.encode(), hashlib.sha256).hexdigest()
        if hmac.compare_digest(signature, expected): return owner
    owner = secrets.token_hex(16)
    signature = hmac.new(key, owner.encode(), hashlib.sha256).hexdigest()
    response.set_cookie('timepitch_session', owner + '.' + signature, httponly=True,
                        secure=request.url.scheme == 'https', samesite='strict', max_age=604800)
    return owner


class BodyLimitMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http' or scope['method'] != 'POST':
            return await self.app(scope, receive, send)
        limit = 16 * 1024 * 1024 if scope['path'] == '/api/replays/import' else 32 * 1024
        if scope['path']=='/api/ai-worker/result': limit=16*1024
        elif scope['path'] in ('/api/ai-worker/claim','/api/ai-worker/heartbeat'): limit=4096
        chunks, size = [], 0
        while True:
            message = await receive()
            if message['type'] == 'http.disconnect': return
            body = message.get('body', b'')
            size += len(body)
            if size > limit:
                return await JSONResponse({'detail': 'Request body too large'}, status_code=413)(scope, receive, send)
            chunks.append(body)
            if not message.get('more_body', False): break
        sent = False
        async def replay():
            nonlocal sent
            if not sent:
                sent = True
                return {'type': 'http.request', 'body': b''.join(chunks), 'more_body': False}
            return await receive()
        await self.app(scope, replay, send)
