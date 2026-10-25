"""Independent archived-clock replay; original outcomes are never regenerated."""
from dataclasses import asdict
import importlib
import importlib.util
from pathlib import Path
import json

import pytest
from grf_offline_guard import offline_only
from timepitch.grf.physical_clock import ClockState, ClockObservation, advance_clock


def api():
    name='timepitch.grf.m1_clock_compatibility'
    assert importlib.util.find_spec(name), 'Missing retained clock comparison'
    return importlib.import_module(name)


def source_rows(end,stop=True):
    for i,t in enumerate(range(0,end+1,100)):
        row=[0.]*156
        row[:13]=[i,t,1,t,0,int(not(stop and t==end)),0,0,0,0,0,0,0]
        yield row


def test_identical_retained_prefix_has_no_invented_finish():
    report=api().compare_clock_rows(source_rows(1000),complete=False)
    assert report['compatible'] and report['samples']==11
    assert not report['finished'] and report['fallback_count']==0


def test_changed_control_is_reported_blocked_not_relabelled_equivalent():
    report=api().compare_clock_rows(source_rows(2820000,stop=False),complete=True)
    assert not report['compatible'] and report['fallback_count']==1
    assert report['first_difference']['physics_ms']==2820000


def test_original_clock_oracle_is_independent_from_shared_seam():
    def changed(state,o):
        from dataclasses import replace
        return replace(advance_clock(state,o),allowance_ms=1)
    report=api().compare_clock_rows(source_rows(1000),complete=False,legacy_advance=changed)
    assert not report['compatible']
    assert report['first_difference']['physics_ms']==0


def test_gapped_or_corrupt_source_rows_are_never_declared_compatible():
    rows=list(source_rows(1000));rows[1][1]=200
    report=api().compare_clock_rows(rows,complete=False)
    assert not report['compatible'] and report['error']


def test_recorded_manifest_must_agree_with_recomputed_clock():
    report=api().compare_clock_rows(source_rows(1000),complete=False,
         manifest={'duration_ms':2000,'periods':[],'ledger':[]})
    assert not report['compatible']


def test_missing_saved_control_yields_blocked_report(tmp_path):
    result=api().audit_saved_clocks(tmp_path)
    assert result['status']=='blocked' and result['native_attempts_created']==0


def test_archived_oracle_never_writes_bytecode_into_immutable_archive(tmp_path):
    m=api()
    path=tmp_path/m.ARCHIVE/'source/backend/src/timepitch/grf/physical_clock.py'
    path.parent.mkdir(parents=True)
    path.write_bytes(b'class ClockState: pass\n')
    assert m._archived_clock(tmp_path).ClockState
    assert [p for p in (tmp_path/m.ARCHIVE).rglob('*') if p.is_file()]==[path]


def test_real_retained_inventory_is_compared_without_native_execution(tmp_path):
    root=Path(__file__).resolve().parents[2]
    if not (root/'.local/grf-m1-worker-tp058-source-archive').exists():
        pytest.skip('Private retained evidence not present in this checkout')
    report=api().audit_saved_clocks(root)
    (tmp_path/'clock-compatibility.json').write_text(json.dumps(report,indent=2,ensure_ascii=False),encoding='utf-8')
    # Offline comparison may honestly block future native evaluation. Either
    # verdict needs an inventoried result for each required saved stream.
    assert report['status'] in ('compatible','blocked')
    assert len(report['complete_controls'])==12
    assert report['failed_prefix']['samples']==60000
    assert report['failed_prefix']['last_physics_ms']==5999800
    assert report['native_attempts_created']==0
    assert report['heldout_outcomes_read']==0
