"""One bounded Responses request; construction performs no I/O or capability probe."""
import asyncio
from contextvars import ContextVar
from hashlib import sha256
import json
import logging
import os
import re
import stat
import time

import httpx2
from openai import AsyncOpenAI, APIStatusError, APIConnectionError

from ..models import FactPack, canonical_bytes, fact_pack_hash
from .models import AzureBinding, AzureReceipt, ChronicleDraft, PreparedAzureRequest, SendPermit, binding_hash
from .validation import prose_instructions

MAX_RESPONSE_BYTES = 262144
_quiet = ContextVar('azure_private_transport', default=False)


class _PrivateLogFilter(logging.Filter):
    def filter(self, record): return not _quiet.get()


def _protect_logs():
    # Logger filters run before handlers, including DEBUG handlers installed by an operator.
    for name in ('openai._base_client','openai._response','openai._legacy_response','httpx2',
                 'httpcore.connection','httpcore.http11','httpcore.http2','httpcore.proxy'):
        logger=logging.getLogger(name)
        if not any(isinstance(f,_PrivateLogFilter) for f in logger.filters):logger.addFilter(_PrivateLogFilter())


def prepare_request(pack: FactPack, locale, binding: AzureBinding) -> PreparedAzureRequest:
    pack=FactPack.model_validate_json(canonical_bytes(pack))
    binding=AzureBinding.model_validate_json(canonical_bytes(binding))
    body={'model':binding.deployment,'instructions':prose_instructions(locale),
        'input':[{'role':'user','content':canonical_bytes(pack).decode()}],
        'text':{'format':{'type':'json_schema','name':'chronicle_prose','strict':True,
                         'schema':ChronicleDraft.model_json_schema()}},
        'max_output_tokens':2048,'store':False,'stream':False,'background':False,'truncation':'disabled'}
    raw=json.dumps(body,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode()
    return PreparedAzureRequest(body=body,request_hash=sha256(raw).hexdigest(),binding_hash=binding_hash(binding),
        fact_hash=fact_pack_hash(pack),input_upper_tokens=binding.input_token_ceiling)


class _BoundedStream(httpx2.AsyncByteStream):
    def __init__(self,inner):self.inner=inner
    async def __aiter__(self):
        size=0
        async for chunk in self.inner:
            size+=len(chunk)
            if size>MAX_RESPONSE_BYTES:raise ValueError('Response exceeds transport bound')
            yield chunk
    async def aclose(self):await self.inner.aclose()


class _BoundedTransport(httpx2.AsyncBaseTransport):
    def __init__(self):self.inner=httpx2.AsyncHTTPTransport(retries=0,trust_env=False)
    async def handle_async_request(self,request):
        if len(request.content)>131072:raise ValueError('Encoded request exceeds transport bound')
        response=await self.inner.handle_async_request(request)
        if response.is_stream_consumed and len(response.content)>MAX_RESPONSE_BYTES:
            await response.aclose();raise ValueError('Response exceeds transport bound')
        if response.headers.get('content-encoding','identity').lower()!='identity':
            await response.aclose();raise ValueError('Encoded response is unavailable')
        response.stream=_BoundedStream(response.stream)
        return response
    async def aclose(self):await self.inner.aclose()


def _identifier(value):
    return value if isinstance(value,str) and re.fullmatch(r'[A-Za-z0-9_.:/-]{1,180}',value) else None


def _count(value):
    return value if type(value) is int and 0<=value<=100_000_000 else None


class AzureProvider:
    deadline_s=60
    def __init__(self,settings,*,client_factory=None):
        self.settings=settings;self._factory=client_factory or AsyncOpenAI
        self._client=None;self._closed=False;self._busy=False

    def _connect(self):
        if self._client is not None:return self._client
        path=self.settings.credential_file
        if self.settings.mode=='off' or self.settings.binding is None or path is None:
            raise ValueError('Provider configuration unavailable')
        if path.is_symlink() or not stat.S_ISREG(path.stat().st_mode):raise ValueError('Credential must be a private file')
        if os.name!='nt' and path.stat().st_mode&0o077:raise ValueError('Credential permissions are not private')
        with path.open('rb') as stream:raw=stream.read(4097)
        if len(raw)>4096:raise ValueError('Credential exceeds bound')
        key=raw.decode('ascii').strip()
        if not key or any(ord(c)<33 or ord(c)>126 for c in key):raise ValueError('Credential unavailable')
        http=httpx2.AsyncClient(transport=_BoundedTransport(),trust_env=False,follow_redirects=False,
            timeout=60,headers={'Accept-Encoding':'identity'})
        self._client=self._factory(api_key=key,base_url=self.settings.binding.endpoint,max_retries=0,
            timeout=60,http_client=http)
        return self._client

    def _validated(self,prepared):
        value=PreparedAzureRequest.model_validate_json(canonical_bytes(prepared))
        if self.settings.binding is None or value.binding_hash!=binding_hash(self.settings.binding):
            raise ValueError('Prepared binding differs')
        try:pack=FactPack.model_validate_json(value.body['input'][0]['content'])
        except (ValueError,KeyError,IndexError,TypeError):raise ValueError('Invalid prepared facts') from None
        if not any(value==prepare_request(pack,locale,self.settings.binding) for locale in ('en','es')):
            raise ValueError('Prepared request differs from contract')
        return value

    async def generate(self,prepared,authorize_send):
        if self._closed or self._busy:raise ValueError('Provider is closed or busy')
        prepared=self._validated(prepared)
        self._busy=True;token=_quiet.set(True);_protect_logs()
        try:
            client=self._connect()
            # This durable callback is the last application step before the sole SDK dispatch.
            permit=SendPermit.model_validate_json(canonical_bytes(authorize_send(prepared)))
            if permit.request_hash!=prepared.request_hash:raise ValueError('Permit differs from request')
            started=time.monotonic()
            data={};request_id=None;error=None;draft=None
            try:
                async with asyncio.timeout(self.deadline_s):
                    async with client.responses.with_streaming_response.create(**prepared.body) as response:
                        request_id=_identifier(response.headers.get('x-request-id'))
                        chunks=[];size=0
                        async for chunk in response.iter_bytes():
                            size+=len(chunk)
                            if size>MAX_RESPONSE_BYTES:raise ValueError('Response exceeds transport bound')
                            chunks.append(chunk)
                        parsed=json.loads(b''.join(chunks))
                        if not isinstance(parsed,dict):raise ValueError('Response must be an object')
                        data=parsed
                output=data.get('output',[])
                if data.get('model')!=self.settings.binding.expected_model:error='model_mismatch'
                elif data.get('status')!='completed':error='invalid_result'
                elif (not isinstance(output,list) or len(output)!=1 or output[0].get('type')!='message'
                      or output[0].get('status')!='completed' or output[0].get('role')!='assistant'):
                    error='invalid_result'
                else:
                    content=output[0].get('content',[])
                    if len(content)!=1 or content[0].get('type')!='output_text':error='invalid_result'
                    else:draft=ChronicleDraft.model_validate_json(content[0]['text'])
            except (TimeoutError,asyncio.CancelledError,httpx2.TransportError,APIConnectionError):error='uncertain_send'
            except APIStatusError as exc:
                request_id=_identifier(exc.request_id);error='provider_error'
            except Exception:error='invalid_result'
            usage=data.get('usage') or {}
            if not isinstance(usage,dict):usage={}
            details=usage.get('output_tokens_details') or {}
            if not isinstance(details,dict):details={}
            return AzureReceipt(attempt_id=permit.attempt_id,request_hash=permit.request_hash,
                model=_identifier(data.get('model')),provider_request_id=request_id,draft=draft if error is None else None,
                error=error,elapsed_ms=min(100_000_000,int((time.monotonic()-started)*1000)),
                input_tokens=_count(usage.get('input_tokens')),output_tokens=_count(usage.get('output_tokens')),
                reasoning_tokens=_count(details.get('reasoning_tokens')))
        finally:self._busy=False;_quiet.reset(token)

    async def close(self):
        self._closed=True
        if self._client is not None:await self._client.close()
