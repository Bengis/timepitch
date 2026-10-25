import csv,json,shutil
from hashlib import sha256
from pathlib import Path
import pytest
from timepitch.catalog.build_advanced import build_supplement
from timepitch.catalog.advanced import AdvancedCatalogRepository
from timepitch.catalog.repository import CatalogRepository

FIXTURES=Path(__file__).parent/'fixtures/advanced'
DATASET=Path(__file__).resolve().parents[2]/'research/data-audit/2026-10-16/derived/coverage.sqlite'


def write_csv(path,rows):
    path.parent.mkdir(parents=True,exist_ok=True)
    fields=list(dict.fromkeys(k for row in rows for k in row))
    with path.open('w',encoding='utf-8',newline='') as stream:
        writer=csv.DictWriter(stream,fieldnames=fields)
        writer.writeheader();writer.writerows(rows)


def source(tmp_path):
    root=tmp_path/'source'
    year=root/'raw/fpl/2022-23'
    (year/'gws').mkdir(parents=True)
    shutil.copyfile(FIXTURES/'partial-2022.csv',year/'gws/merged_gw.csv')
    shutil.copyfile(FIXTURES/'fixtures-2022.csv',year/'fixtures.csv')
    write_csv(year/'teams.csv',[{'id':1,'name':'Arsenal'},{'id':2,'name':'Man City'}])
    (root/'derived').mkdir()
    shutil.copyfile(FIXTURES/'memberships.csv',root/'derived/fpl_player_season.csv')
    return root


def digest_tree(root):
    return {str(p.relative_to(root)):sha256(p.read_bytes()).hexdigest() for p in root.rglob('*.csv')}


def test_partial_denominator_measured_zero_transfer_and_same_named_players_are_kept_separate(tmp_path):
    root=source(tmp_path)
    build_supplement(root,tmp_path/'out')
    repo=AdvancedCatalogRepository(tmp_path/'out/advanced-1.json')
    partial=repo.player_stats('fpl:2022:arsenal:1')
    assert partial['xg'].value==.4 and partial['xg'].status=='partial'
    assert partial['xg'].covered_minutes==180
    assert partial['xg'].fixtures_covered==2 and partial['xg'].fixtures_total==3
    assert partial['xg_per90'].value==pytest.approx(.2)
    assert repo.player_stats('fpl:2022:arsenal:2')['xg'].value==0
    city=repo.player_stats('fpl:2022:mancity:1')
    assert city['xg'].value==.1 and city['xg'].covered_minutes==45
    assert city['tackles'].value is None
    assert repo.player_stats('epldata:2022:arsenal:1')['xg'].value is None


def test_build_is_reproducible_and_sources_stay_byte_identical(tmp_path):
    root=source(tmp_path)
    before=digest_tree(root)
    first=build_supplement(root,tmp_path/'a')
    second=build_supplement(root,tmp_path/'b')
    assert first==second
    assert (tmp_path/'a/advanced-1.json').read_bytes()==(tmp_path/'b/advanced-1.json').read_bytes()
    assert (tmp_path/'a/manifest.json').read_bytes()==(tmp_path/'b/manifest.json').read_bytes()
    assert before==digest_tree(root)


def test_duplicates_postponed_actual_kickoff_and_irreconcilable_rows_are_not_summed(tmp_path):
    root=source(tmp_path)
    year=root/'raw/fpl/2025-26'
    teams=[{'id':1,'name':'Arsenal'},{'id':2,'name':'Man City'}]
    write_csv(year/'teams.csv',teams)
    write_csv(year/'fixtures.csv',[{'id':10,'team_h':1,'team_a':2,'kickoff_time':'2026-02-01T15:00:00Z'}])
    row={'element':7,'fixture':10,'minutes':90,'GW':20,'opponent_team':2,'was_home':'True',
         'kickoff_time':'2026-02-01T15:00:00Z','expected_goals':.3,'tackles':4}
    write_csv(year/'gws/merged_gw.csv',[row,row,dict(row,element=9,expected_goals=1),dict(row,element=9,expected_goals=2)])
    old=root/'raw/fpl/2019-20'
    write_csv(old/'teams.csv',teams)
    write_csv(old/'fixtures.csv',[{'id':10,'team_h':1,'team_a':2,'kickoff_time':'2020-06-01T15:00:00Z'}])
    write_csv(old/'gws/merged_gw.csv',[dict(row,element=8,kickoff_time='2020-03-01T15:00:00Z',minutes=0,tackles=0),
                                          dict(row,element=8,kickoff_time='2020-06-01T15:00:00Z')])
    membership=list(csv.DictReader((root/'derived/fpl_player_season.csv').open(encoding='utf-8')))
    membership += [{'season_start':2025,'club':'arsenal','element':7,'minutes':90},
                   {'season_start':2025,'club':'arsenal','element':9,'minutes':90},
                   {'season_start':2019,'club':'arsenal','element':8,'minutes':90}]
    write_csv(root/'derived/fpl_player_season.csv',membership)
    report=build_supplement(root,tmp_path/'out')
    assert report.exact_duplicates_removed==1
    assert report.postponed_keys_resolved==1
    assert report.quarantined_keys==1
    repo=AdvancedCatalogRepository(tmp_path/'out/advanced-1.json')
    assert repo.player_stats('fpl:2025:arsenal:7')['xg'].value==.3
    assert repo.player_stats('fpl:2019:arsenal:8')['tackles'].value==4
    assert repo.player_stats('fpl:2025:arsenal:9')['xg'].value is None
    assert json.loads((tmp_path/'out/manifest.json').read_text())['quarantine']


