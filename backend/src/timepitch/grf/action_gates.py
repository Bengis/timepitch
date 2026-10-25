"""Fixed complete-split gates; no tuning or inference from contact counts."""
import math
import statistics
from .physical_wire import digest
from .candidate_wire import COUNTERS

GATES=('all_completed','coverage','distance_mean','distance_p95','effective_time','goals','extreme_scores',
       'shots','passes','release_classification','policy','policy_exercise','resources')


def _finite(value,low=0,high=math.inf):
    return type(value) in (int,float) and math.isfinite(value) and low<=value<=high


def evaluate_action_gates(rows:list[dict],*,expected:int,_research_candidate_id:str|None=None)->dict[str,bool]:
    if _research_candidate_id not in (None,'k1'):raise ValueError('Unknown research candidate')
    if type(expected) is not int or expected not in (8,24):raise ValueError('Require original8 calibration or24 heldout fixtures')
    failed=dict.fromkeys(GATES,False);split='calibration' if expected==8 else 'heldout'
    try:
        complete=(len(rows)==expected and {r['fixture_id'] for r in rows}=={f'{i:02}' for i in range(1,expected+1)} and
            all(r['status']=='ready' and r['split']==split for r in rows) and
            len({r['candidate_id'] for r in rows})==len({r['profile_identity'] for r in rows})==1 and
            rows[0]['candidate_id'] in (('c4','c5','k1') if _research_candidate_id=='k1' else ('c4','c5')))
        if not complete:return failed
        for r in rows:
            if (len(r['player_coverage'])!=22 or len(r['outfield_km'])!=20 or
                not all(_finite(v,0,1) for v in r['player_coverage']) or
                not all(_finite(v) for v in r['outfield_km']) or
                not all(_finite(r[k]) for k in ('goals','shots','passes','effective_minutes','seconds','peak_private_bytes')) or
                type(r['goals']) is not int or type(r['releases']) is not int or r['releases']<0 or
                not _finite(r['release_ratio'],0,1)):
                return failed
        distances=sorted(v for r in rows for v in r['outfield_km'])
        def mean(k):return statistics.fmean(r[k] for r in rows)
        policy=True
        for r in rows:
            c=r['policy_counters']
            policy=policy and r['policy_valid'] is True and set(c)==set(COUNTERS) and all(type(v) is int and 0<=v<2**63 for v in c.values())
            policy=policy and c['invalid_inputs']==0 and c['marking_raised']<=c['marking_eligible'] and c['area_slide_rejected']<=c['area_slide_eligible']
            if r['candidate_id'] in ('c4','k1'):policy=policy and c['area_slide_rejected']==0
        exercise=(split=='heldout' or sum(r['policy_counters']['marking_raised'] for r in rows)>0 and
            (rows[0]['candidate_id'] in ('c4','k1') or sum(r['policy_counters']['area_slide_rejected'] for r in rows)>0))
        return dict(all_completed=True,coverage=all(v>=.95 for r in rows for v in r['player_coverage']),
            distance_mean=8<=statistics.fmean(distances)<=14,distance_p95=distances[math.ceil(.95*len(distances))-1]<=16,
            effective_time=45<=mean('effective_minutes')<=70,goals=1.5<=mean('goals')<=4.5,
            extreme_scores=sum(r['goals']>9 for r in rows)<=1,shots=12<=mean('shots')<=50,passes=400<=mean('passes')<=1500,
            release_classification=all(r['releases']>0 and r['release_ratio']>=.95 for r in rows),policy=bool(policy),
            policy_exercise=bool(policy and exercise),resources=all(r['seconds']<=600 and r['peak_private_bytes']<=512*1024*1024 for r in rows))
    except (KeyError,TypeError,ValueError,OverflowError):return failed


def c5_eligibility(c4_report:dict)->dict:
    rows=c4_report.get('rows',[]);gates=evaluate_action_gates(rows,expected=8)
    reasons=[];bound={}
    if c4_report.get('candidate_id')!='c4' or c4_report.get('split')!='calibration':reasons.append('not_c4_calibration')
    if c4_report.get('gates')!=gates:reasons.append('report_gates_changed')
    if not all(v for k,v in gates.items() if k not in ('goals','extreme_scores')):reasons.append('non_score_gate_failed')
    if gates['goals'] and gates['extreme_scores']:reasons.append('c4_already_passes')
    confirmed=[]
    try:
        for r in rows:
            evidence=r['penalty_goal_evidence'];unique={e['goal_raw_seq'] for e in evidence}
            if (r['goal_classification_complete'] is not True or len(unique)!=len(evidence) or
                type(r['penalty_goals']) is not int or r['penalty_goals']!=len(evidence) or not 0<=len(evidence)<=r['goals'] or
                any(set(e)!={'goal_raw_seq','release_raw_seq','release_semantic_seq','restart_id','prepared_raw_seq','sanctioned_raw_seq','accepted_raw_seq'} or
                    any(type(v) is not int or v<0 for v in e.values()) for e in evidence)):
                raise ValueError('Unresolved goal/penalty identity')
            confirmed.append(r['goals']-len(evidence))
        if not rows or not any(r['penalty_goals']>0 for r in rows):reasons.append('no_confirmed_penalty_goal')
        if confirmed:
            mean=statistics.fmean(confirmed);extreme=sum(v>9 for v in confirmed)
            bound=dict(mean_goals_without_confirmed_penalties=mean,over_nine_without_confirmed_penalties=extreme,
                confirmed_penalty_goals=sum(r['penalty_goals'] for r in rows),interpretation='screening_bound_not_counterfactual')
            if not 1.5<=mean<=4.5 or extreme>1:reasons.append('penalty_bound_fails_score_gates')
    except (KeyError,TypeError,ValueError):reasons.append('unresolved_goal_classification')
    return dict(eligible=not reasons,reasons=reasons,penalty_bound=bound,source_report_sha256=digest(c4_report))
