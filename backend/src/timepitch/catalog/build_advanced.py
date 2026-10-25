"""Reproducible standard-library build from immutable audited FPL CSV captures."""
import argparse,csv,io,json,re
from collections import defaultdict
from dataclasses import dataclass,asdict
from datetime import datetime,timezone
from decimal import Decimal,InvalidOperation
from hashlib import sha256
from pathlib import Path
from .advanced import FIELDS
from .models import HistoricalStatistic
from .repository import CLUB_NAMES

BUILDER_VERSION='advanced-builder-1'


@dataclass(frozen=True)
class BuildReport:
    dataset_version:str
    exact_duplicates_removed:int
    postponed_keys_resolved:int
    quarantined_keys:int
    linked_player_seasons:int
    unlinked_player_seasons:int
    fixtures_by_season:dict[int,int]
    positive_xg_fixtures:dict[int,int]


def number(value):
    try:
        result=Decimal(str(value))
        return result if result.is_finite() and result>=0 else None
    except (InvalidOperation,ValueError): return None


def timestamp(value):
    if not value: return None
    try: return datetime.fromisoformat(value.replace('Z','+00:00')).astimezone(timezone.utc).isoformat()
    except ValueError: return None


def canonical(value): return json.dumps(value,sort_keys=True,ensure_ascii=False,separators=(',',':'),allow_nan=False).encode('utf-8')


def club_name(name):
    normalize=lambda value:re.sub('[^a-z0-9]','',value.lower())
    aliases={normalize(k):k for k in CLUB_NAMES}
    aliases.update({normalize(v):k for k,v in CLUB_NAMES.items()})
    aliases.update({'manutd':'manunited','spurs':'tottenham','afcbournemouth':'bournemouth'})
    return aliases.get(normalize(name))