def test_missing_fixtures_are_reconstructed_from_opponents_and_unlinked_source_ids_stay_unlinked(tmp_path):
    root=source(tmp_path)
    write_csv(root/'raw/fpl/data/master_team_list.csv',[{'season':'2016-17','team':1,'team_name':'Arsenal'},
                                                       {'season':'2016-17','team':2,'team_name':'Man City'}])
    common={'fixture':99,'minutes':90,'GW':1,'kickoff_time':'2016-08-01T15:00:00Z','tackles':2,'name':'Jos\u00e9 Example'}
    write_csv(root/'raw/fpl/2016-17/gws/merged_gw.csv',[
        dict(common,element=1,opponent_team=2,was_home='True'),dict(common,element=2,opponent_team=1,was_home='False')])
    legacy=root/'raw/fpl/2016-17/gws/merged_gw.csv'
    legacy.write_bytes(legacy.read_text(encoding='utf-8').encode('latin-1'))
    report=build_supplement(root,tmp_path/'out')
    assert report.fixtures_by_season[2016]==1
    payload=json.loads((tmp_path/'out/advanced-1.json').read_text())
    assert 'fpl:2016:arsenal:1' in payload['unlinked']
    repo=AdvancedCatalogRepository(tmp_path/'out/advanced-1.json')
    assert repo.player_stats('fpl:2016:arsenal:1')['tackles'].value is None
    assert json.loads((tmp_path/'out/manifest.json').read_text())['input_encodings']['raw/fpl/2016-17/gws/merged_gw.csv']=='latin-1'


def test_missing_supplement_is_graceful_and_loaded_changes_require_restart(tmp_path):
    repo=AdvancedCatalogRepository(tmp_path/'missing.json')
    assert repo.dataset_version is None
    assert repo.player_stats('fpl:2022:arsenal:1')['xg'].reason=='missing_supplement'
    root=source(tmp_path)
    build_supplement(root,tmp_path/'out')
    path=tmp_path/'out/advanced-1.json'
    repo=AdvancedCatalogRepository(path)
    path.write_bytes(path.read_bytes()+b' ')
    with pytest.raises(ValueError,match='restart'): repo.player_stats('fpl:2022:arsenal:1')
    catalog=CatalogRepository(DATASET,advanced_path=tmp_path/'missing.json')
    assert len(catalog.list_teams())==686
    assert catalog.get_team('arsenal:2025').players[0].advanced_stats['xg'].reason=='missing_supplement'


def test_single_observation_with_delayed_kickoff_metadata_is_retained_and_reported(tmp_path):
    root=source(tmp_path)
    path=root/'raw/fpl/2022-23/fixtures.csv'
    rows=list(csv.DictReader(path.open(encoding='utf-8')))
    rows[1]['kickoff_time']='2022-11-01T15:30:00Z'
    write_csv(path,rows)
    report=build_supplement(root,tmp_path/'out')
    assert report.quarantined_keys==0
    assert AdvancedCatalogRepository(tmp_path/'out/advanced-1.json').player_stats('fpl:2022:arsenal:1')['xg'].value==.4
    assert json.loads((tmp_path/'out/manifest.json').read_text())['timestamp_disagreements']


def test_snapshot_reconciliation_aggregates_transfer_memberships_by_source_id_without_hiding_discrepancies(tmp_path):
    root=source(tmp_path)
    write_csv(root/'raw/fpl/2022-23/players_raw.csv',[
        {'id':1,'team':2,'expected_goals':.9},{'id':2,'team':1,'expected_goals':.1}])
    build_supplement(root,tmp_path/'out')
    manifest=json.loads((tmp_path/'out/manifest.json').read_text())
    reconciliation=manifest['snapshot_reconciliation']['2022']['xg']
    assert reconciliation['match_sum']==.5 and reconciliation['snapshot_sum']==1
    discrepancies=manifest['player_snapshot_discrepancies']
    player=next(r for r in discrepancies if r['element']=='1' and r['field']=='xg')
    assert player['match_sum']==.5 and player['difference']==-.4


def test_built_real_supplement_matches_audited_coverage_and_keeps_the_basic_catalogue():
    root=DATASET.parents[0].parent
    output=Path(__file__).resolve().parents[2]/'data/advanced'
    manifest=json.loads((output/'manifest.json').read_text(encoding='utf-8'))
    report=manifest['report']
    assert report['exact_duplicates_removed']==10 and report['postponed_keys_resolved']==59
    assert report['quarantined_keys']==0
    assert report['fixtures_by_season']['2025']==380
    assert report['positive_xg_fixtures']['2022']==244
    assert all(row['difference']==0 for row in manifest['snapshot_reconciliation']['2025'].values())
    for name,digest in manifest['inputs'].items(): assert sha256((root/name).read_bytes()).hexdigest()==digest
    catalog=CatalogRepository(DATASET,advanced_path=output/'advanced-1.json')
    assert len(catalog.list_teams())==686
    assert len({t.club for t in catalog.list_teams()})==51
    assert len({t.season_start for t in catalog.list_teams()})==34
    current=catalog.get_team('arsenal:2025')
    assert current.advanced_dataset_version==report['dataset_version']
    assert current.coverage['advanced']=='fields_vary'
    for player in current.players:
        assert player.advanced_stats['xg'].covered_minutes==player.stats['minutes'].value
        assert player.advanced_stats['xg'].status=='measured'
    zero=next(p for p in current.players if p.advanced_stats['xg'].value==0)
    assert zero.advanced_stats['xg'].status=='measured'
    assert all(p.advanced_stats['xg'].value is None for p in catalog.get_team('arsenal:2003').players)
    from timepitch.simulation.ratings import build_team_profile,get_league_baseline
    basic=CatalogRepository(DATASET)
    assert build_team_profile(current,get_league_baseline(catalog,2025))==build_team_profile(
        basic.get_team('arsenal:2025'),get_league_baseline(basic,2025))
