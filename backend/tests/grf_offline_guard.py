"""Explicit guard for research tests that must not execute a native match."""
import builtins
import sys
from pathlib import Path
import subprocess
import pytest


@pytest.fixture(autouse=True)
def offline_only(monkeypatch):
    original_import=builtins.__import__; original_open=Path.open
    def guarded_import(name,*args,**kwargs):
        if name.split('.')[0] in ('gfootball','gfootball_engine','_gameplayfootball'):
            raise AssertionError('Native GRF import forbidden in offline phase')
        return original_import(name,*args,**kwargs)
    def guarded_open(path,*args,**kwargs):
        if 'heldout' in path.parts: raise AssertionError('Heldout outcome read forbidden')
        return original_open(path,*args,**kwargs)
    def no_child(*args,**kwargs): raise AssertionError('Child process forbidden in clock phase')
    class NoNative:
        def find_spec(self,name,path=None,target=None):
            if name.split('.')[0] in ('gfootball','gfootball_engine','_gameplayfootball'):
                raise AssertionError('Native GRF import forbidden in offline phase')
            return None
    monkeypatch.setattr(builtins,'__import__',guarded_import)
    monkeypatch.setattr(Path,'open',guarded_open)
    monkeypatch.setattr(subprocess,'Popen',no_child)
    monkeypatch.setattr(sys,'meta_path',[NoNative(),*sys.meta_path])
