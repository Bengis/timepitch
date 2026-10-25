"""Canonical immutable research bindings, separate from public native admission."""
from dataclasses import dataclass
import json
import os
from pathlib import Path
from types import MappingProxyType
from pydantic import ConfigDict
from . import physical_campaign_budget as budget
from .action_models import ActionInput,ActionSettings
from .candidate_wire import normalize_payload,float_bits
from .physical_wire import canonical,digest

STUDY='research/engine-evaluation/2026-10-17-grf-defensive-calibration'
CAMPAIGN='research/engine-evaluation/2026-10-17-grf-physical-validation/campaign.json'
DESIGN='docs/superpowers/specs/2026-10-17-grf-causal-intervention-design.md'
C4_PROFILE_SHA256='13ffae0cdc7d0253bd5de9d17526cb9a3897aef733fc32d1a0e96fbc91fd3b58'


def freeze(value):
    if isinstance(value,dict):return MappingProxyType({k:freeze(v) for k,v in value.items()})
    if isinstance(value,list):return tuple(freeze(v) for v in value)
    return value


def plain(value):
    if isinstance(value,(dict,MappingProxyType)):return {k:plain(v) for k,v in value.items()}
    if isinstance(value,(list,tuple)):return [plain(v) for v in value]
    return value


class FrozenSettings(ActionSettings):
    model_config=ConfigDict(extra='forbid',frozen=True)


@dataclass(frozen=True)
class CandidateProfile:
    id:str
    policy_version:str
    identity:str
    native_sha256:str
    build_manifest_sha256:str
    native_dir:Path
    dependencies:dict[str,str]
    measurement_sha256:dict[str,str]
    settings:ActionSettings
    policy:dict
    payloads:dict
    parent_profile_sha256:str|None

    def spec(self):return dict(policy_version=self.policy_version,policy=plain(self.policy))


def _project(project):
    project=Path(project).resolve()
    if project!=budget.PROJECT_ROOT.resolve():raise ValueError('Canonical project required')
    return project


def _native_artifacts(project,candidate):
    """Verify real bytes, not a caller SHA. C5 has no admission before its fixed build exists."""
    project=_project(project)
    if candidate not in ('c4','c5'):raise ValueError('Only fixed C4/C5 research profiles')
    path=project/STUDY/f'{candidate}-profile.json';build_path=path.with_name(f'{candidate}-build.json')
    patch_path=path.with_name(f'{candidate}-policy.patch')
    try:
        profile=budget._read(path);build=budget._read(build_path)
        if candidate=='c4' and budget._sha(path)!=C4_PROFILE_SHA256:raise ValueError('Frozen C4 native profile changed')
        version='c4-marking-1' if candidate=='c4' else 'c5-marking-area-risk-1'
        policy=dict(marking_floor=.85,threat_radius_m=30.,own_area_duel_floor=.7 if candidate=='c4' else .9)
        native=(project/f'.local/grf-{candidate}-native').resolve();release=native/'Release'
        if (profile['id']!=candidate or profile['policy_version']!=version or profile['policy']!=policy or
            profile['expected_float32_bits']!={k:float_bits(v) for k,v in policy.items()} or
            profile['native_dir']!=release.relative_to(project).as_posix() or
            profile['build_manifest_sha256']!=budget._sha(build_path) or profile['build_manifest']!=build_path.name or
            profile['native_sha256']!=build['native_binary_sha256'] or build['candidate_id']!=candidate or
            build['policy_version']!=version or build['build']['exit_code']!=0 or
            build['binary_output']!=profile['native_dir'] or build['patch_sha256']!=budget._sha(patch_path) or
            budget._sha(release/'_gameplayfootball.pyd')!=profile['native_sha256']):
            raise ValueError('Native profile/build/binary mismatch')
        refs={p.relative_to(project).as_posix():budget._sha(p) for p in (path,build_path,patch_path,release/'_gameplayfootball.pyd')}
        def add(p,expected=None):
            h=budget._sha(p)
            if expected is not None and h!=expected:raise ValueError('Native artifact changed: '+str(p))
            refs[p.relative_to(project).as_posix()]=h
        pressure=budget._read(project/'research/engine-evaluation/2026-10-17-grf-actions/native-fixture-pressure-build.json')
        if profile['dependencies']!=build['dependencies'] or build['dependencies']!=pressure['dependencies'] or len(build['dependencies'])!=14:
            raise ValueError('Native dependency set changed')
        if {p.name for p in release.glob('*.dll')}!=set(build['dependencies']):raise ValueError('Extra/missing native dependency')
        for name,h in build['dependencies'].items():
            if Path(name).name!=name:raise ValueError('Invalid dependency path')
            add(release/name,h)
        tree_path=native/'provenance/source-tree.json';add(tree_path,build['source_tree_sha256'])
        tree=budget._read(tree_path)
        actual={p.relative_to(native/'source').as_posix() for p in (native/'source').rglob('*') if p.is_file()}
        if set(tree)!=actual or len(tree)!=688:raise ValueError('Native source closure changed')
        for name,h in tree.items():add(budget._artifact(native/'source',name),h)
        for name,entry in build['source_hashes'].items():
            p=native/'source'/name
            if __import__('hashlib').sha256(p.read_text(encoding='utf-8').encode()).hexdigest()!=entry['sha256_lf']:
                raise ValueError('LF source identity changed')
        if len(build['project_sha256'])!=12:raise ValueError('Native dependency graph changed')
        for name,h in build['project_sha256'].items():add(budget._artifact(native/'build',name),h)
        c4=profile if candidate=='c4' else read_native_profile(project,'c4')
        if candidate=='c5':
            if profile['parent_profile_sha256']!=budget._sha(project/STUDY/'c4-profile.json'):
                raise ValueError('C5 immutable parent changed')
            parent=budget._read(project/STUDY/'c4-build.json')
            original_tree=budget._read(project/'.local/grf-c4-native/provenance/source-tree.json')
            if {k:v for k,v in tree.items() if k!='src/timepitch_policy_config.hpp'}!={k:v for k,v in original_tree.items() if k!='src/timepitch_policy_config.hpp'}:
                raise ValueError('C5 contains another intervention')
            expected=(project/'.local/grf-c4-native/source/src/timepitch_policy_config.hpp').read_text().replace('c4-marking-1',version).replace('kOwnAreaDuelFloor=0.70f','kOwnAreaDuelFloor=0.90f')
            if (native/'source/src/timepitch_policy_config.hpp').read_text()!=expected or build['previous_native_binary_sha256']!=parent['native_binary_sha256']:
                raise ValueError('C5 fixed increment changed')
        if profile['settings']!=c4['settings'] or profile['settings']!=ActionSettings().model_dump(mode='json'):
            raise ValueError('Fixed C1 settings changed')
        return profile,refs
    except (OSError,KeyError,TypeError) as error:raise ValueError('Missing/invalid frozen native build') from error


