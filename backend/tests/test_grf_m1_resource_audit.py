"""Phase3 synthetic audit contracts; the full saved benchmark is never a test."""
import copy
import inspect
from pathlib import Path
from types import SimpleNamespace
import pytest
from grf_offline_guard import offline_only
from timepitch.grf.physical_wire import digest


@pytest.fixture(autouse=True)
def guarded(offline_only):pass


@pytest.fixture
def audit(tmp_path,monkeypatch):
    from timepitch.grf import m1_resource_audit as a,m1_resources as r
    from timepitch.grf.m1_verifier import read,PROJECT,sha
    reference=read(PROJECT/a.STUDY/'offline-profile.json')
    reference['summary_sha256']=digest({'synthetic':'summary'})
    source=tmp_path/'backend/src/timepitch/analysis.py';source.parent.mkdir(parents=True);source.write_bytes(b'# synthetic analysis\n')
    protected=tmp_path/'protected.json';protected.write_bytes(b'{"complete":false}')
    history=dict(used=42,maximum=76,candidates=6,candidate_limit=6,terminal_id='M-observe-42',heldout_opened=False)
    document=dict(source_sha256={'backend/src/timepitch/analysis.py':sha(source)},inventories=[dict(root='backend/src/timepitch',pattern='*.py',members=['backend/src/timepitch/analysis.py'])])
    profile=SimpleNamespace(project=tmp_path,identity=a.EVIDENCE_PROFILE,native_sha256='b'*64,
        build_manifest_sha256='c'*64,document=document,payload=lambda key:{'input_hash':'1'*64})
    inputs=a.AuditInputs(profile,reference,history,{'backend/src/timepitch/analysis.py':sha(source)},
        {'protected.json':sha(protected)},dict(launch_to_manifest_seconds=392.1627526))
    monkeypatch.setattr(a,'_inputs',lambda *args:inputs)
    monkeypatch.setattr(a,'verify_resource_archive',lambda root:dict(history))
    monkeypatch.setattr(a,'SUMMARY_SHA',digest({'synthetic':'summary'}))
    now=[0.];monkeypatch.setattr(a,'_clock',lambda:now[0])
    monkeypatch.setattr(r,'_wall_clock',lambda:now[0]);monkeypatch.setattr(r,'_cpu_clock',lambda:now[0]/2)
    monkeypatch.setattr(r,'_parent_peak',lambda:4096)
    identity=dict(run_id='M-observe-42',mode='observe',input_hash='1'*64,native_sha256='b'*64,
        profile_identity=profile.identity,build_manifest_sha256='c'*64)
    def readback(side,slot,attribute):
        value=dict(side=side,slot=slot,attribute=attribute,base=.5)
        return SimpleNamespace(**value,model_dump=lambda **kw:dict(value))
    players=[SimpleNamespace(side=side,slot=i,id=side+str(i)) for side in ('home','away') for i in range(11)]
    manifest=SimpleNamespace(worker_identity=identity,trace_hash='d'*64,input=SimpleNamespace(players=players),
        attribute_readbacks=[readback(s,i,k) for s in ('home','away') for i in range(11) for k in ('a','b','c')],
        close_receipts=[dict(reason='natural_stoppage',before={'period':i}) for i in (1,2)],score=(7,6),duration_ms=5955500)
    result=SimpleNamespace(manifest=manifest)
    monkeypatch.setattr(a,'_retained',lambda *args:result)
    calls=dict(evidence=0,reduction=0,comparison=0)
    context=copy.deepcopy(reference['context']);policy=copy.deepcopy(reference['policy'])
    def evidence(*args):calls['evidence']+=1;now[0]+=1.;return SimpleNamespace(context=context,policy=policy,identity=identity,trace_hash=manifest.trace_hash)
    def reduction(*args):calls['reduction']+=1;now[0]+=1.;return dict(_analysis={'summary.json':{'synthetic':'summary'}})
    def comparison(*args):
        calls['comparison']+=1;now[0]+=1.
        return dict(reference['comparison'],equivalent=True,exact_transactions=79,trace_hash=manifest.trace_hash,profile_identity=profile.identity)
    monkeypatch.setattr(a,'_evidence',evidence);monkeypatch.setattr(a,'_reduction',reduction);monkeypatch.setattr(a,'_comparison',comparison)
    output=tmp_path/a.STUDY;output.mkdir(parents=True)
    return SimpleNamespace(a=a,r=r,root=tmp_path,output=output,inputs=inputs,result=result,calls=calls,
        now=now,context=context,policy=policy,protected=protected,reference=reference)


