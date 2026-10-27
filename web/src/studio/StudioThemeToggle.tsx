import {useLayoutEffect, useState} from 'react';
import {useLanguage} from '../i18n';
import {defineTexts} from '../i18n-catalog';

export type StudioTheme = 'dark' | 'light';
const STORAGE_KEY='timepitch.studio.theme';
const texts=defineTexts('studio-theme',{
  en:{toLight:'Switch to light theme',toDark:'Switch to dark theme'},
  es:{toLight:'Cambiar a tema claro',toDark:'Cambiar a tema oscuro'},
});

export function readStudioTheme():StudioTheme {
  try{return localStorage.getItem(STORAGE_KEY)==='light'?'light':'dark';}catch{return 'dark';}
}
export function applyStudioTheme(theme:StudioTheme){
  document.documentElement.dataset.studioTheme=theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',theme==='dark'?'#101722':'#f3f5f7');
}
export function useStudioTheme(){
  const [theme,setTheme]=useState(readStudioTheme);
  useLayoutEffect(()=>applyStudioTheme(theme),[theme]);
  const toggle=()=>setTheme(previous=>{
    const next=previous==='dark'?'light':'dark';
    try{localStorage.setItem(STORAGE_KEY,next);}catch{/* The in-memory choice still works. */}
    return next;
  });
  return {theme,toggle};
}
export function StudioThemeToggle({theme,onToggle}:{theme:StudioTheme;onToggle:()=>void}){
  const {locale}=useLanguage(),t=texts(locale),label=theme==='dark'?t.toLight:t.toDark;
  return <button type="button" className="studio-theme-toggle" aria-label={label} title={label} onClick={onToggle}>
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      {theme==='dark'?<><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5"/></>:<path d="M20.5 14A8.5 8.5 0 0 1 10 3.5 8.5 8.5 0 1 0 20.5 14Z"/>}
    </svg>
  </button>;
}
