"""Offline K1 shadow with explicit fidelity; never imports or steps GRF."""
from dataclasses import asdict,dataclass,replace
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import tempfile
import time

from .coordination_models import CoordinationInput,CoordinationState,CoordinationDecision,Player,Point,encode_request
from .coordination_evidence import STUDY,CONTINUATION,load_evidence_inputs


def _sha(path):
    digest=hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda:stream.read(1024*1024),b''):digest.update(block)
    return digest.hexdigest()


def _digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest()


@dataclass(frozen=True)
class SampleIdentity:
    fixture_id:str
    source_sha256:str
    trace_hash:str
    sample_index:int
    physics_ms:int
    period:int
    relocation_id:int
    raw_event_seq:int=-1


@dataclass(frozen=True)
class ShadowSnapshot:
    kind:str
    identity:SampleIdentity
    expected_identity:SampleIdentity
    players:tuple[Player,...]
    ball_position:Point|None
    defending_team:int
    dynamic_side:int
    native_input:CoordinationInput|None=None
    native_state:CoordinationState|None=None
    state_origin:str='unavailable'
    cached_targets:tuple[dict,...]=()
    payload_sha256:str=''


def _payload(snapshot):
    value=asdict(snapshot);value.pop('payload_sha256')
    return value


def seal_snapshot(snapshot:ShadowSnapshot)->ShadowSnapshot:
    """Bind supplied bytes; this is not authentication or native admission.

    Retained inputs must first pass load_evidence_inputs. Future native
    transactions require their own verified transport before this API.
    """
    return replace(snapshot,payload_sha256=_digest(_payload(snapshot)))


@dataclass(frozen=True)
class ShadowResult:
    identity:SampleIdentity
    decision_fidelity:str
    input_coverage:dict
    responsibilities:dict
    metrics:dict
    reasons:tuple[str,...]

    def as_dict(self):return asdict(self)