def test_offline_audit_never_opens_campaign(audit,monkeypatch):
    from timepitch.grf import m1_campaign
    x=audit
    monkeypatch.setattr(m1_campaign,'run_m1_stage',lambda *a,**kw:pytest.fail('campaign forbidden'))
    before=x.protected.read_bytes();report=x.a.audit_saved_observation(x.root,x.output)
    assert report['status']=='passed' and report['admission'] is False
    assert report['diagnostic_only'] is True and x.protected.read_bytes()==before
    assert x.calls==dict(evidence=1,reduction=1,comparison=1)
    assert list(inspect.signature(x.a.audit_saved_observation).parameters)==['project','output']


def test_reference_timing_and_decoder_scope_labelled(audit):
    x=audit;x.a.audit_saved_observation(x.root,x.output)
    report=x.a.read(x.output/'phase3-performance.json')
    assert report['reference_seconds']==95.016 and report['triple_limit_seconds']==104.518
    assert report['triple_seconds']==3. and report['call_counts']==x.calls
    assert report['decoder_scope']['control']=='instrumented separate alias; comparison time includes both replays'
    assert report['reference_decoder_scope']['candidate_instrumented_per_triple']==301
    assert report['reference_decoder_scope']['control_derived_per_comparison']==60
    assert report['timing_scope'].find('not original')>=0


@pytest.mark.parametrize('corruption',['summary','common','zero_transactions','context','policy','interpolation','readbacks','closes','identity',
    'proof_identity','proof_equivalence','proof_transactions'])
def test_both_digests_and_full_evidence_required(audit,monkeypatch,corruption):
    x=audit
    if corruption=='summary':monkeypatch.setattr(x.a,'SUMMARY_SHA','0'*64)
    elif corruption=='common':x.reference['comparison']['common_sha256']='0'*64
    elif corruption=='zero_transactions':x.context['transactions']=0
    elif corruption=='context':x.context['frames']=185
    elif corruption=='policy':x.policy['counters']['guards']=126
    elif corruption=='interpolation':x.context['interpolated_frames']=1
    elif corruption=='readbacks':x.result.manifest.attribute_readbacks.pop()
    elif corruption=='closes':x.result.manifest.close_receipts[0]['reason']='bounded_open_play'
    elif corruption=='identity':x.result.manifest.worker_identity['profile_identity']='0'*64
    else:
        original=x.a._comparison
        def bad(*args):
            proof=original(*args)
            proof[{'proof_identity':'profile_identity','proof_equivalence':'equivalent','proof_transactions':'exact_transactions'}[corruption]]=False
            return proof
        monkeypatch.setattr(x.a,'_comparison',bad)
    report=x.a.audit_saved_observation(x.root,x.output)
    assert report['status']=='blocked' and report['admission'] is False
    assert max(x.calls.values())<=1


def test_performance_miss_is_blocked_without_retry(audit,monkeypatch):
    x=audit;original=x.a._comparison
    def slow(*args):value=original(*args);x.now[0]=104.519;return value
    monkeypatch.setattr(x.a,'_comparison',slow)
    report=x.a.audit_saved_observation(x.root,x.output)
    assert report['status']=='blocked' and report['correctness_passed'] is True
    with pytest.raises(FileExistsError):x.a.audit_saved_observation(x.root,x.output)
    assert x.calls==dict(evidence=1,reduction=1,comparison=1)


def test_no_original_resource_values_invented(audit,monkeypatch):
    x=audit;observed=[];original=x.a._reduction
    def measured(result,evidence,resources):observed.append(resources);return original(result,evidence,resources)
    monkeypatch.setattr(x.a,'_reduction',measured)
    report=x.a.audit_saved_observation(x.root,x.output)
    assert report['historical_resources']==dict(charged_seconds=None,child_peak_private_bytes=None,parent_peak_private_bytes=None)
    assert observed==[dict(seconds=1.,peak_private_bytes=4096)]
    assert report['current_resources']['child_peak_private_bytes'] is None


