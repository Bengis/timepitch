"""Small process-memory guard, without adding a monitoring dependency."""
import os


def private_bytes(child):
    if os.name=='nt':
        import ctypes
        from ctypes import wintypes
        class Counters(ctypes.Structure):
            _fields_=[('cb',wintypes.DWORD),('faults',wintypes.DWORD)]+[(name,ctypes.c_size_t) for name in (
                'peak_working','working','peak_paged','paged','peak_nonpaged','nonpaged','pagefile','peak_pagefile','private')]
        value=Counters();value.cb=ctypes.sizeof(value)
        if not ctypes.windll.psapi.GetProcessMemoryInfo(wintypes.HANDLE(child._handle),ctypes.byref(value),value.cb):
            if child.poll() is not None:return 0
            raise OSError('Cannot inspect worker memory')
        return max(value.private,value.peak_pagefile)
    # The prepared runtime is Windows; keep the guard useful in portable test runs.
    try:
        from pathlib import Path
        fields=(Path('/proc')/str(child.pid)/'status').read_text().splitlines()
        return next(int(line.split()[1])*1024 for line in fields if line.startswith('VmRSS:'))
    except (OSError,StopIteration):
        if child.poll() is not None:return 0
        raise OSError('Cannot inspect worker memory')
