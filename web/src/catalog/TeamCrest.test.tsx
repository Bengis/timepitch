import {fireEvent,render,screen} from '@testing-library/react';
import {describe,expect,it} from 'vitest';
import {TeamCrest,resolveHistoricalCrest} from './TeamCrest';

describe('historical team identity',()=>{
  it('changes City at the 2016/17 boundary and restores one-season Arsenal variants',()=>{
    expect(resolveHistoricalCrest('mancity:2015')?.id).not.toBe(resolveHistoricalCrest('mancity:2016')?.id);
    expect(resolveHistoricalCrest('arsenal:2005')?.id).not.toBe(resolveHistoricalCrest('arsenal:2004')?.id);
    expect(resolveHistoricalCrest('arsenal:2006')?.id).toBe(resolveHistoricalCrest('arsenal:2004')?.id);
    expect(resolveHistoricalCrest('arsenal:2011')?.id).not.toBe(resolveHistoricalCrest('arsenal:2012')?.id);
  });
  it('keeps the original Wimbledon identity and refuses unknown or future seasons',()=>{
    expect(resolveHistoricalCrest('wimbledon:1999')?.id).toBe('wimbledon-1981');
    for(const key of ['afcwimbledon:1999','arsenal:2050','arsenal:2003junk','other:2003'])expect(resolveHistoricalCrest(key)).toBeNull();
  });
  it('limits the 2024 Arsenal cannon to its season and avoids older anniversary badges later',()=>{
    expect(resolveHistoricalCrest('arsenal:2024')?.id).toBe('arsenal-2024');
    expect(resolveHistoricalCrest('arsenal:2025')?.id).toBe('arsenal-2002');
    expect(resolveHistoricalCrest('watford:2015')?.id).toBe('watford-1979');
    expect(resolveHistoricalCrest('hull:2008')?.id).toBe('hull-2001');
    expect(resolveHistoricalCrest('southampton:1992')?.id).toBe('southampton-1974');
    expect(resolveHistoricalCrest('portsmouth:2009')?.id).toBe('portsmouth-2008');
  });
  it('retains a stable fallback after an image error and loads a different season normally',()=>{
    const {container,rerender}=render(<TeamCrest teamKey="mancity:2015"/>);
    const image=container.querySelector('img')!;expect(image).toBeTruthy();expect(image.alt).toBe('');
    fireEvent.error(image);expect(container.querySelector('img')).toBeNull();
    rerender(<TeamCrest teamKey="mancity:2016"/>);expect(container.querySelector('img')).toBeTruthy();
    rerender(<TeamCrest teamKey="unknown:1999"/>);expect(container.querySelector('img')).toBeNull();
    expect(screen.getByTitle(/Historical crest unavailable/)).toBeTruthy();
  });
  it('falls back from the HD SVG to the HFK image and then to the neutral crest',()=>{
    const {container}=render(<TeamCrest teamKey="arsenal:2010"/>);
    const hd=container.querySelector('img')!;
    expect(hd.getAttribute('src')).toBe('/assets/crests-hd/arsenal-2002.svg');
    expect(container.querySelector('.team-crest')!.getAttribute('title')).toMatch(/Wikipedia · File:Arsenal FC\.svg · Fair use/);
    fireEvent.error(hd);
    const hfk=container.querySelector('img')!;
    expect(hfk.getAttribute('src')).toBe('/assets/crests/arsenal-2002.gif');
    expect(container.querySelector('.team-crest')!.getAttribute('title')).toMatch(/Historical Football Kits/);
    fireEvent.error(hfk);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByTitle(/Historical crest unavailable/)).toBeTruthy();
  });
  it('keeps Chelsea on its HFK image',()=>{
    const {container}=render(<TeamCrest teamKey="chelsea:2015"/>);
    expect(container.querySelector('img')!.getAttribute('src')).toMatch(/^\/assets\/crests\/chelsea-/);
  });
});