def test_old_evidence_identity_not_relabelled(audit):
    x=audit;original=copy.deepcopy(x.result.manifest.worker_identity)
    report=x.a.audit_saved_observation(x.root,x.output)
    assert report['evidence_profile_identity']==original['profile_identity']
    assert report['analysis_source_identity']!=original['profile_identity']
    assert x.result.manifest.worker_identity==original


def test_diagnostic_row_cannot_enter_live_finish(audit):
    from timepitch.grf.m1_authorization import WorkerLedger
    x=audit;report=x.a.audit_saved_observation(x.root,x.output)
    with pytest.raises(ValueError):WorkerLedger.finish_capture(object(),'M-observe-42',report,x.r.M1Budget())
    with pytest.raises(ValueError):WorkerLedger.finish(object(),'M-observe-42',report)


@pytest.mark.parametrize('forbidden',['native','process','heldout','write','ledger'])
def test_audit_enforces_offline_guards(audit,monkeypatch,forbidden):
    x=audit
    def attempt(*args):
        if forbidden=='native':__import__('gfootball')
        elif forbidden=='process':
            import subprocess
            subprocess.Popen(['must-not-run'])
        elif forbidden=='heldout':(x.root/'heldout/outcome.json').read_bytes()
        elif forbidden=='write':x.protected.write_text('must not change')
        else:
            from timepitch.grf.campaign_ledger import CampaignLedger
            CampaignLedger(x.root,x.inputs.profile,None)
    monkeypatch.setattr(x.a,'_evidence',attempt)
    before=x.protected.read_bytes();report=x.a.audit_saved_observation(x.root,x.output)
    assert report['status']=='blocked' and x.protected.read_bytes()==before
    assert report['guard_blocks'][forbidden]==1


def test_output_cannot_target_campaign(audit):
    x=audit
    with pytest.raises(ValueError):x.a.audit_saved_observation(x.root,x.root/'.local/grf-physical-work/priority-continuity')
    assert not any(x.calls.values())


def test_zero_transaction_context_does_not_reduce(audit):
    x=audit;x.context['transactions']=0
    report=x.a.audit_saved_observation(x.root,x.output)
    assert report['status']=='blocked' and x.calls==dict(evidence=1,reduction=0,comparison=0)


def test_late_report_write_timeout_downgrades_reports(audit,monkeypatch):
    x=audit;original=x.a._write
    def slow(path,value,**kwargs):
        original(path,value,**kwargs)
        if path.name=='phase3-performance.json':x.now[0]=601.
    monkeypatch.setattr(x.a,'_write',slow)
    report=x.a.audit_saved_observation(x.root,x.output)
    assert report['status']=='blocked' and report['current_resources']['exceeded_time']
    assert x.a.read(x.output/'phase3-performance.json')['performance_gate'] is False
    assert x.a.read(x.output/'phase3-replay-audit.json')['admission'] is False


@pytest.mark.parametrize('changed',['source','protected'])
def test_closing_rejects_changed_inputs(audit,changed):
    x=audit
    path=x.root/'backend/src/timepitch/analysis.py' if changed=='source' else x.protected
    path.write_bytes(b'changed')
    with pytest.raises(ValueError,match='changed'):x.a._closing(x.inputs,x.r.M1Budget())


def test_reference_pin_rejects_changed_bytes(tmp_path,monkeypatch):
    from timepitch.grf import m1_resource_audit as a
    from timepitch.grf.m1_verifier import sha
    folder=tmp_path/a.STUDY;folder.mkdir(parents=True)
    for n in ('offline-profile.json','diagnosis.json'):(folder/n).write_bytes(b'{}')
    monkeypatch.setattr(a,'REFERENCE_SHA',sha(folder/'offline-profile.json'))
    monkeypatch.setattr(a,'DIAGNOSIS_SHA',sha(folder/'diagnosis.json'))
    assert a._reference(tmp_path)==({},{})
    (folder/'offline-profile.json').write_bytes(b'{ }')
    with pytest.raises(ValueError,match='pinned'):a._reference(tmp_path)


