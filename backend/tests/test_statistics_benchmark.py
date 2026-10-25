from hashlib import sha256
from pathlib import Path
import json
from timepitch.catalog.repository import CatalogRepository
from timepitch.simulation.engine import make_config
from timepitch.statistics.benchmark import benchmark,league_configs,league_seed,compare_results

DATASET=Path(__file__).resolve().parents[2]/'research/data-audit/2026-10-16/derived/coverage.sqlite'


def test_calendar_seed_order_and_original_configuration_are_explicit():
    catalog=CatalogRepository(DATASET)
    configs=league_configs(catalog,202526)
    assert len(configs)==380
    assert len({(c.home_key,c.away_key) for c in configs})==380
    assert configs[0].home_key=='liverpool:2025' and configs[0].away_key=='bournemouth:2025'
    expected=int.from_bytes(sha256(b'timepitch|2025|202526|0|liverpool|bournemouth').digest()[:4],'big')
    assert league_seed(202526,'liverpool','bournemouth')==expected==configs[0].seed


def test_comparison_uses_independent_actual_results_and_does_not_invent_a_pass_reference():
    config={'home_key':'arsenal:2025','away_key':'mancity:2025'}
    rows=[{'config':config,'home':{'goals':0,'shots':4,'passes':7},'away':{'goals':1,'shots':2,'passes':5},'players':[]}]
    actual=[{'home':'arsenal','away':'mancity','home_goals':2,'away_goals':1,'home_shots':10,'away_shots':5}]
    result=compare_results(rows,actual)
    assert result['goals']['actual']==3 and result['goals']['simulated']==1
    assert result['goals']['difference']==-2
    assert result['shots']['actual']==15 and result['shots']['simulated']==6
    assert result['passes']['actual'] is None and result['passes']['simulated']==12
    assert result['passes']['status']=='no_matching_reference'
    assert result['retrospective'] is True


def test_small_real_benchmark_preserves_versions_and_can_resume_without_resimulating(tmp_path,monkeypatch):
    import timepitch.statistics.benchmark as module
    catalog=CatalogRepository(DATASET)
    config=make_config(catalog,'arsenal:2025','mancity:2025',42)
    original=config.model_dump()
    report=benchmark([config],catalog,tmp_path)
    assert report.completed==1
    raw=(tmp_path/'results.jsonl').read_bytes()
    row=json.loads(raw)
    assert row['config']==original and config.model_dump()==original
    assert row['versions']['engine']=='engine-2' and row['versions']['metrics']=='metrics-1'
    assert sum(p['goals'] for p in row['players'])==row['home']['goals']+row['away']['goals']
    assert sum(p['simulated_minutes'] for p in row['players'])==22*90
    assert 'motion' not in row and 'plots' not in row
    monkeypatch.setattr(module,'_simulate',lambda *_: (_ for _ in ()).throw(AssertionError('must resume')))
    assert benchmark([config],catalog,tmp_path).completed==1
    assert (tmp_path/'results.jsonl').read_bytes()==raw
