"""Local failure contracts; all Agent/HTTP work is fabricated, no live runtime."""
import asyncio
import json

import pytest
from pydantic import ValidationError

from chronicle_fixtures import pack
from test_chronicle_provider import provider
from timepitch.agents.provider import LocalModelTimeout, ModelOutputError


def test_unknown_error_never_serializes_exception_content_or_invents_metrics():
    from timepitch.chronicles.diagnostics import safe_diagnostic
    class HostileError(RuntimeError):
        def __str__(self): raise AssertionError('Do not read arbitrary exception messages')
    error=HostileError('secret-player-path')
    error.diagnostic={'stage':'secret-player-path'}
    diagnostic=safe_diagnostic(error)
    assert diagnostic.stage=='unknown' and diagnostic.reason=='unclassified_failure'
    assert diagnostic.http_admitted is None and diagnostic.response_headers_received is None
    assert diagnostic.evidence_reads is None and diagnostic.response_chars is None
    assert 'secret-player-path' not in diagnostic.model_dump_json()


def test_snapshot_is_strict_immutable_bounded_and_accepts_only_schema_identifiers():
    from timepitch.chronicles.diagnostics import ProviderDiagnostic
    d=ProviderDiagnostic(stage='analysis',reason='schema_invalid',http_admitted=3,
        response_headers_received=3,evidence_reads=1,elapsed_ms=12.0,
        schema_rule='enum',schema_path=('properties','fact_ids','items','enum'))
    assert len(d.model_dump_json().encode())<=8192
    with pytest.raises(ValidationError): d.reason='json_invalid'
    for update in ({'http_admitted':5},{'http_admitted':3.0},{'elapsed_ms':float('nan')},
                   {'elapsed_ms':float('inf')},{'response_headers_received':4},
                   {'schema_rule':'secret-value'},{'schema_path':('properties','secret-value')},
                   {'schema_path':('items',)*33},{'response_chars':-1},{'arbitrary':'secret-value'}):
        with pytest.raises(ValidationError): ProviderDiagnostic.model_validate({**d.model_dump(),**update})


def test_safe_helper_revalidates_attached_snapshot_and_keeps_error_printable_generic():
    from timepitch.chronicles.diagnostics import ChronicleProviderError,ProviderDiagnostic,safe_diagnostic
    d=ProviderDiagnostic(stage='analysis',reason='json_invalid')
    error=ChronicleProviderError(d)
    assert isinstance(error,ModelOutputError) and safe_diagnostic(error)==d
    poisoned=d.model_copy(update={'reason':'credential-sentinel'})
    error.diagnostic=poisoned
    assert safe_diagnostic(error).reason=='unclassified_failure'
    assert 'credential-sentinel' not in str(error)


def scripted_output(text,stage='Analyst'):
    p,t,agents=provider(); original=p.agent_factory
    def factory(**kwargs):
        agent=original(**kwargs)
        class Scripted:
            async def run(self,payload,options=None):
                response=await agent.run(payload,options=options)
                if kwargs['name'].endswith(stage): response.text=text
                return response
        return Scripted()
    p.agent_factory=factory
    return p,t


@pytest.mark.parametrize('text,reason',[
    ('{broken','json_invalid'),('[]','json_object_required'),
    ('{"type":"object","secret-player-path":"credential-sentinel"}','schema_invalid'),
    ('{"fact_ids":["coverage"]}','analysis_result_missing'),
    ('{"fact_ids":["result","result"]}','analysis_duplicate_facts'),
    ('{"fact_ids":["result"]}','analysis_insufficient_observations'),
])
def test_analyst_rejections_keep_distinct_reasons_counts_and_no_model_content(text,reason):
    from timepitch.chronicles.diagnostics import ChronicleProviderError,safe_diagnostic
    async def run():
        p,t=scripted_output(text); admissions=[]
        try:
            with pytest.raises(ChronicleProviderError) as caught: await p.generate(pack(),'en',admissions.append)
            d=safe_diagnostic(caught.value)
            assert d.stage=='analysis' and d.reason==reason
            assert d.http_admitted==d.response_headers_received==t.calls==len(admissions)==3
            assert d.evidence_reads==1 and d.response_chars==len(text)
            assert d.finish_reason is None and d.elapsed_ms>=0
            assert all(s not in d.model_dump_json()+str(caught.value) for s in ('credential-sentinel','secret-player-path'))
            if reason=='schema_invalid': assert d.schema_rule=='additionalProperties' and d.schema_path==('additionalProperties',)
            if reason=='json_invalid': assert d.json_line==1 and d.json_column==2
        finally: await p.close()
    asyncio.run(run())


