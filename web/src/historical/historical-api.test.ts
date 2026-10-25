import {afterEach,expect,it,vi} from 'vitest';
import {SegmentCache,readEvents} from './api';
afterEach(()=>vi.unstubAllGlobals());
it('bounded sequence reads reject changing totals and totals above the clip cap',async()=>{
  const signal=new AbortController().signal;
  vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({dataset_version:'v1',match_id:9,total:2,items:[{id:'a'}]})))
    .mockResolvedValueOnce(new Response(JSON.stringify({dataset_version:'v1',match_id:9,total:3,items:[{id:'b'},{id:'c'}]}))));
  await expect(readEvents(9,1,0,20000,'v1',signal,100)).rejects.toThrow(/page/i);
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({dataset_version:'v1',match_id:9,total:101,items:[]}))));
  await expect(readEvents(9,1,0,20000,'v1',signal,100)).rejects.toThrow(/limit/i);
});
it('reads every event page with the abort signal and rejects dataset drift',async()=>{
  const signal=new AbortController().signal;
  const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({dataset_version:'v1',match_id:9,total:2,items:[{id:'a'}]})))
    .mockResolvedValueOnce(new Response(JSON.stringify({dataset_version:'v1',match_id:9,total:2,items:[{id:'b'}]})));
  vi.stubGlobal('fetch',fetcher);
  expect((await readEvents(9,1,0,60000,'v1',signal)).map(e=>e.id)).toEqual(['a','b']);
  expect(fetcher.mock.calls[1][0]).toContain('offset=1');
  expect(fetcher.mock.calls[0][1].signal).toBe(signal);
  fetcher.mockResolvedValue(new Response(JSON.stringify({dataset_version:'v2',match_id:9,total:0,items:[]})));
  await expect(readEvents(9,1,0,60000,'v1',signal)).rejects.toThrow();
});
it('keeps at most three segments, keyed by dataset, reconstruction and match',async()=>{
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>new Response(JSON.stringify({reconstruction_id:'r',match_id:9,period:1,index:Number(url.split('/').at(-1)),frames:[],anchors:[],cuts:[]}))));
  const cache=new SegmentCache('v1','r',9);
  for(let i=0;i<4;i++)await cache.load(1,i,new AbortController().signal);
  expect(cache.size).toBe(3);
  await cache.load(1,3,new AbortController().signal);
  expect(fetch).toHaveBeenCalledTimes(4);
  await cache.load(1,0,new AbortController().signal);
  expect(fetch).toHaveBeenCalledTimes(5);
});
it('rejects oversized segments and responses for a different reconstruction',async()=>{
  const cache=new SegmentCache('v1','r',9),signal=new AbortController().signal;
  const fetcher=vi.fn().mockResolvedValueOnce(new Response(' '.repeat(4*1024*1024+1)))
    .mockResolvedValueOnce(new Response(JSON.stringify({reconstruction_id:'other',match_id:9,period:1,index:0})));
  vi.stubGlobal('fetch',fetcher);
  await expect(cache.load(1,0,signal)).rejects.toThrow('payload limit');
  await expect(cache.load(1,0,signal)).rejects.toThrow('identity changed');
  expect(cache.size).toBe(0);
});
it('aborting halfway through event pagination never publishes a partial window',async()=>{
  let finish!:(response:Response)=>void;
  const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({dataset_version:'v1',match_id:9,total:2,items:[{id:'a'}]})))
    .mockImplementationOnce(()=>new Promise<Response>(resolve=>{finish=resolve;}));
  vi.stubGlobal('fetch',fetcher);const control=new AbortController(),read=readEvents(9,1,0,60000,'v1',control.signal);
  await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(2));control.abort();
  finish(new Response(JSON.stringify({dataset_version:'v1',match_id:9,total:2,items:[{id:'b'}]})));
  await expect(read).rejects.toMatchObject({name:'AbortError'});expect(fetcher).toHaveBeenCalledTimes(2);
});
it('bounds the cumulative payload across event pages',async()=>{
  const large='x'.repeat(6*1024*1024);
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({dataset_version:'v1',match_id:9,total:2,items:[{id:'test',details:large}]}))));
  const rejected=await readEvents(9,1,0,60000,'v1',new AbortController().signal).then(()=>false,()=>true);
  expect(rejected).toBe(true);
});