def read_native_profile(project,candidate):return _native_artifacts(project,candidate)[0]


def measurement_snapshot(project):
    base=project/'backend/src/timepitch'
    paths=sorted(base.rglob('*.py'))+[base/'grf/assets.json']
    if not paths:raise ValueError('Missing measurement code')
    return {p.relative_to(project).as_posix():budget._sha(p) for p in paths}


def intervention(project):
    project=_project(project);path=project/STUDY/'intervention.json';value=budget._read(path)
    if (value.get('schema_version')!='grf-defensive-intervention-1' or value.get('campaign')!=CAMPAIGN or
        value.get('design')!=DESIGN or value.get('campaign_sha256')!=budget._sha(project/CAMPAIGN) or
        value.get('design_sha256')!=budget._sha(project/DESIGN) or value.get('c4_native_profile_sha256')!=C4_PROFILE_SHA256 or
        value.get('hypotheses')!={'c4':dict(marking_floor=.85,threat_radius_m=30.,own_area_duel_floor=.7),
                               'c5':dict(marking_floor=.85,threat_radius_m=30.,own_area_duel_floor=.9)}):
        raise ValueError('Canonical intervention changed')
    campaign=budget._read(project/CAMPAIGN)
    if budget._sha(project/campaign['dataset'])!=campaign['dataset_sha256']:raise ValueError('Historical dataset changed')
    return value,campaign


def _paths(root,candidate):
    root,lock=budget._locations(root)
    if candidate not in ('c4','c5'):raise ValueError('Unknown candidate')
    return root,lock,root/'candidate-bindings'/f'{candidate}.json',root.parent/f'continuation-{candidate}-registration.json',root.parent/f'continuation-{candidate}-initialized.json'


def _payloads(project,campaign):
    from ..catalog.repository import CatalogRepository
    from ..simulation.models import MatchConfig
    from .input import make_action_input
    result={};catalog=CatalogRepository(project/campaign['dataset'])
    for split,n in (('calibration',8),('heldout',24)):
        fixtures=campaign['fixtures'][split]
        if len(fixtures)!=n or {v['id'] for v in fixtures}!={f'{i:02}' for i in range(1,n+1)}:raise ValueError('Original fixtures changed')
        for f in fixtures:
            request=make_action_input(MatchConfig.model_validate(f['config']),catalog)
            result[split+'/'+f['id']]=normalize_payload(request.model_dump(mode='json'))
    return result


