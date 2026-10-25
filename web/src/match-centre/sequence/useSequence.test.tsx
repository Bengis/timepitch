import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useSequence } from './useSequence';
import { privateSequence } from './private-fixture';
import { AYEW_SEQUENCE } from './pilot';
import { syntheticAdapter, syntheticSnapshot } from '../unified-fixtures';
import type { SequenceSource } from './types';
afterEach(()=>vi.unstubAllGlobals());
it('profile_switch_cannot_publish_stale_source',async()=>{
  const {source}=await privateSequence(),a=syntheticAdapter(syntheticSnapshot(source.identity)),b=syntheticAdapter(syntheticSnapshot({...source.identity,revision:'other'}));
  let release!:(s:SequenceSource)=>void;
  a.adapter.loadSequence=vi.fn(()=>new Promise<SequenceSource>(r=>{release=r;}));
  b.adapter.loadSequence=vi.fn(async()=>{throw new Error('Wrong revision');});
  const {result,rerender}=renderHook(({adapter,request})=>useSequence(adapter,request),{initialProps:{adapter:a.adapter,request:AYEW_SEQUENCE as typeof AYEW_SEQUENCE|null}});
  await waitFor(()=>expect(a.adapter.loadSequence).toHaveBeenCalledOnce());
  rerender({adapter:b.adapter,request:AYEW_SEQUENCE});await act(async()=>release(source));
  await waitFor(()=>expect(result.current.status).toBe('unavailable'));expect(result.current.source).toBeNull();
  expect(vi.mocked(a.adapter.loadSequence).mock.calls[0][1].aborted).toBe(true); // Source hook never owns the playback adapter.
  rerender({adapter:b.adapter,request:null});expect(result.current.status).toBe('idle');expect(result.current.source).toBeNull();
});
it('rejects a stale digest and retries only after an explicit request',async()=>{
  const {source}=await privateSequence(),a=syntheticAdapter(syntheticSnapshot(source.identity));
  a.adapter.loadSequence=vi.fn().mockResolvedValueOnce(Object.freeze({...source,rawDigest:'a'.repeat(64)})).mockResolvedValue(source);
  const {result}=renderHook(()=>useSequence(a.adapter,AYEW_SEQUENCE));
  await waitFor(()=>expect(result.current.status).toBe('unavailable'));expect(result.current.source).toBeNull();
  expect(a.adapter.loadSequence).toHaveBeenCalledOnce();act(()=>result.current.retry());
  await waitFor(()=>expect(result.current.status).toBe('ready'));expect(result.current.source).toBe(source);expect(a.adapter.loadSequence).toHaveBeenCalledTimes(2);
});
