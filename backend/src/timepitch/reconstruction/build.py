"""Build new local candidates offline; never called by an HTTP request."""
import argparse
from bisect import bisect_left,bisect_right
from collections import Counter
import hashlib
import json
from pathlib import Path
import time

from ..historical.participation import build_participation
from ..historical.repository import HistoricalRepository
from ..historical.source import canonical,digest
from .anchors import extract_anchors
from .models import (MotionProfile,ReconstructionCatalog,ReconstructionCatalogEntry,ReconstructionManifest,
                     ReconstructionSegment,SegmentReference)
from .motion import reconstruct_period

MAX_MANIFEST=1024**2
MAX_SEGMENT=4*1024**2


def _validate_placed(motion,roster):
    frames={f.period_ms:f for f in motion.frames}
    indexes={p.key:p.index for p in roster}
    for anchor in motion.anchors:
        if anchor.status!='placed':continue
        frame=frames[anchor.period_ms]
        point=frame.ball if anchor.entity_key=='ball' else next(((x,y) for idx,x,y in frame.players if idx==indexes[anchor.entity_key]),None)
        if point!=(anchor.location.x,anchor.location.y):
            raise ValueError('Placed anchor differs from its exact observation')


def build_reconstruction(dataset: HistoricalRepository,match_id: int,output_dir: Path,profile: MotionProfile) -> ReconstructionManifest:
    match=dataset.get_match(match_id)
    events=dataset._all_events(match_id)
    participation=build_participation(match,events)
    anchors=extract_anchors(match,events,participation)
    output_dir=Path(output_dir)
    output_dir.mkdir(parents=True,exist_ok=False)
    identity={'dataset_version':dataset.dataset_version,'match_id':match_id,'profile':profile.model_dump(mode='json')}
    reconstruction_id='sha256:'+hashlib.sha256(canonical(identity)).hexdigest()
    references=[];counts=Counter();cuts=Counter();missing=duration=0
    issues=list(anchors.issues)
    sufficient=(bool(events) and match.status!='excluded' and bool(anchors.roster) and
                not any(i.startswith('unknown_starting_xi') for i in participation.issues))
    for part in participation.clock.periods if sufficient else []:
        if part.duration_ms is None or part.period>4:
            issues.append(f'unavailable_period:{part.period}')
            continue
        motion=reconstruct_period(match,part.period,anchors,participation,profile)
        _validate_placed(motion,anchors.roster)
        counts.update(a.status for a in motion.anchors)
        cuts.update(c.reason for c in motion.cuts)
        duration+=motion.duration_ms;missing+=motion.ball_unavailable_ms
        times=[f.period_ms for f in motion.frames]
        source_times={a.event_id:a.period_ms for a in motion.anchors if a.period_ms is not None and a.id.endswith((':actor',':ball:origin'))}
        # Exactly one owning segment per anchor, including unusable endpoint metadata.
        owned={a.id:min(max(0,(a.period_ms if a.period_ms is not None else source_times.get(a.event_id,0))//profile.segment_ms),
                          max(0,(motion.duration_ms-1)//profile.segment_ms)) for a in motion.anchors}
        for index,start in enumerate(range(0,motion.duration_ms,profile.segment_ms)):
            end=min(motion.duration_ms,start+profile.segment_ms)
            final=end==motion.duration_ms
            frames=motion.frames[bisect_left(times,start):(bisect_right(times,end) if final else bisect_left(times,end))]
            rows=[a for a in motion.anchors if owned[a.id]==index]
            segment_cuts=[c for c in motion.cuts if c.from_ms<end and c.to_ms>=start or final and c.from_ms==end]
            unavailable=sum(max(0,min(end,b)-max(start,a)) for a,b,_ in motion.ball_unavailable_ranges)
            partial=bool(unavailable or any(a.status!='placed' for a in rows) or issues)
            segment=ReconstructionSegment(reconstruction_id=reconstruction_id,match_id=match_id,
                period=part.period,index=index,from_ms=start,to_ms=end,includes_period_end=final,
                status='partial' if partial else 'ready',frames=frames,anchors=rows,cuts=segment_cuts,ball_unavailable_ms=unavailable)
            body=segment.model_dump_json().encode('utf-8')
            if len(body)>MAX_SEGMENT:
                raise ValueError('Reconstruction segment exceeds 4 MiB; candidate not accepted')
            (output_dir/f'{part.period}-{index}.json').write_bytes(body)
            references.append(SegmentReference(period=part.period,index=index,from_ms=start,to_ms=end,
                bytes=len(body),sha256=hashlib.sha256(body).hexdigest(),status=segment.status))
        # Release this whole-period solution before constructing the next period.
        del motion,frames,segment
    if not sufficient:
        issues.append('historical_facts_insufficient')
    status='unavailable' if not references else 'partial' if issues or any(r.status=='partial' for r in references) else 'ready'
    manifest=ReconstructionManifest(reconstruction_id=reconstruction_id,dataset_version=dataset.dataset_version,
        match_id=match_id,profile=profile,roster=anchors.roster,segments=references,status=status,issues=sorted(set(issues)),
        anchor_counts=dict(counts),cut_counts=dict(cuts),ball_unavailable_ms=missing,duration_ms=duration)
    body=manifest.model_dump_json().encode('utf-8')
    if len(body)>MAX_MANIFEST:raise ValueError('Reconstruction manifest exceeds 1 MiB')
    (output_dir/'manifest.json').write_bytes(body)
    return manifest


def seal_catalog(dataset: HistoricalRepository,root: Path) -> ReconstructionCatalog:
    root=Path(root);entries=[]
    if (root/'index.json').exists():raise ValueError('Catalog already sealed; build a new candidate')
    for folder in sorted(root.iterdir(),key=lambda p:p.name):
        if folder.is_dir() and folder.name.isdecimal():
            path=folder/'manifest.json'
            manifest=ReconstructionManifest.model_validate_json(path.read_bytes())
            if manifest.match_id!=int(folder.name) or manifest.dataset_version!=dataset.dataset_version:
                raise ValueError('Reconstruction identity mismatch')
            entries.append(ReconstructionCatalogEntry(match_id=manifest.match_id,manifest_bytes=path.stat().st_size,manifest_sha256=digest(path)))
    catalog=ReconstructionCatalog(dataset_version=dataset.dataset_version,entries=sorted(entries,key=lambda e:e.match_id))
    body=catalog.model_dump_json().encode('utf-8')
    if len(body)>MAX_MANIFEST:raise ValueError('Catalog too large')
    (root/'index.json').write_bytes(body)
    return catalog


def peak_rss_bytes():
    import os,sys
    if os.name!='nt':
        import resource
        value=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        return int(value if sys.platform=='darwin' else value*1024)
    import ctypes
    from ctypes import wintypes
    class Counters(ctypes.Structure):
        _fields_=[('cb',wintypes.DWORD),('PageFaultCount',wintypes.DWORD)]+[(name,ctypes.c_size_t) for name in
            ('PeakWorkingSetSize','WorkingSetSize','QuotaPeakPagedPoolUsage','QuotaPagedPoolUsage',
             'QuotaPeakNonPagedPoolUsage','QuotaNonPagedPoolUsage','PagefileUsage','PeakPagefileUsage')]
    kernel=ctypes.WinDLL('kernel32',use_last_error=True);psapi=ctypes.WinDLL('psapi',use_last_error=True)
    kernel.GetCurrentProcess.restype=wintypes.HANDLE;kernel.GetCurrentProcess.argtypes=[]
    psapi.GetProcessMemoryInfo.argtypes=[wintypes.HANDLE,ctypes.POINTER(Counters),wintypes.DWORD]
    psapi.GetProcessMemoryInfo.restype=wintypes.BOOL
    counters=Counters();counters.cb=ctypes.sizeof(counters)
    if not psapi.GetProcessMemoryInfo(kernel.GetCurrentProcess(),ctypes.byref(counters),counters.cb):
        raise ctypes.WinError(ctypes.get_last_error())
    if counters.PeakWorkingSetSize<=0:raise ValueError('Invalid memory measurement')
    return counters.PeakWorkingSetSize


_worker_dataset=None


def _worker_init(dataset_path):
    global _worker_dataset
    _worker_dataset=HistoricalRepository(Path(dataset_path))


def _build_one(match_id,root,profile):
    start=time.perf_counter()
    manifest=build_reconstruction(_worker_dataset,match_id,Path(root)/str(match_id),profile)
    wall=time.perf_counter()-start
    peak=peak_rss_bytes()
    if wall>120 or peak>512*1024**2:
        raise ValueError('Reconstruction worker exceeded time/memory gate; catalogue not sealed')
    return {'match_id':match_id,'status':manifest.status,'wall_s':wall,'peak_rss_bytes':peak,
            'segments':len(manifest.segments),'largest_segment_bytes':max((s.bytes for s in manifest.segments),default=0),
            'anchor_counts':manifest.anchor_counts,'duration_ms':manifest.duration_ms,
            'ball_unavailable_ms':manifest.ball_unavailable_ms,'reconstruction_id':manifest.reconstruction_id}


def build_catalog(dataset,root,match_ids,*,workers=1):
    """Explicit offline batch; at most two own CPU workers, never server admission."""
    from concurrent.futures import ProcessPoolExecutor,as_completed
    import multiprocessing
    if workers not in (1,2):raise ValueError('Only one or two offline workers allowed')
    ids=sorted(set(match_ids))
    if not ids or any(type(i) is not int or i<=0 for i in ids):raise ValueError('Invalid match list')
    root=Path(root).resolve();root.mkdir(parents=True,exist_ok=False)
    start=time.perf_counter();rows=[];profile=MotionProfile()
    if workers==1:
        # Reuse the already verified immutable source in the calling process.
        global _worker_dataset
        _worker_dataset=dataset
        for match_id in ids:
            rows.append(_build_one(match_id,root,profile))
            print(json.dumps({'built':len(rows),'total':len(ids),'match_id':match_id}),flush=True)
    else:
        with ProcessPoolExecutor(max_workers=workers,mp_context=multiprocessing.get_context('spawn'),
                                 initializer=_worker_init,initargs=(str(dataset.root),)) as pool:
            jobs=[pool.submit(_build_one,match_id,str(root),profile) for match_id in ids]
            try:
                for future in as_completed(jobs):
                    rows.append(future.result())
                    print(json.dumps({'built':len(rows),'total':len(ids),'match_id':rows[-1]['match_id']}),flush=True)
            except BaseException:
                for job in jobs:job.cancel()
                raise
    seal_catalog(dataset,root)
    report={'dataset_version':dataset.dataset_version,'fixtures':len(rows),'counts':dict(Counter(r['status'] for r in rows)),
        'workers':workers,'wall_s':time.perf_counter()-start,'peak_worker_rss_bytes':max(r['peak_rss_bytes'] for r in rows),
        'largest_segment_bytes':max(r['largest_segment_bytes'] for r in rows),'gates_passed':True,
        'matches':sorted(rows,key=lambda r:r['match_id'])}
    (root/'build-report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    return report


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dataset',type=Path,required=True)
    parser.add_argument('--output-dir',type=Path,required=True,help='New catalogue candidate root')
    scope=parser.add_mutually_exclusive_group(required=True)
    scope.add_argument('--match-id',type=int)
    scope.add_argument('--all',action='store_true')
    parser.add_argument('--workers',type=int,choices=(1,2),default=1)
    args=parser.parse_args()
    start=time.perf_counter()
    dataset=HistoricalRepository(args.dataset)
    if args.all:
        result=build_catalog(dataset,args.output_dir,[m.id for m in dataset.manifest.matches],workers=args.workers)
        print(json.dumps({k:v for k,v in result.items() if k!='matches'}),flush=True)
        return
    result=build_reconstruction(dataset,args.match_id,args.output_dir/str(args.match_id),MotionProfile())
    seal_catalog(dataset,args.output_dir)
    print(json.dumps({'match_id':result.match_id,'status':result.status,'wall_s':time.perf_counter()-start,
        'peak_rss_bytes':peak_rss_bytes(),'manifest_bytes':(args.output_dir/str(args.match_id)/'manifest.json').stat().st_size,
        'largest_segment_bytes':max((r.bytes for r in result.segments),default=0),
        'segments':len(result.segments),'anchor_counts':result.anchor_counts,'cut_counts':result.cut_counts,
        'duration_ms':result.duration_ms,'ball_unavailable_ms':result.ball_unavailable_ms,'reconstruction_id':result.reconstruction_id}))


if __name__=='__main__':main()