@pytest.mark.parametrize('mutation',[None,'original','extra','receipt'])
def test_inputs_bind_real_archive_and_current_source_inventory(tmp_path,monkeypatch,mutation):
    """Fully owned synthetic archive; actual history/source/reference readers."""
    from test_grf_m1_resource_history import seed,put
    from timepitch.grf import m1_resource_audit as a
    from timepitch.grf.m1_verifier import sha,read
    h,record=seed(tmp_path)
    document=read(tmp_path/h.DESCRIPTOR)
    document.update(native_sha256='b'*64,build_manifest_sha256='c'*64,payloads={'calibration/01':{'input_hash':'1'*64}})
    descriptor_sha=put(tmp_path,h.DESCRIPTOR,document);identity=digest(document)
    put(tmp_path,h.WITNESS,dict(schema_version='m1-worker-freeze-witness-1',profile_identity=identity,descriptor_sha256=descriptor_sha))
    # Finish constructing the owned fake closure before any audit verification.
    for n in (h.DESCRIPTOR,h.WITNESS):
        put(tmp_path,h.ARCHIVE+'/metadata/'+n,(tmp_path/n).read_bytes());record['metadata_sha256'][n]=sha(tmp_path/n)
    record['profile_identity']=identity;record_sha=put(tmp_path,h.ARCHIVE+'/record.json',record)
    for n in (h.ARCHIVE+'/binding.json',h.BINDING,h.ANCHOR):
        put(tmp_path,n,dict(schema_version='m1-resource-source-binding-1',profile_identity=identity,record_sha256=record_sha))
    source='backend/src/timepitch/new_analysis.py';put(tmp_path,source,b'# added current source\n')
    phase1=dict(phase=1,native_authorized=False,source_sha256={})
    put(tmp_path,a.STUDY+'/phase1-acceptance.json',phase1)
    put(tmp_path,a.STUDY+'/offline-profile.json',{'synthetic':True})
    put(tmp_path,a.STUDY+'/diagnosis.json',{'timeline':{'launch_to_manifest_seconds':1.}})
    phase2=dict(phase=2,native_authorized=False,original_failed_attempt_admitted=False,source_sha256={})
    put(tmp_path,a.STUDY+'/phase2-acceptance.json',phase2)
    monkeypatch.setattr(a,'EVIDENCE_PROFILE',identity)
    monkeypatch.setattr(a,'REFERENCE_SHA',sha(tmp_path/a.STUDY/'offline-profile.json'))
    monkeypatch.setattr(a,'DIAGNOSIS_SHA',sha(tmp_path/a.STUDY/'diagnosis.json'))
    monkeypatch.setattr(a,'PHASE1_DIGEST',digest(phase1),raising=False)
    monkeypatch.setattr(a,'PHASE2_DIGEST',digest(phase2),raising=False)
    monkeypatch.setattr(a,'AUDIT_SOURCE_ADDITIONS',(source,),raising=False)
    from timepitch.grf import m1_resources as resources
    monkeypatch.setattr(resources,'_parent_peak',lambda:4096)
    if mutation=='original':put(tmp_path,'backend/src/timepitch/example.py',b'# changed original validator\n')
    elif mutation=='extra':put(tmp_path,'backend/src/timepitch/unapproved.py',b'# undeclared analysis code\n')
    elif mutation=='receipt':put(tmp_path,a.STUDY+'/phase2-acceptance.json',dict(phase2,source_sha256={'not-approved.py':'f'*64}))
    if mutation:
        with pytest.raises(ValueError):a._inputs(tmp_path,resources.M1Budget())
        return
    inputs=a._inputs(tmp_path,resources.M1Budget())
    assert inputs.profile.identity==identity and len(inputs.source_sha256)==2
    assert inputs.source_sha256[source]==sha(tmp_path/source)
    a._closing(inputs,resources.M1Budget())


