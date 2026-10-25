"""Opt-in aggregate timings, also importable by the standalone Python 3.10 worker.

Diagnostics never belong to the replay. No native imports, per-frame history,
request bodies or arbitrary stderr text are retained here.
"""
import json
import logging
import math
import os
import time

PROFILE_ENV='TIMEPITCH_GRF_PROFILE'
PROFILE_PREFIX='TIMEPITCH_GRF_PROFILE_V1 '
MAX_PROFILE_BYTES=8192
MAX_NS=86400*10**9
WORKER_STAGES=frozenset((
    'payload_decode','setup_import','grf_imports','scenario_config','environment_init',
    'create_core','attributes','telemetry_enable','core_step','observation',
    'get_info','match_state','stats_state','sample_conversion','touch_drain',
    'stats_drain','event_normalize','result_assembly','core_close','json_output',
    'json_encode','json_write',
))


class StageTimings:
    def __init__(self,enabled,*,clock=None):
        self.enabled=enabled
        self.clock=clock or time.perf_counter_ns
        self.started=self.clock() if enabled else 0
        self.timings={};self.calls={};self.native_step_ns=None

    def start(self):
        return self.clock() if self.enabled else 0

    def stop(self,name,start):
        if self.enabled:
            self.timings[name]=self.timings.get(name,0)+max(0,self.clock()-start)
            self.calls[name]=self.calls.get(name,0)+1

    def call(self,name,function,*args,**kwargs):
        if not self.enabled:return function(*args,**kwargs)
        start=self.start()
        try:return function(*args,**kwargs)
        finally:self.stop(name,start)

    def report(self):
        if not self.enabled:return None
        return dict(wall_ns=max(0,self.clock()-self.started),
                    timings_ns=dict(self.timings),calls=dict(self.calls))

    def native_delta(self,before,after):
        if self.enabled and all(type(v) in (int,float) and math.isfinite(v) for v in (before,after)):
            delta=after-before
            if 0<=delta<=86400:self.native_step_ns=round(delta*10**9)


def emit_worker_profile(timing,input_hash,status,stream):
    if not timing.enabled:return
    report=dict(schema='grf-worker-profile-1',input_hash=input_hash,status=status,
                **timing.report(),native_step_ns=timing.native_step_ns)
    try:
        raw=json.dumps(report,separators=(',',':'),allow_nan=False)
        if len(raw.encode('utf-8'))<=MAX_PROFILE_BYTES:
            stream.write('\n'+PROFILE_PREFIX+raw+'\n');stream.flush()
    except (OSError,ValueError):pass


def _integer(value,limit):
    return type(value) is int and 0<=value<=limit


def _unique(pairs):
    result={}
    for key,value in pairs:
        if key in result:raise ValueError('Duplicate diagnostic key')
        result[key]=value
    return result


def read_worker_profile(stderr,input_hash):
    """Read one bounded, identity-bound frame; never return raw child stderr."""
    prefix=PROFILE_PREFIX.encode('ascii')
    frames=[line[len(prefix):] for line in stderr.splitlines() if line.startswith(prefix)]
    if not frames:return 'missing',None
    if len(frames)!=1 or len(frames[0])>MAX_PROFILE_BYTES:return 'invalid',None
    try:
        value=json.loads(frames[0],object_pairs_hook=_unique)
        if not isinstance(value,dict) or set(value)!={'schema','input_hash','status','wall_ns','timings_ns','calls','native_step_ns'}:
            raise ValueError('Diagnostic fields')
        if value['schema']!='grf-worker-profile-1' or value['input_hash']!=input_hash or value['status'] not in ('passed','failed'):
            raise ValueError('Diagnostic identity')
        if not _integer(value['wall_ns'],MAX_NS):raise ValueError('Diagnostic duration')
        timings=value['timings_ns'];calls=value['calls']
        if not isinstance(timings,dict) or not isinstance(calls,dict) or set(timings)!=set(calls) or not set(timings)<=WORKER_STAGES:
            raise ValueError('Diagnostic stages')
        if not all(_integer(v,value['wall_ns']) for v in timings.values()):raise ValueError('Diagnostic spans')
        if not all(_integer(v,10000000) and v>0 for v in calls.values()):raise ValueError('Diagnostic counts')
        if value['native_step_ns'] is not None and not _integer(value['native_step_ns'],value['wall_ns']):
            raise ValueError('Native duration')
        return 'available',value
    except (ValueError,TypeError,RecursionError,UnicodeError):return 'invalid',None


def write_private_profile(path,report):
    """Exclusive creation; caller supplies a private directory (Windows ACL).

    POSIX files are mode 0600. Profiling I/O never replaces the match outcome.
    """
    try:
        raw=(json.dumps(report,separators=(',',':'),allow_nan=False)+'\n').encode('utf-8')
        fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|getattr(os,'O_BINARY',0),0o600)
        with os.fdopen(fd,'wb') as stream:stream.write(raw)
    except (OSError,ValueError):
        logging.getLogger(__name__).warning('GRF profiling report could not be written')
