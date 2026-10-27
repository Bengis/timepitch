import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { LanguageProvider } from '../i18n';
import { StudioNavigation } from './StudioNavigation';

it('keeps setup and the existing match as distinct destinations without creating a match', () => {
  const onSetup = vi.fn(), onMatch = vi.fn();
  render(<LanguageProvider><StudioNavigation page="setup" onSetup={onSetup} onMatch={onMatch} busy={false}/></LanguageProvider>);
  const setup = screen.getByRole('button', { name: 'New match' });
  const match = screen.getByRole('button', { name: 'Match centre' });
  expect(setup).toHaveAttribute('aria-current', 'page');
  expect(match).not.toHaveAttribute('aria-current');
  fireEvent.click(match);
  expect(onMatch).toHaveBeenCalledOnce();
  expect(onSetup).not.toHaveBeenCalled();
  fireEvent.click(setup);
  expect(onSetup).toHaveBeenCalledOnce();
});

it('blocks both destinations while a match is being prepared', () => {
  const onSetup = vi.fn(), onMatch = vi.fn();
  render(<LanguageProvider><StudioNavigation page="match" onSetup={onSetup} onMatch={onMatch} busy/></LanguageProvider>);
  for (const button of screen.getAllByRole('button')) { expect(button).toBeDisabled(); fireEvent.click(button); }
  expect(onMatch).not.toHaveBeenCalled();
  expect(onSetup).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Match centre' })).toHaveAttribute('aria-current', 'page');
});

it('does not claim either destination is active when another workspace is open', () => {
  render(<LanguageProvider><StudioNavigation page="other" onSetup={() => {}} onMatch={() => {}} busy={false}/></LanguageProvider>);
  expect(screen.getAllByRole('button').every(button => !button.hasAttribute('aria-current'))).toBe(true);
});

it('preserves the existing library destination in the legacy workspace', () => {
  const onLibrary = vi.fn();
  render(<LanguageProvider><StudioNavigation page="library" onSetup={() => {}} onMatch={() => {}} onLibrary={onLibrary} busy={false}/></LanguageProvider>);
  const library = screen.getByRole('button', { name: 'Library' });
  expect(library).toHaveAttribute('aria-current', 'page');
  fireEvent.click(library);
  expect(onLibrary).toHaveBeenCalledOnce();
});

it('does not offer an unavailable legacy match but keeps setup usable', () => {
  const onMatch = vi.fn();
  render(<LanguageProvider><StudioNavigation page="setup" onSetup={() => {}} onMatch={onMatch} matchAvailable={false} busy={false}/></LanguageProvider>);
  const match = screen.getByRole('button', { name: 'Match centre' });
  expect(match).toBeDisabled();
  fireEvent.click(match);
  expect(onMatch).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'New match' })).toBeEnabled();
});
