"""Retrospective, resumable CPU benchmarks; never creates replay/runtime databases or AI calls."""
import argparse,csv,json,os,time
from collections import Counter,defaultdict
from concurrent.futures import ProcessPoolExecutor,as_completed
from dataclasses import dataclass,asdict
from functools import lru_cache
from hashlib import sha256
from pathlib import Path
from ..catalog.repository import CatalogRepository
from ..config import DATASET,ADVANCED_DATASET
from ..simulation.engine import make_config,run_match
from ..simulation.observations import NullObserver,CompositeObserver
from ..runtime import RuntimeLease
from .reducer import AdvancedReducer


@dataclass(frozen=True)
class BenchmarkReport:
    completed:int
    result_path:str
    comparison:dict


def canonical(value):return json.dumps(value,sort_keys=True,ensure_ascii=False,separators=(',',':'),allow_nan=False).encode('utf-8')


def atomic(path,value):
    temp=path.with_suffix(path.suffix+'.tmp')
    temp.write_bytes(canonical(value));temp.replace(path)


def league_seed(base,home,away,season=2025):
    return int.from_bytes(sha256(f'timepitch|{season}|{base}|0|{home}|{away}'.encode()).digest()[:4],'big')


def league_configs(catalog,base,season=2025):
    with catalog.connection() as db:
        fixtures=db.execute("SELECT date,home,away FROM matches WHERE source='football-data' AND season_start=? ORDER BY date,home,away",(season,)).fetchall()
    if len(fixtures)!=380 or len({(r['home'],r['away']) for r in fixtures})!=380:
        raise ValueError('Benchmark requires a complete, unique 380-fixture calendar')
    return [make_config(catalog,f"{r['home']}:{season}",f"{r['away']}:{season}",league_seed(base,r['home'],r['away'],season)) for r in fixtures]


class CachedCatalog(CatalogRepository):
    @lru_cache(maxsize=128)
    def _team(self,key):return super().get_team(key)
    def get_team(self,key):
        self._assert_unchanged()
        return self._team(key)


class Counts(NullObserver):
    def __init__(self):self.goals=Counter();self.shots=Counter();self.initial=None
    def on_start(self,frame):self.initial=frame
    def on_event(self,event):
        if event.type=='goal':self.goals[event.participants[0]]+=1
        if event.type=='shot':self.shots[event.participants[0]]+=1


def _simulate(config,catalog):
    advanced,counts=AdvancedReducer(),Counts()
    start=time.perf_counter()
    metrics=run_match(config,catalog,CompositeObserver(advanced,counts))
    statistics=advanced.result(5400000)
    duration=time.perf_counter()-start
    assert metrics.home.possession_ms+metrics.away.possession_ms==5400000
    assert sum(counts.goals.values())==metrics.home.goals+metrics.away.goals
    members={side:{p.key:p for p in catalog.get_team(getattr(config,side+'_key')).players} for side in ('home','away')}
    people=[]
    for player in counts.initial.players:
        source_key=player.key[len(player.side)+1:]
        historical=members[player.side][source_key]
        people.append({'key':player.key,'source_key':source_key,'name':player.name,'side':player.side,'role':player.role,
            'historical_minutes':historical.stats['minutes'].value,'historical_goals':historical.stats['goals'].value,
            'simulated_minutes':90,'goals':counts.goals[player.key],'shots':counts.shots[player.key],
            'distance_m':statistics.by_player[player.key]['distance_m'].value})
    return {'config':config.model_dump(mode='json'),'versions':{'engine':'engine-2','rules':'rules-2','ratings':'ratings-1','metrics':'metrics-1'},
        'generation_s':round(duration,6),'home':metrics.home.model_dump(),'away':metrics.away.model_dump(),'players':people,
        'advanced':{side:{id:value.model_dump(exclude={'event_ids','sample_ranges'}) for id,value in values.items()} for side,values in statistics.by_team.items()}}


def _actual(catalog,configs):
    seasons={int(c.home_key.rsplit(':',1)[1]) for c in configs if c.home_key.rsplit(':',1)[1]==c.away_key.rsplit(':',1)[1]}
    result=[]
    for year in sorted(seasons):
        with catalog.connection() as db:
            matches=db.execute("SELECT * FROM matches WHERE source='football-data' AND season_start=? ORDER BY date,home,away",(year,)).fetchall()
        source=catalog.path.parent.parent/'raw/football-data'/f'{year}-{str(year+1)[-2:]}.csv'
        shots={}
        if source.is_file():
            with source.open(encoding='utf-8-sig',newline='') as stream:
                for row in csv.DictReader(stream):
                    shots[row['HomeTeam'],row['AwayTeam']]=(int(row['HS']) if row.get('HS') else None,int(row['AS']) if row.get('AS') else None)
        for row in matches:
            hs,aws=shots.get((row['HomeTeam'],row['AwayTeam']),(None,None))
            result.append({'season':year,'date':row['date'],'home':row['home'],'away':row['away'],
                'home_goals':row['FTHG'],'away_goals':row['FTAG'],'home_shots':hs,'away_shots':aws})
    return result