def test_instrumentation_counts_both_decoder_aliases_and_restores():
    from grf_action_fixtures import action_trace
    from timepitch.grf import m1_resource_audit as a,physical_codec,action_validation
    raw=physical_codec.encode_chunk(action_trace()[1][0])
    originals=(physical_codec.decode_chunk,action_validation.decode_chunk)
    stage=dict.fromkeys(('candidate_calls','candidate_seconds','control_calls','control_seconds','validator_calls','validator_seconds'),0)
    telemetry=dict(active='evidence',stages={'evidence':stage})
    with a._instrument(telemetry):
        physical_codec.decode_chunk(raw);action_validation.decode_chunk(raw)
    assert stage['candidate_calls']==stage['control_calls']==1
    assert (physical_codec.decode_chunk,action_validation.decode_chunk)==originals
    with pytest.raises(ValueError),a._instrument(telemetry):physical_codec.decode_chunk(b'invalid')
    assert (physical_codec.decode_chunk,action_validation.decode_chunk)==originals


def test_guard_and_bytecode_state_restored_after_failure(audit,monkeypatch):
    import builtins,io,sys,subprocess
    from timepitch.grf.campaign_ledger import CampaignLedger
    before=(builtins.__import__,builtins.open,io.open,Path.open,subprocess.Popen,CampaignLedger.__init__,sys.meta_path,sys.dont_write_bytecode)
    x=audit
    def broken(*args):raise ValueError('synthetic validator failure')
    monkeypatch.setattr(x.a,'_evidence',broken)
    assert x.a.audit_saved_observation(x.root,x.output)['status']=='blocked'
    after=(builtins.__import__,builtins.open,io.open,Path.open,subprocess.Popen,CampaignLedger.__init__,sys.meta_path,sys.dont_write_bytecode)
    assert all(left is right for left,right in zip(before,after))


@pytest.mark.parametrize('name',['diagnosis.json','offline-profile.json','source-binding.json','phase2-acceptance.json'])
def test_guard_preserves_existing_evidence_inside_output(audit,monkeypatch,name):
    x=audit;path=x.output/name;path.write_bytes(b'protected historical evidence')
    def attempt(*args):path.write_bytes(b'truncated')
    monkeypatch.setattr(x.a,'_evidence',attempt)
    report=x.a.audit_saved_observation(x.root,x.output)
    assert report['status']=='blocked' and report['guard_blocks']['write']==1
    assert path.read_bytes()==b'protected historical evidence'


def test_publication_failure_never_leaves_a_final_pass(audit,monkeypatch):
    x=audit;original=x.a._write
    def fail(path,value,**kwargs):
        if path.name=='phase3-replay-audit.json' and kwargs.get('replace_claim'):raise OSError('publication disk error')
        return original(path,value,**kwargs)
    monkeypatch.setattr(x.a,'_write',fail)
    with pytest.raises(OSError):x.a.audit_saved_observation(x.root,x.output)
    for name in ('phase3-performance.json','phase3-replay-audit.json'):
        saved=x.a.read(x.output/name)
        assert saved['status']!='passed' and saved.get('publication_complete') is False


def test_downgrade_write_error_preserves_resource_failure_and_provisional_reports(audit,monkeypatch):
    x=audit;original=x.a._write
    def fail(path,value,**kwargs):
        if path.name=='phase3-performance.json' and kwargs.get('replace_claim'):raise OSError('downgrade disk error')
        original(path,value,**kwargs)
        if path.name=='phase3-performance.json':x.now[0]=601.
    monkeypatch.setattr(x.a,'_write',fail)
    with pytest.raises(x.r.M1ResourceExceeded) as caught:x.a.audit_saved_observation(x.root,x.output)
    assert caught.value.diagnostic_error=='OSError' and caught.value.snapshot.exceeded_time
    for name in ('phase3-performance.json','phase3-replay-audit.json'):
        saved=x.a.read(x.output/name)
        assert saved['status']!='passed' and saved.get('publication_complete') is False


def test_success_files_stay_provisional_until_executor_acceptance(audit):
    x=audit;result=x.a.audit_saved_observation(x.root,x.output)
    assert result['status']=='passed' and result['publication_complete'] is True
    for name in ('phase3-performance.json','phase3-replay-audit.json'):
        saved=x.a.read(x.output/name)
        assert saved['status']=='provisional' and saved['publication_complete'] is False
        assert saved['requires_executor_acceptance'] is True