@pytest.mark.parametrize('change,reason,calls,reads',[
    ('missing_tool','evidence_missing',2,0),('double_tool','evidence_repeated',1,1),
])
def test_tool_failures_record_observed_reads_without_an_extra_generation(change,reason,calls,reads):
    from timepitch.chronicles.diagnostics import ChronicleProviderError,safe_diagnostic
    async def run():
        p,t,_=provider(change)
        try:
            with pytest.raises(ChronicleProviderError) as caught: await p.generate(pack(),'es',lambda _:None)
            d=safe_diagnostic(caught.value)
            assert (d.stage,d.reason,d.http_admitted,d.evidence_reads)==('evidence',reason,calls,reads)
            assert t.calls==calls
        finally: await p.close()
    asyncio.run(run())


def test_narrator_json_and_selection_failure_are_not_mislabelled_analysis():
    from timepitch.chronicles.diagnostics import safe_diagnostic
    async def run():
        p,t=scripted_output('not JSON','Narrator')
        try:
            with pytest.raises(ModelOutputError) as caught: await p.generate(pack(),'en',lambda _:None)
            d=safe_diagnostic(caught.value)
            assert (d.stage,d.reason,d.http_admitted)==('narration','json_invalid',4)
        finally: await p.close()
        p,t,_=provider(); original=p.agent_factory
        def factory(**kwargs):
            agent=original(**kwargs)
            class InvalidSelection:
                async def run(self,payload,options=None):
                    response=await agent.run(payload,options=options)
                    if kwargs['name'].endswith('Narrator'):
                        response.text=json.dumps({'headline':{'fact_ids':['result'],'variant':0},
                            'paragraphs':[{'fact_ids':['result'],'variant':0}]})
                    return response
            return InvalidSelection()
        p.agent_factory=factory
        try:
            with pytest.raises(ValueError) as caught: await p.generate(pack(),'en',lambda _:None)
            d=safe_diagnostic(caught.value)
            assert (d.stage,d.reason)==('selection_validation','selection_invalid')
            assert d.response_chars>0
        finally: await p.close()
    asyncio.run(run())


def test_tool_failure_cannot_be_swallowed_by_an_agent_and_return_a_ready_receipt():
    from timepitch.chronicles.diagnostics import ChronicleProviderError,safe_diagnostic
    async def run():
        p,t,_=provider(); original=p.agent_factory
        def factory(**kwargs):
            if not kwargs.get('tools'): return original(**kwargs)
            class SwallowingAgent:
                async def run(self,*args,**options):
                    from types import SimpleNamespace
                    await t.send(); kwargs['tools'][0]()
                    try: kwargs['tools'][0]()
                    except ModelOutputError: pass  # SDK tool-error handling may consume the error.
                    return SimpleNamespace(text='fabricated recovery')
            return SwallowingAgent()
        p.agent_factory=factory
        try:
            with pytest.raises(ChronicleProviderError) as caught: await p.generate(pack(),'en',lambda _:None)
            assert safe_diagnostic(caught.value).reason=='evidence_repeated'
            assert t.calls==1
        finally: await p.close()
    asyncio.run(run())


def test_transport_failure_records_headers_without_claiming_a_completed_response():
    import httpx
    from timepitch.chronicles.diagnostics import safe_diagnostic
    async def run():
        p,t,_=provider(); original=t.send
        async def broken_body():
            await original()
            raise httpx.ReadError('credential-sentinel in private-path')
        t.send=broken_body
        try:
            with pytest.raises(httpx.ReadError) as caught: await p.generate(pack(),'en',lambda _:None)
            d=safe_diagnostic(caught.value)
            assert (d.stage,d.reason,d.http_admitted,d.response_headers_received)==('evidence','transport_failure',1,1)
            assert d.response_chars is None and 'credential-sentinel' not in d.model_dump_json()
        finally: await p.close()
    asyncio.run(run())