class CppPolicy:
    """Pinned standalone pure executable, with bounded fixture requests."""
    def __init__(self,executable):
        self.executable=Path(executable).resolve();self.sha256=_sha(self.executable)

    def _run(self,wire):
        if _sha(self.executable)!=self.sha256:raise ValueError('Pure executable changed')
        if len(wire)>65536:raise ValueError('Pure request exceeds bound')
        result=subprocess.run([str(self.executable)],input=wire.encode(),capture_output=True,timeout=5,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
        if result.returncode or len(result.stdout)>65536 or len(result.stderr)>65536:
            raise ValueError('Pure executable rejected bounded request')
        return json.loads(result.stdout,parse_constant=lambda value:(_ for _ in ()).throw(ValueError('Nonfinite output')))

    def coordinate(self,inputs,state):
        value=self._run(encode_request(inputs,state))
        if value['version']!='k1-coordination-1':raise ValueError('Unknown pure policy version')
        return CoordinationDecision.from_dict(value)

    def project(self,owners,targets,quality):
        if len(owners)>11 or len(targets)>3 or len(quality)!=len(owners) or any(len(row)!=len(targets) for row in quality):
            raise ValueError('Invalid projection shape')
        if any(type(id) is not int or not 0<=id<2**31 for id in (*owners,*targets)):
            raise ValueError('Invalid projection identity')
        wire=' '.join(['K1PROJECT',str(len(owners)),*[str(v) for v in owners],str(len(targets)),
            *[str(v) for v in targets],*[str(float(q)) for row in quality for q in row]])+'\n'
        result=self._run(wire)
        if not result['valid']:raise ValueError('Invalid mathematical assignment')
        pairs=result['pairs']
        if (len(pairs)!=min(len(owners),len(targets)) or len({p[0] for p in pairs})!=len(pairs) or
            len({p[1] for p in pairs})!=len(pairs) or any(a not in owners or b not in targets for a,b in pairs)):
            raise ValueError('Invalid projected responsibility')
        return result


def compile_policy(project:Path,build_dir:Path)->CppPolicy:
    """Compile only the versioned pure fixture, never a gameplay tree."""
    project=Path(project).resolve();build_dir=Path(build_dir).resolve()
    roots=(project/'.local',project/'.superpowers',Path(tempfile.gettempdir()).resolve())
    if not any(build_dir!=root and build_dir.is_relative_to(root) for root in roots):
        raise ValueError('Pure build must stay in project scratch')
    build_dir.mkdir(parents=True,exist_ok=True)
    if any(build_dir.iterdir()):raise ValueError('Pure build directory must be empty')
    vcvars=Path('C:/Program Files (x86)/Microsoft Visual Studio/2017/Community/VC/Auxiliary/Build/vcvarsall.bat')
    if not vcvars.is_file():raise ValueError('VS2017/v141 required')
    header=project/STUDY/'native/coordination_policy.hpp'
    fixture=project/'backend/tests/fixtures/grf/coordination_policy_fixture.cpp'
    exe=build_dir/'policy.exe'
    command=(f'call "{vcvars}" x64 >nul && cl.exe /nologo /std:c++14 /EHsc /W4 /WX '
        f'/I"{header.parent}" "{fixture}" /Fe:"{exe}" /Fo:"{build_dir / "policy.obj"}"')
    result=subprocess.run(f'cmd.exe /d /s /c "{command}"',capture_output=True,timeout=120,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
    if result.returncode:raise ValueError('Pure build failed: '+result.stdout.decode(errors='replace')[-2000:])
    return CppPolicy(exe)


def _check(snapshot):
    i=snapshot.identity
    if i!=snapshot.expected_identity:raise ValueError('Source/sample identity mismatch')
    if (not i.fixture_id or any(len(s)!=64 or any(c not in '0123456789abcdef' for c in s) for s in (i.source_sha256,i.trace_hash)) or
        any(type(n) is not int or n<0 for n in (i.sample_index,i.physics_ms,i.relocation_id)) or i.period not in (1,2)):
        raise ValueError('Invalid source/sample identity')
    if snapshot.payload_sha256!=_digest(_payload(snapshot)):raise ValueError('Sample payload binding changed')
    if snapshot.kind not in ('retained_frame','probe_cache','synthetic_fixture','native_transaction'):
        raise ValueError('Unknown snapshot origin')
    if snapshot.state_origin not in ('unavailable','synthetic_fixture','native_assignment_transaction','isolated_native_shadow'):
        raise ValueError('Unknown policy state origin')
    if snapshot.defending_team not in (0,1) or snapshot.dynamic_side not in (-1,1):raise ValueError('Invalid defending frame')
    ids=set()
    for p in snapshot.players:
        if (type(p.id) is not int or p.id<0 or p.id in ids or p.team not in (0,1) or
            not math.isfinite(p.position.x) or not math.isfinite(p.position.y)):
            raise ValueError('Invalid geometric actor')
        ids.add(p.id)
    if snapshot.native_input is not None:
        inp=snapshot.native_input
        if (inp.time_ms,inp.period,inp.team,inp.dynamic_side)!=(i.physics_ms,i.period,snapshot.defending_team,snapshot.dynamic_side):
            raise ValueError('Native input/sample identity mismatch')
        observed=lambda ps:sorted((p.id,p.team,p.active,p.keeper,p.position.x,p.position.y) for p in ps)
        if observed(inp.players)!=observed(snapshot.players):raise ValueError('Native/sample actor identity mismatch')


def _greedy(owners,targets,quality):
    free=list(range(len(owners)));total=0
    for col in range(len(targets)):
        if not free:break
        row=min(free,key=lambda r:(-quality[r][col],owners[r]));free.remove(row);total+=quality[row][col]
    return total


def evaluate_shadow(snapshot:ShadowSnapshot,policy:CppPolicy)->ShadowResult:
    _check(snapshot)
    coverage={k:'unavailable' for k in ('positions','native_quality','native_formations','native_ownership',
        'commitments','native_threat_ranking','native_eligibility','ball_prediction','policy_state')}
    coverage['positions']='available' if snapshot.players else 'unavailable'
    responsibilities=dict(native_marks=None,observed_prior_marks=None,supplied_policy_prior_marks=None,
        policy_state_origin=snapshot.state_origin,proposed_marks=None,projected_marks=None,
        projected_continuity=None,cover=None,observed_cover_role=None,proposed_formation_targets=None,native_formations=None,hunts=None)
    metrics=dict(unconstrained_quality=None,greedy_quality=None,constrained_quality=None,constrained_objective=None,
        projected_quality=None,actual_central_presence=None,actual_cover_role_presence=None)
    if snapshot.players and snapshot.ball_position is not None:
        ball=snapshot.ball_position
        metrics['actual_central_presence']=sum(p.active and not p.keeper and p.team==snapshot.defending_team and
            snapshot.dynamic_side*(p.position.x-ball.x)>=0 and abs(p.position.y)<=12 for p in snapshot.players)
    reasons=[];inp=snapshot.native_input;state=snapshot.native_state
    if snapshot.kind=='probe_cache':
        return ShadowResult(snapshot.identity,'unavailable',coverage,responsibilities,metrics,('cache_is_not_atomic_state',))
    trusted=snapshot.kind in ('synthetic_fixture','native_transaction')
    known_state=(snapshot.kind=='synthetic_fixture' and snapshot.state_origin=='synthetic_fixture') or (
        snapshot.kind=='native_transaction' and snapshot.state_origin in ('native_assignment_transaction','isolated_native_shadow'))
    complete=trusted and known_state and inp is not None and state is not None and all(
        p.formation is not None for p in inp.players if p.active and not p.keeper and p.team==inp.team)
    if complete:
        decision=policy.coordinate(inp,state)
        if not decision.valid:raise ValueError('Invalid complete policy snapshot')
        for key in coverage:coverage[key]='supplied_fixture' if snapshot.kind=='synthetic_fixture' else 'available'
        if snapshot.state_origin=='isolated_native_shadow':coverage['native_ownership']='unavailable'
        owners=[p for p in inp.players if p.team==inp.team and p.active and not p.keeper and not p.manual and not p.ball_contest]
        targets=[id for id in inp.threat_ids if next(p for p in inp.players if p.id==id).active]
        own_rows={p.id:r for r,p in enumerate(p for p in inp.players if p.team==inp.team)}
        q=tuple(tuple(inp.quality[own_rows[p.id]][inp.threat_ids.index(t)] for t in targets) for p in owners)
        global_result=policy.project([p.id for p in owners],targets,q)
        metrics.update(unconstrained_quality=global_result['quality'],greedy_quality=_greedy([p.id for p in owners],targets,q),
            constrained_quality=sum(inp.quality[own_rows[m.owner]][inp.threat_ids.index(m.target)] for m in decision.marks),
            constrained_objective=decision.objective if inp.assignment_tick and inp.play_eligible and inp.defending and
                'between_assignment_ticks' not in decision.reasons else None)
        supplied=[asdict(m) for m in state.marks]
        current_epoch=(state.time_ms>=0 and state.period==inp.period and state.team==inp.team and state.dynamic_side==inp.dynamic_side)
        observed=supplied if snapshot.state_origin=='native_assignment_transaction' and current_epoch else None
        if snapshot.kind=='native_transaction' and observed is None:coverage['native_ownership']='unavailable'
        responsibilities.update(observed_prior_marks=observed,supplied_policy_prior_marks=supplied,
            proposed_marks=[asdict(m) for m in decision.marks],native_marks=observed,
            cover=asdict(decision.cover) if decision.cover else None,hunts=list(decision.hunts),
            observed_cover_role=state.cover_id if observed is not None and state.cover_id>=0 else None,
            native_formations={str(p.id):asdict(p.formation) for p in owners},
            proposed_formation_targets=None)
        if decision.cover:responsibilities['cover']['status']='proposed_target_not_observed_coverage'
        if observed is not None and state.cover_id>=0 and snapshot.ball_position is not None:
            observed_cover=next((p for p in snapshot.players if p.id==state.cover_id),None)
            if observed_cover is not None:
                metrics['actual_cover_role_presence']=bool(inp.defending and inp.play_eligible and
                    observed_cover.active and observed_cover.team==snapshot.defending_team and
                    not observed_cover.keeper and not observed_cover.manual and not observed_cover.ball_contest and
                    snapshot.dynamic_side*(observed_cover.position.x-snapshot.ball_position.x)>=0 and abs(observed_cover.position.y)<=12)
        fidelity='synthetic_exact' if snapshot.kind=='synthetic_fixture' else 'native_snapshot_exact'
        return ShadowResult(snapshot.identity,fidelity,coverage,responsibilities,metrics,tuple(decision.reasons))
    if not snapshot.players:
        return ShadowResult(snapshot.identity,'unavailable',coverage,responsibilities,metrics,('missing_positions',))
    owners=[p for p in snapshot.players if p.team==snapshot.defending_team and p.active and not p.keeper]
    goal=Point(55*snapshot.dynamic_side,0)
    distance=lambda a,b:math.hypot(a.x-b.x,a.y-b.y)
    # This ranking/cost is explicitly geometric. It is never a native Q/ranking.
    targets=sorted((p for p in snapshot.players if p.team!=snapshot.defending_team and p.active and
        distance(p.position,goal)<=30),key=lambda p:(distance(p.position,goal),p.id))[:3]
    q=tuple(tuple(1/(1+distance(p.position,t.position)) for t in targets) for p in owners)
    projection=policy.project([p.id for p in owners],[p.id for p in targets],q)
    responsibilities.update(projected_marks=projection['pairs'],projected_continuity='cold_start_without_native_history')
    metrics.update(projected_quality=projection['quality'],projected_threats=[p.id for p in targets],
        projected_cost_model='inverse_distance_metres',projected_ranking='nearest_own_goal_within_30m')
    reasons.append('native_fields_missing_projection_only')
    if len(owners)<len(targets):reasons.append('projected_marks_degraded')
    if not targets:reasons.append('no_geometric_threat_within_30m')
    return ShadowResult(snapshot.identity,'geometric_projection',coverage,responsibilities,metrics,tuple(reasons))


def retained_snapshots(project:Path):
    """Only archived control/probe and C4 calibration; no heldout inputs."""
    project=Path(project).resolve();inputs=load_evidence_inputs(project)
    snapshots=[]
    for fixture in inputs.fixtures:
        if not fixture.id.startswith('c4/'):continue
        targets={}
        for shot in fixture.actions['shots']:
            if shot['origin']=='open_play_shot' and shot['context']['available']:
                targets.setdefault(shot['context']['frame_sample_index'],[]).append(shot)
        m=fixture.manifest;metadata={(0 if p['side']=='home' else 1,p['slot']):p for p in m['input']['players']}
        source=_sha(project/CONTINUATION/'evidence/c4/calibration'/fixture.id.split('/')[1]/'manifest.json')
        for chunk in fixture.chunks():
            for row in chunk.samples:
                for shot in targets.pop(int(row[0]),[]):
                    if row[7] or int(row[2])!=shot['period']:raise ValueError('Shadow sample crosses discontinuity')
                    players=[]
                    for team in (0,1):
                        for slot in range(11):
                            offset=21+(team*11+slot)*6
                            players.append(Player(team*11+slot,team,active=bool(row[offset+4]),keeper=metadata[team,slot]['role']=='GK',
                                position=Point(row[offset],row[offset+1]),formation=None))
                    identity=SampleIdentity(fixture.id,source,m['trace_hash'],int(row[0]),int(row[1]),int(row[2]),int(row[19]),shot['raw_event_seq'])
                    snapshots.append(seal_snapshot(ShadowSnapshot('retained_frame',identity,identity,tuple(players),
                        Point(row[-3],row[-2]),1-shot['actor_team'],shot['context']['attack_direction'])))
        if targets:raise ValueError('Missing selected C4 shadow frame')
    if len(snapshots)!=524:raise ValueError('C4 shadow denominator changed')
    source=_sha(project/'.local/grf-physical-work/defensive-probe/evidence/D-defense-42/defense.jsonl')
    indices={frame['sample_index'] for frame in inputs.probe_frames};contexts={}
    for chunk in inputs.fixtures[0].chunks():
        for row in chunk.samples:
            if int(row[0]) in indices:contexts[int(row[0])]=(int(row[1]),int(row[2]),int(row[19]))
    for frame in inputs.probe_frames:
        context=contexts.get(frame['sample_index'])
        if context is None or context[0]!=frame['physics_ms']:raise ValueError('Probe/replay sample identity mismatch')
        identity=SampleIdentity('T-actions/probe',source,inputs.fixtures[0].manifest['trace_hash'],
            frame['sample_index'],frame['physics_ms'],context[1],context[2])
        # Replay establishes period/relocation, not atomic cache ownership.
        snapshots.append(seal_snapshot(ShadowSnapshot('probe_cache',identity,identity,(),None,0,-1,
            cached_targets=tuple(frame['records']))))
    return snapshots,inputs.provenance


def main():
    import argparse
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project',type=Path,default=Path(__file__).resolve().parents[4])
    parser.add_argument('--build-dir',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args();project=args.project.resolve()
    if args.output.exists():raise ValueError('Shadow report already exists')
    started=time.monotonic();policy=compile_policy(project,args.build_dir)
    snapshots,provenance=retained_snapshots(project)
    results=[evaluate_shadow(s,policy).as_dict() for s in snapshots]
    counts={key:sum(r['decision_fidelity']==key for r in results) for key in
        ('synthetic_exact','native_snapshot_exact','geometric_projection','unavailable')}
    report=dict(schema_version='grf-coordination-shadow-1',fidelity_counts=counts,results=results,
        provenance=provenance,policy_version='k1-coordination-1',pure_binary_sha256=policy.sha256,
        runtime_seconds=time.monotonic()-started,result_digest=_digest(results),
        instrumentation_recommendation='prepare_offline_complete_snapshot_adapter',native_execution_authorized=False,
        source_sha256={name:_sha(project/name) for name in ('backend/src/timepitch/grf/coordination_shadow.py',
            STUDY+'/native/coordination_policy.hpp','backend/tests/fixtures/grf/coordination_policy_fixture.cpp')},
        limitations=['Geometric costs/ranking are projections; native Q/formations/ownership remain unavailable',
            'No counterfactual match outcomes; no physical policy admission',
            'Native snapshot exactness is a supported interface, not present in these retained inputs'])
    with args.output.open('x',encoding='utf-8',newline='\n') as stream:
        json.dump(report,stream,ensure_ascii=False,indent=2,sort_keys=True,allow_nan=False);stream.write('\n')


if __name__=='__main__':main()
