import {afterEach, expect, it, vi} from 'vitest';
import {fireEvent, render, screen} from '@testing-library/react';
import {LanguageProvider} from '../i18n';
import {StudioThemeToggle, useStudioTheme} from './StudioThemeToggle';

function Settings(){const {theme,toggle}=useStudioTheme();return <StudioThemeToggle theme={theme} onToggle={toggle}/>;}
function show(){return render(<LanguageProvider><Settings/></LanguageProvider>);}
afterEach(()=>{vi.restoreAllMocks();delete document.documentElement.dataset.studioTheme;});

it('starts dark without a saved choice and offers the light theme',()=>{
  show();
  expect(document.documentElement).toHaveAttribute('data-studio-theme','dark');
  expect(screen.getByRole('button',{name:'Switch to light theme'})).toBeVisible();
});

it('switches immediately and retains the visitor choice after remounting',()=>{
  const first=show();fireEvent.click(screen.getByRole('button',{name:'Switch to light theme'}));
  expect(document.documentElement).toHaveAttribute('data-studio-theme','light');
  expect(localStorage.getItem('timepitch.studio.theme')).toBe('light');
  first.unmount();show();
  fireEvent.click(screen.getByRole('button',{name:'Switch to dark theme'}));
  expect(document.documentElement).toHaveAttribute('data-studio-theme','dark');
  expect(localStorage.getItem('timepitch.studio.theme')).toBe('dark');
});

it('does not accept arbitrary stored values as themes',()=>{
  localStorage.setItem('timepitch.studio.theme','system');show();
  expect(document.documentElement).toHaveAttribute('data-studio-theme','dark');
});

it('still switches if browser storage is unavailable',()=>{
  vi.spyOn(Storage.prototype,'getItem').mockImplementation(()=>{throw Error('blocked')});
  vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('blocked')});
  show();fireEvent.click(screen.getByRole('button',{name:'Switch to light theme'}));
  expect(document.documentElement).toHaveAttribute('data-studio-theme','light');
});

it('keeps the theme action translated in Spanish',()=>{
  localStorage.setItem('timepitch.locale','es');show();
  expect(screen.getByRole('button',{name:'Cambiar a tema claro'})).toBeVisible();
});
