"""Compile the same pure placement function used by the native test hook."""
import json
import os
from pathlib import Path
import subprocess
import pytest
from test_grf_action_observer import ROOT,VCVARS


@pytest.mark.skipif(not VCVARS.is_file(),reason='Existing v141 compiler required')
def test_pressure_is_in_front_of_both_defenders_and_inside_forward_pass_lanes(tmp_path):
    patch=ROOT/'research/engine-evaluation/2026-10-17-grf-actions/native-fixture-pressure.patch'
    assert patch.is_file(),'Missing corrected native fixture placement'
    lines=patch.read_text(encoding='utf-8').splitlines(keepends=True)
    begin=lines.index('+++ b/src/action_fixture_geometry.hpp\n')+1
    header=''.join(line[1:] for line in lines[begin:] if line.startswith('+') and not line.startswith('+++'))
    (tmp_path/'action_fixture_geometry.hpp').write_text(header,encoding='utf-8')
    cpp=tmp_path/'geometry.cpp'
    cpp.write_text('#include "action_fixture_geometry.hpp"\n#include <cstdio>\nint main(){printf("[%g,%g]",timepitch_fixture::PressureOpponentX(-46,-1),timepitch_fixture::PressureOpponentX(46,1));}',encoding='utf-8')
    exe=tmp_path/'geometry.exe'
    command=f'call "{VCVARS}" x64 >nul && cl.exe /nologo /EHsc "{cpp}" /Fe:"{exe}" /Fo:"{tmp_path / "geometry.obj"}"'
    compiled=subprocess.run(f'cmd.exe /d /s /c "{command}"',capture_output=True,creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
    assert compiled.returncode==0,compiled.stdout.decode(errors='replace')
    result=subprocess.run([str(exe)],capture_output=True,check=True)
    assert json.loads(result.stdout)==[-45.5,45.5]


def test_legacy_action_pin_is_still_admitted_but_cannot_finish_as_a_new_binary():
    from grf_action_fixtures import action_trace
    from timepitch.grf.action_models import LEGACY_ACTION_NATIVE_SHA256,ACTION_NATIVE_SHA256
    from timepitch.grf.action_codec import ActionStreamValidator
    m,blocks=action_trace();v=ActionStreamValidator(m.input,LEGACY_ACTION_NATIVE_SHA256)
    for c in blocks:v.append(c)
    assert ACTION_NATIVE_SHA256!=LEGACY_ACTION_NATIVE_SHA256
    with pytest.raises(ValueError,match='native'):v.finish(m)