def _from_binding(project,binding):
    native=binding['native_profile']
    return CandidateProfile(binding['candidate_id'],native['policy_version'],digest(binding),native['native_sha256'],
        native['build_manifest_sha256'],project/native['native_dir'],freeze(native['dependencies']),freeze(binding['measurement_sha256']),
        FrozenSettings.model_validate(native['settings']),freeze(native['policy']),freeze(binding['payloads']),native['parent_profile_sha256'])


def load_candidate_profile(project:Path,candidate_id:str)->CandidateProfile:
    project=_project(project);root=project/'.local/grf-physical-work/continuation'
    root,_,path,registration,witness=_paths(root,candidate_id)
    binding=budget._read(path);identity=digest(binding)
    expected=dict(root=str(root),identity=identity,binding_sha256=budget._sha(path))
    if budget._read(registration)!=expected or budget._read(witness)!=expected:raise ValueError('Candidate binding registration changed')
    descriptor,campaign=intervention(project);native,refs=_native_artifacts(project,candidate_id)
    if (binding.get('schema_version')!='grf-candidate-binding-1' or binding['candidate_id']!=candidate_id or
        binding['native_profile']!=native or binding['native_files']!=refs or binding['measurement_sha256']!=measurement_snapshot(project) or
        binding['intervention_sha256']!=budget._sha(project/STUDY/'intervention.json') or binding['campaign_identity']!=budget._digest(campaign)):
        raise ValueError('Frozen candidate/source/measurement changed')
    for name,h in binding['native_files'].items():
        if budget._sha(budget._artifact(project,name))!=h:raise ValueError('Bound native artifact changed')
    for key,payload in binding['payloads'].items():
        request=ActionInput.model_validate(payload)
        from .codec import grf_input_hash
        split,id=key.split('/')
        f=next((f for f in campaign['fixtures'][split] if f['id']==id),None)
        if f is None or request.config.model_dump(mode='json')!=f['config'] or request.input_hash!=grf_input_hash(request) or request.settings.model_dump(mode='json')!=native['settings']:
            raise ValueError('Fixed payload changed')
    if set(binding['payloads'])!={f'{s}/{i:02}' for s,n in [('calibration',8),('heldout',24)] for i in range(1,n+1)}:
        raise ValueError('Complete payload binding required')
    return _from_binding(project,binding)


def bind_candidate_profile(project:Path,candidate_id:str,root:Path)->CandidateProfile:
    project=_project(project);root,lock,path,registration,witness=_paths(root,candidate_id)
    descriptor,campaign=intervention(project)
    with budget._lock(lock):
        old=budget._load(root,lock)
        from .defensive_probe_budget import _extension_usage_locked
        _extension_usage_locked(root,old,new_reservation=True)
        if old['identity']!=budget._digest(campaign):raise ValueError('Original continuation changed')
        if any(p.exists() for p in (path,registration,witness)):return load_candidate_profile(project,candidate_id)
        if candidate_id in old['candidate_bindings'] or any(id.startswith(candidate_id+'/') for id in old['runs']):
            raise ValueError('Consumed candidate lost binding; never recreate it')
        if any(p.exists() for p in (root/'selection/freeze.json',root.parent/'continuation-selection-registration.json',root.parent/'continuation-selection-initialized.json')):
            raise ValueError('Selection sealed; never reopen tuning')
        if candidate_id=='c5':
            from .action_campaign import verified_report
            from .action_gates import c5_eligibility
            if not c5_eligibility(verified_report(root,'c4',_locked_state=old))['eligible']:raise ValueError('C5 not eligible')
        native,refs=_native_artifacts(project,candidate_id)
        binding=dict(schema_version='grf-candidate-binding-1',candidate_id=candidate_id,campaign_identity=old['identity'],
            intervention_sha256=budget._sha(project/STUDY/'intervention.json'),native_profile=native,native_files=refs,
            measurement_sha256=measurement_snapshot(project),payloads=_payloads(project,campaign))
        registration.parent.mkdir(parents=True,exist_ok=True);path.parent.mkdir(parents=True,exist_ok=True)
        expected=dict(root=str(root),identity=digest(binding),binding_sha256=budget._digest(binding))
        with witness.open('xb') as stream:stream.write(canonical(expected));stream.flush();os.fsync(stream.fileno())
        budget._write(path,binding);budget._write(registration,expected)
        return load_candidate_profile(project,candidate_id)