def standings(matches):
    table=defaultdict(lambda:{'played':0,'points':0,'goals_for':0,'goals_against':0})
    for row in matches:
        for side,rival in (('home','away'),('away','home')):
            team=table[row[side]];gf,ga=row[side+'_goals'],row[rival+'_goals']
            team['played']+=1;team['goals_for']+=gf;team['goals_against']+=ga
            team['points']+=3 if gf>ga else 1 if gf==ga else 0
    ordered=sorted(table,key=lambda c:(-table[c]['points'],-(table[c]['goals_for']-table[c]['goals_against']),-table[c]['goals_for'],c))
    return [{'club':club,'rank':i+1,**table[club]} for i,club in enumerate(ordered)]


def compare_results(rows,actual):
    lookup={(r.get('season',2025),r['home'],r['away']):r for r in actual}
    simulated,reference=[],[]
    for row in rows:
        home,year=row['config']['home_key'].rsplit(':',1)
        away,away_year=row['config']['away_key'].rsplit(':',1)
        match=lookup.get((int(year),home,away)) if year==away_year else None
        if match is not None:reference.append(match)
        simulated.append({'home':home,'away':away,'home_goals':row['home']['goals'],'away_goals':row['away']['goals']})
    result={'retrospective':True,'fixtures':len(rows),'reference_fixtures':len(reference),
        'lineup_limitation':'fixed automatic XI, no substitutions or rotation; final-season inputs are not a forecast',
        'tiebreak':'points, goal difference, goals for, stable club; not full Premier tiebreak rules'}
    for metric in ('goals','shots','passes'):
        observed=None if metric=='passes' or len(reference)!=len(rows) else sum(r[side+'_'+metric] for r in reference for side in ('home','away')) if all(r.get(side+'_'+metric) is not None for r in reference for side in ('home','away')) else None
        predicted=sum(row[side][metric] for row in rows for side in ('home','away'))
        result[metric]={'actual':observed,'simulated':predicted,'difference':predicted-observed if observed is not None else None,
            'status':'comparable_counts' if observed is not None else 'no_matching_reference'}
    result['simulated_standings']=standings(simulated)
    result['actual_standings']=standings(reference)
    if len(reference)==len(rows):
        actual_by={r['club']:r for r in result['actual_standings']}
        result['club_mae']={metric:sum(abs(r[metric]-actual_by[r['club']][metric]) for r in result['simulated_standings'])/len(actual_by)
                           for metric in ('rank','points','goals_for')}
    result['advanced_comparability']={
        'simulated_xg':'descriptive_only; generative probability differs from recorded FPL xG',
        'xg_assisted':'not FPL xA or Fantasy assists','tackles':'simulated attempts differ from recorded provider taxonomy',
        'distance_m':'no historical tracking reference in this capture',
        'starts':'count comparable; inspect per-player simulated versus recorded exposure'}
    return result


def _source_hashes():
    root=Path(__file__).resolve().parents[1]
    files=[*root.glob('simulation/*.py'),*root.glob('statistics/*.py')]
    files=[p for p in files if p.name not in ('benchmark.py','service.py')]
    return {p.relative_to(root).as_posix():sha256(p.read_bytes()).hexdigest() for p in sorted(files)}


def _historical_summary(catalog,rows):
    simulated=Counter();exposure=Counter();names={}
    for row in rows:
        for p in row['players']:
            source,year,_,element=p['source_key'].split(':',3)
            key=f'{source}:{year}:{element}'
            simulated[key]+=p['goals'];exposure[key]+=p['simulated_minutes'];names[key]=p['name']
    actual=Counter();minutes=Counter();advanced=defaultdict(lambda:defaultdict(float))
    seen_teams={row['config'][side+'_key'] for row in rows for side in ('home','away')}
    for key in sorted(seen_teams):
        for p in catalog.get_team(key).players:
            source,year,_,element=p.key.split(':',3)
            id=f'{source}:{year}:{element}'
            actual[id]+=p.stats['goals'].value or 0;minutes[id]+=p.stats['minutes'].value or 0;names[id]=p.name
            for field,value in p.advanced_stats.items():
                if not field.endswith('_per90') and value.value is not None:advanced[field]['recorded_sum']+=value.value
    scorers=[{'id':id,'name':names[id],'simulated_goals':simulated[id],'recorded_goals':actual[id],
              'simulated_minutes':exposure[id],'recorded_minutes':minutes[id]} for id in sorted(names)]
    scorers.sort(key=lambda p:(-p['simulated_goals'],p['id']))
    return scorers,dict(advanced)


