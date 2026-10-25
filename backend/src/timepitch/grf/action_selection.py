"""Durable immutable selection, before any of the original24 heldout outcomes."""
import os
from . import physical_campaign_budget as budget
from .candidate_profiles import load_candidate_profile,intervention,plain,STUDY,CAMPAIGN,DESIGN
from .action_gates import c5_eligibility
from .physical_wire import canonical,digest


def _paths(root):
    root,lock=budget._locations(root)
    return root,lock,root/'selection/freeze.json',root.parent/'continuation-selection-registration.json',root.parent/'continuation-selection-initialized.json'


def _selected(root,state):
    from .action_campaign import verified_report
    c4=verified_report(root,'c4',_locked_state=state)
    if all(c4['gates'].values()):return c4
    if not c5_eligibility(c4)['eligible']:raise ValueError('No eligible qualifying profile')
    c5=verified_report(root,'c5',_locked_state=state)
    if not all(c5['gates'].values()):raise ValueError('C5 did not qualify')
    return c5


def _verify(root,state):
    root,_,path,registration,witness=_paths(root);project=budget.PROJECT_ROOT.resolve()
    value=budget._read(path);expected=dict(root=str(root),identity=digest(value),freeze_sha256=budget._sha(path))
    if budget._read(registration)!=expected or budget._read(witness)!=expected or value.get('schema_version')!='grf-candidate-selection-1':
        raise ValueError('Selection registration missing/changed; never reopen candidates')
    selected=_selected(root,state);profile=load_candidate_profile(project,selected['candidate_id']);_,campaign=intervention(project)
    report_path=root/'reports'/f'{profile.id}-calibration.json'
    reports={c:budget._sha(root/'reports'/f'{c}-calibration.json') for c in (('c4',) if profile.id=='c4' else ('c4','c5'))}
    payloads={str(i).zfill(2):digest(plain(profile.payloads[f'heldout/{i:02}'])) for i in range(1,25)}
    if (value['candidate_id']!=profile.id or value['profile_identity']!=profile.identity or value['native_sha256']!=profile.native_sha256 or
        value['build_manifest_sha256']!=profile.build_manifest_sha256 or value['heldout_payload_hashes']!=payloads or
        value['measurement_sha256']!=plain(profile.measurement_sha256) or value['settings']!=profile.settings.model_dump(mode='json') or
        value['campaign_identity']!=state['identity'] or value['campaign_sha256']!=budget._sha(project/CAMPAIGN) or
        value['design_sha256']!=budget._sha(project/DESIGN) or value['report_sha256']!=budget._sha(report_path) or value['calibration_report_sha256']!=reports):
        raise ValueError('Sealed selection/payload/report changed')
    return value


def verify_frozen_selection(root)->dict:
    root,lock,*_=_paths(root)
    with budget._lock(lock):return _verify(root,budget._load(root,lock))


def freeze_candidate(report:dict,campaign:dict,root)->dict:
    root,lock,path,registration,witness=_paths(root);project=budget.PROJECT_ROOT.resolve()
    _,actual=intervention(project)
    if campaign!=actual:raise ValueError('Original campaign required')
    with budget._lock(lock):
        state=budget._load(root,lock)
        if any(p.exists() for p in (path,registration,witness)):
            existing=_verify(root,state)
            if report['candidate_id']!=existing['candidate_id'] or report['profile_identity']!=existing['profile_identity']:
                raise ValueError('Selection already sealed')
            return existing
        if any('/heldout/' in id for id in state['runs']):raise ValueError('Heldout already opened without selection')
        selected=_selected(root,state)
        if report!=selected:raise ValueError('Select exactly the complete qualifying report')
        profile=load_candidate_profile(project,selected['candidate_id'])
        value=dict(schema_version='grf-candidate-selection-1',candidate_id=profile.id,profile_identity=profile.identity,
            native_sha256=profile.native_sha256,build_manifest_sha256=profile.build_manifest_sha256,campaign_identity=state['identity'],
            campaign_sha256=budget._sha(project/CAMPAIGN),design_sha256=budget._sha(project/DESIGN),
            settings=profile.settings.model_dump(mode='json'),measurement_sha256=plain(profile.measurement_sha256),
            report_sha256=budget._sha(root/'reports'/f'{profile.id}-calibration.json'),
            calibration_report_sha256={c:budget._sha(root/'reports'/f'{c}-calibration.json') for c in (('c4',) if profile.id=='c4' else ('c4','c5'))},
            heldout_payload_hashes={f'{i:02}':digest(plain(profile.payloads[f'heldout/{i:02}'])) for i in range(1,25)})
        expected=dict(root=str(root),identity=digest(value),freeze_sha256=budget._digest(value))
        path.parent.mkdir(parents=True,exist_ok=True)
        with witness.open('xb') as stream:stream.write(canonical(expected));stream.flush();os.fsync(stream.fileno())
        budget._write(path,value);budget._write(registration,expected)
        return _verify(root,state)
