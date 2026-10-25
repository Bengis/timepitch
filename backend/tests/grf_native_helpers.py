"""Bounded real-engine fixtures; never substitutes simulated telemetry."""
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]


def run_native_case(case: str, native_dir: Path, *, capacity: int = 20000) -> dict:
    python = ROOT / '.local/grf-spike/python/python.exe'
    assert python.is_file() and (native_dir/'_gameplayfootball.pyd').is_file(), 'Native acceptance requires its prepared runtime'
    result = subprocess.run([str(python), '-X', 'utf8', str(Path(__file__).parent/'fixtures/grf/stats_native_fixture.py'),
                             str(native_dir), case, str(capacity)], capture_output=True, timeout=120,
                            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    assert result.returncode == 0, result.stderr.decode('utf-8',errors='replace')[-4000:]
    assert len(result.stdout) <= 16*1024*1024
    return json.loads(result.stdout)


def run_native_input(request,native_dir:Path)->dict:
    """Control run through the same standalone runner, without version admission."""
    python=ROOT/'.local/grf-spike/python/python.exe'
    runner=ROOT/'backend/src/timepitch/grf/native_runner.py'
    result=subprocess.run([str(python),'-X','utf8',str(runner),str(native_dir)],
        input=request.model_dump_json().encode('utf-8'),capture_output=True,timeout=120,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
    assert result.returncode==0,result.stderr.decode('utf-8',errors='replace')[-4000:]
    assert len(result.stdout)<=16*1024*1024
    return json.loads(result.stdout)