def build_supplement(source_root:Path,output_dir:Path)->BuildReport:
    source_root=source_root.resolve()
    output_dir=output_dir.resolve()
    if output_dir==source_root or source_root in output_dir.parents:
        raise ValueError('Supplement output must be outside the immutable source capture')
    inputs,encodings={},{}
    def read(path):
        if not path.is_file(): return []
        raw=path.read_bytes()
        relative=path.relative_to(source_root).as_posix()
        inputs[relative]=sha256(raw).hexdigest()
        encoding='utf-8-sig'
        try: text=raw.decode(encoding)
        except UnicodeDecodeError:
            known_legacy={f'raw/fpl/{year}/gws/merged_gw.csv' for year in ('2016-17','2017-18','2018-19')}
            if relative not in known_legacy: raise
            encoding='latin-1'
            text=raw.decode(encoding)
        encodings[relative]=encoding
        return list(csv.DictReader(io.StringIO(text)))
    memberships={f"fpl:{r['season_start']}:{r['club']}:{r['element']}":number(r['minutes']) or Decimal(0)
                 for r in read(source_root/'derived/fpl_player_season.csv')}
    master=read(source_root/'raw/fpl/data/master_team_list.csv')
    audited=read(source_root/'derived/field_fixture_coverage.csv')
    first_gw={(r['season'],r['field']):int(r['first_GW_with_nonzero_value']) for r in audited
              if r.get('first_GW_with_nonzero_value')}
    players,unlinked,quarantine={}, {}, []
    exact,postponed=0,0
    fixtures_by_season,positive_xg={},{}
    field_coverage,snapshots,nonstandard_starts={},{},{}
    timestamp_disagreements=[]
    player_discrepancies=[]
    for directory in sorted((source_root/'raw/fpl').glob('[0-9]*')):
        if not re.fullmatch(r'\d{4}-\d{2}',directory.name): continue
        year=int(directory.name[:4])
        if not 2016<=year<=2025: continue
        rows=read(directory/'gws/merged_gw.csv')
        if not rows: continue
        teams={int(r['team']):club_name(r['team_name']) for r in master if r['season']==directory.name}
        teams.update({int(r['id']):club_name(r['name']) for r in read(directory/'teams.csv')})
        fixtures={int(r['id']):r for r in read(directory/'fixtures.csv')}
        if not fixtures:
            grouped=defaultdict(list)
            for row in rows: grouped[row['fixture']].append(row)
            for id,members in grouped.items():
                home={int(r['opponent_team']) for r in members if r.get('was_home','').lower()=='false' and r.get('opponent_team')}
                away={int(r['opponent_team']) for r in members if r.get('was_home','').lower()=='true' and r.get('opponent_team')}
                if len(home)==len(away)==1:
                    fixtures[int(id)]={'id':id,'team_h':home.pop(),'team_a':away.pop()}
        fixtures_by_season[year]=len(fixtures)
        grouped=defaultdict(list)
        for row in rows: grouped[row['element'],row['fixture']].append(row)
        aggregates={}
        coverage={id:{'observed':set(),'positive':set()} for id in FIELDS}
        starts_bad=0
        for (element,fixture_id),alternatives in sorted(grouped.items()):
            unique={canonical(row):row for row in alternatives}
            exact+=len(alternatives)-len(unique)
            candidates=list(unique.values())
            fixture=fixtures.get(int(fixture_id))
            if len(candidates)>1 and fixture and fixture.get('kickoff_time'):
                candidates=[r for r in candidates if timestamp(r.get('kickoff_time'))==timestamp(fixture['kickoff_time'])]
                if len(candidates)==1: postponed+=1
            if len(candidates)!=1 or fixture is None:
                quarantine.append({'season':year,'element':element,'fixture':fixture_id,
                    'reason':'conflicting_rows' if len(candidates)!=1 else 'unresolved_fixture','rows':alternatives})
                continue
            row=candidates[0]
            home=row.get('was_home','').lower()=='true'
            club_id=int(fixture['team_h' if home else 'team_a'])
            opponent=int(fixture['team_a' if home else 'team_h'])
            club=teams.get(club_id)
            minutes=number(row.get('minutes'))
            if club is None or minutes is None or int(row.get('opponent_team') or -1)!=opponent:
                quarantine.append({'season':year,'element':element,'fixture':fixture_id,
                                   'reason':'invalid_relationship_or_exposure','rows':alternatives})
                continue
            if fixture.get('kickoff_time') and timestamp(row.get('kickoff_time'))!=timestamp(fixture['kickoff_time']):
                timestamp_disagreements.append({'season':year,'element':element,'fixture':fixture_id,
                    'observation':row.get('kickoff_time'),'fixture_time':fixture['kickoff_time']})
            key=f'fpl:{year}:{club}:{element}'
            aggregate=aggregates.setdefault(key,{'minutes':Decimal(0),'fixtures':set(),'fields':{
                id:{'value':Decimal(0),'minutes':Decimal(0),'fixtures':set(),'dates':set(),'present':False,'bad':False} for id in FIELDS}})
            aggregate['minutes']+=minutes
            aggregate['fixtures'].add(fixture_id)
            for id,field in FIELDS.items():
                item=aggregate['fields'][id]
                item['present'] |= field in row
                # The capture GW is the observed week, not the fixture's originally scheduled round.
                begin=first_gw.get((directory.name,field),16) if year==2022 and id in ('xg','xa','starts') else 1
                observed_gw=number(row.get('GW'))
                value=number(row.get(field))
                if value is None or (year==2022 and id in ('xg','xa','starts') and (observed_gw is None or observed_gw<begin)): continue
                item['value']+=value
                item['minutes']+=minutes
                item['fixtures'].add(fixture_id)
                date=timestamp(fixture.get('kickoff_time') or row.get('kickoff_time'))
                if date: item['dates'].add(date)
                if id=='starts' and value not in (0,1): item['bad']=True;starts_bad+=1
                coverage[id]['observed'].add(fixture_id)
                if value>0: coverage[id]['positive'].add(fixture_id)
        for key,aggregate in sorted(aggregates.items()):
            stats={}
            total_minutes=max(aggregate['minutes'],memberships.get(key,Decimal(0)))
            total_fixtures=len(aggregate['fixtures'])
            for id,item in aggregate['fields'].items():
                covered=len(item['fixtures'])
                status='unavailable' if not covered else 'partial' if covered<total_fixtures or item['minutes']<total_minutes or item['bad'] else 'measured'
                reason=('field_not_in_source' if not item['present'] else 'no_covered_observations') if not covered else (
                    'source_nonstandard_starts' if item['bad'] else 'partial_field_coverage' if status=='partial' else None)
                unit='xG' if id=='xg' else 'xA' if id=='xa' else 'count'
                data=dict(source='fpl:match_observations',status=status,unit=unit,
                    covered_minutes=float(item['minutes']),fixtures_covered=covered,fixtures_total=total_fixtures,
                    coverage_from=min(item['dates']) if item['dates'] else None,
                    coverage_to=max(item['dates']) if item['dates'] else None,reason=reason)
                stats[id]=HistoricalStatistic(value=float(item['value']) if covered else None,**data).model_dump()
                if id!='starts':
                    data['unit']=unit+'/90'
                    if covered and item['minutes']==0: data.update(status='unavailable',reason='zero_minutes')
                    value=float(item['value']*90/item['minutes']) if item['minutes'] else None
                    stats[id+'_per90']=HistoricalStatistic(value=value,**data).model_dump()
            if year>=2018 and key in memberships: players[key]=stats
            else: unlinked[key]={'reason':'catalog_uses_epldata' if year<2018 else 'no_catalog_membership','stats':stats}
        positive_xg[year]=len(coverage['xg']['positive'])
        field_coverage[year]={id:{'fixtures_covered':len(item['observed']),'fixtures_positive':len(item['positive']),
                                  'fixtures_total':len(fixtures)} for id,item in coverage.items()}
        nonstandard_starts[year]=starts_bad
        snapshot_rows=read(directory/'players_raw.csv')
        source_sums=defaultdict(Decimal)
        source_seen=set()
        for key,aggregate in aggregates.items():
            element=key.rsplit(':',1)[-1]
            for id,item in aggregate['fields'].items():
                if item['fixtures']:
                    source_sums[element,id]+=item['value']
                    source_seen.add((element,id))
        reconciliation={}
        for id,field in FIELDS.items():
            measured=[number(row.get(field)) for row in snapshot_rows]
            measured=[n for n in measured if n is not None]
            if not measured: continue
            available=any(metric==id for _,metric in source_seen)
            observed=sum((value for (_,metric),value in source_sums.items() if metric==id),Decimal(0)) if available else None
            annual=sum(measured,Decimal(0))
            reconciliation[id]={'match_sum':float(observed) if observed is not None else None,
                               'snapshot_sum':float(annual),'difference':float(observed-annual) if observed is not None else None}
        for row in snapshot_rows:
            element=row['id']
            for id,field in FIELDS.items():
                annual=number(row.get(field))
                if annual is None: continue
                observed=source_sums[element,id] if (element,id) in source_seen else None
                if observed is None or observed!=annual:
                    player_discrepancies.append({'season':year,'element':element,'field':id,
                        'match_sum':float(observed) if observed is not None else None,'snapshot_sum':float(annual),
                        'difference':float(observed-annual) if observed is not None else None,
                        'reason':'no_covered_observations' if observed is None else 'source_snapshot_disagrees'})
        snapshots[year]=reconciliation
    payload={'format_version':'advanced-1','builder_version':BUILDER_VERSION,'players':players,'unlinked':unlinked}
    raw=canonical(payload)
    version='sha256:'+sha256(raw).hexdigest()
    report=BuildReport(version,exact,postponed,len(quarantine),len(players),len(unlinked),fixtures_by_season,positive_xg)
    manifest={'format_version':'advanced-manifest-1','builder_version':BUILDER_VERSION,'report':asdict(report),
        'inputs':dict(sorted(inputs.items())),'input_encodings':dict(sorted(encodings.items())),
        'field_fixture_coverage':field_coverage,'snapshot_reconciliation':snapshots,
        'nonstandard_starts':nonstandard_starts,'quarantine':quarantine,
        'timestamp_disagreements':timestamp_disagreements,
        'player_snapshot_discrepancies':player_discrepancies,
        'coverage_rule_2022':'captured GW >= audited first covered GW; zeros within coverage remain measured'}
    # Recheck every input before writing any derived artifact.
    for name,digest in inputs.items():
        if sha256((source_root/name).read_bytes()).hexdigest()!=digest: raise ValueError('Source changed during build')
    output_dir.mkdir(parents=True,exist_ok=True)
    (output_dir/'advanced-1.json').write_bytes(raw)
    (output_dir/'manifest.json').write_bytes(canonical(manifest))
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    print(json.dumps(asdict(build_supplement(args.source,args.output)),sort_keys=True))