def benchmark(configs,catalog,output_dir)->BenchmarkReport:
    output_dir=Path(output_dir).resolve()
    capture=catalog.path.parent.parent
    if output_dir==capture or capture in output_dir.parents:raise ValueError('Benchmark cannot write inside source capture')
    output_dir.mkdir(parents=True,exist_ok=True)
    with RuntimeLease(output_dir/'.benchmark.lock'):
        hashes=_source_hashes()
        plan={'version':'benchmark-1','dataset':catalog.dataset_version,'advanced_dataset':catalog.advanced.dataset_version,
            'simulation_sources':hashes,'configs_sha256':sha256(canonical([c.model_dump(mode='json') for c in configs])).hexdigest(),'count':len(configs)}
        plan_path=output_dir/'plan.json'
        if plan_path.exists() and json.loads(plan_path.read_text(encoding='utf-8'))!=plan:raise ValueError('Benchmark plan changed; use a separate output directory')
        if not plan_path.exists():atomic(plan_path,plan)
        checkpoints=output_dir/'.checkpoints';checkpoints.mkdir(exist_ok=True)
        (checkpoints/'.gitignore').write_text('*\n',encoding='utf-8')
        rows=[];started=time.perf_counter()
        for i,config in enumerate(configs):
            digest=sha256(canonical(config.model_dump(mode='json'))).hexdigest()
            checkpoint=checkpoints/(digest+'.json')
            if checkpoint.exists():
                row=json.loads(checkpoint.read_text(encoding='utf-8'))
                if row['config']!=config.model_dump(mode='json'):raise ValueError('Invalid benchmark checkpoint')
            else:
                row=_simulate(config,catalog);atomic(checkpoint,row)
            rows.append(row)
            if (i+1)%10==0 or i+1==len(configs):
                progress={'completed':i+1,'total':len(configs),'output':output_dir.name,'elapsed_s':round(time.perf_counter()-started,2)}
                atomic(output_dir/'progress.json',progress);print(json.dumps(progress),flush=True)
        if hashes!=_source_hashes():raise ValueError('Simulation sources changed during benchmark; results require review')
        result_path=output_dir/'results.jsonl'
        temp=result_path.with_suffix('.jsonl.tmp')
        with temp.open('wb') as stream:
            for row in rows:stream.write(canonical(row)+b'\n')
        temp.replace(result_path)
        comparison=compare_results(rows,_actual(catalog,configs))
        scorers,historical_advanced=_historical_summary(catalog,rows)
        comparison['recorded_advanced']=historical_advanced
        comparison['simulated_advanced']={id:sum(row['advanced'][side][id]['value'] or 0 for row in rows for side in ('home','away'))
            for id in ('simulated_xg','key_passes','xg_assisted','distance_m','hsr_distance_m','sprint_count')}
        atomic(output_dir/'summary.json',comparison);atomic(output_dir/'scorers.json',scorers)
        for title in ('actual_standings','simulated_standings'):
            with (output_dir/(title+'.csv')).open('w',encoding='utf-8',newline='') as stream:
                writer=csv.DictWriter(stream,fieldnames=['club','rank','played','points','goals_for','goals_against'])
                writer.writeheader();writer.writerows(comparison[title])
        return BenchmarkReport(len(rows),str(result_path),comparison)


def _calendar(base,dataset,advanced,output,season):
    catalog=CachedCatalog(Path(dataset),Path(advanced))
    return asdict(benchmark(league_configs(catalog,base,season),catalog,Path(output)/str(base)))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--season',type=int,default=2025)
    parser.add_argument('--bases',type=int,nargs='+',default=[202526,202527,202528])
    parser.add_argument('--workers',type=int,choices=(1,2,3),default=3)
    args=parser.parse_args()
    args.output.mkdir(parents=True,exist_ok=True)
    with ProcessPoolExecutor(max_workers=min(args.workers,len(args.bases),os.cpu_count() or 1)) as pool:
        jobs=[pool.submit(_calendar,base,str(DATASET),str(ADVANCED_DATASET),str(args.output.resolve()),args.season) for base in args.bases]
        reports=[job.result() for job in as_completed(jobs)]
    atomic(args.output/'runs.json',reports)
    print(json.dumps({'completed':sum(r['completed'] for r in reports),'runs':len(reports)}),flush=True)