def test_timeout_snapshot_freezes_before_drain_and_late_send_is_denied():
    from timepitch.chronicles.diagnostics import safe_diagnostic
    async def run():
        p,t,_=provider(delay=.03); p.timeout_s=.005
        with pytest.raises(LocalModelTimeout) as caught: await p.generate(pack(),'en',lambda _:None)
        d=safe_diagnostic(caught.value)
        assert (d.stage,d.reason,d.http_admitted,d.response_headers_received)==('evidence','operation_timeout',0,0)
        before=d.model_dump_json()
        await p.close()
        assert t.calls==0 and safe_diagnostic(caught.value).model_dump_json()==before
    asyncio.run(run())


def test_cancellation_propagates_without_late_http_or_snapshot_mutation():
    from timepitch.chronicles.diagnostics import safe_diagnostic
    async def run():
        p,t,_=provider(delay=.03)
        task=asyncio.create_task(p.generate(pack(),'en',lambda _:None))
        while not t.active: await asyncio.sleep(.001)
        task.cancel()
        with pytest.raises(asyncio.CancelledError) as caught: await task
        d=safe_diagnostic(caught.value)
        assert d.reason=='cancelled' and d.http_admitted==0
        await p.close()
        assert t.calls==0 and safe_diagnostic(caught.value)==d
    asyncio.run(run())


@pytest.mark.parametrize('stage',['Analyst','Narrator'])
def test_any_agent_swallowing_denied_admission_cannot_advance_or_publish(stage):
    from timepitch.chronicles.diagnostics import ChronicleProviderError,safe_diagnostic
    async def run():
        p,t,_=provider(); original=p.agent_factory; created=[]
        def factory(**kwargs):
            created.append(kwargs['name']); agent=original(**kwargs)
            class Swallowing:
                async def run(self,*args,**options):
                    response=await agent.run(*args,**options)
                    if kwargs['name'].endswith(stage):
                        try:
                            while True: await t.send()
                        except ModelOutputError: pass
                    return response
            return Swallowing()
        p.agent_factory=factory
        try:
            with pytest.raises(ChronicleProviderError) as caught: await p.generate(pack(),'en',lambda _:None)
            d=safe_diagnostic(caught.value)
            assert d.reason=='http_allowance_exhausted' and d.http_admitted==t.calls==4
            assert d.stage==('analysis' if stage=='Analyst' else 'narration')
            assert created[-1]=='TimePitchChronicle'+stage
        finally: await p.close()
    asyncio.run(run())


@pytest.mark.parametrize('timeout',[False,True])
def test_known_sdk_wrapped_connection_errors_preserve_transport_reason_without_messages(timeout):
    import httpx
    from openai import APIConnectionError,APITimeoutError
    from agent_framework.exceptions import ChatClientException
    from timepitch.chronicles.diagnostics import safe_diagnostic
    async def run():
        p,t,_=provider()
        request=httpx.Request('POST','http://127.0.0.1:54321/v1/chat/completions')
        cause=APITimeoutError(request=request) if timeout else APIConnectionError(message='credential-sentinel',request=request)
        error=ChatClientException('secret-player-path',inner_exception=cause,log_level=None)
        error.__cause__=cause
        async def fail(): raise error
        t.send=fail
        try:
            with pytest.raises(ChatClientException) as caught: await p.generate(pack(),'en',lambda _:None)
            assert caught.value is error
            d=safe_diagnostic(caught.value)
            assert d.stage=='evidence' and d.reason=='transport_failure' and d.http_admitted==0
            assert all(s not in d.model_dump_json() for s in ('credential-sentinel','secret-player-path'))
        finally: await p.close()
    asyncio.run(run())


def test_strict_typed_output_rejection_keeps_validation_reason_and_original_exception():
    from timepitch.chronicles.diagnostics import safe_diagnostic
    from test_chronicle_repository import result
    from test_chronicle_worker_client import claim
    async def run():
        value=result(claim()).selection.model_dump();value['headline']['variant']=0.0
        p,t=scripted_output(json.dumps(value),'Narrator')
        try:
            with pytest.raises(ValidationError) as caught: await p.generate(pack(),'en',lambda _:None)
            d=safe_diagnostic(caught.value)
            assert (d.stage,d.reason,d.http_admitted)==('narration','schema_invalid',4)
            assert d.schema_rule is None and d.schema_path is None
        finally: await p.close()
    asyncio.run(run())
