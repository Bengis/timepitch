import {expect,it} from 'vitest';
import {parseWorkspaceHash,formatWorkspaceHash} from './navigation';

it('round trips source identities and tabs without inventing a simulation',()=>{
  const route={mode:'reconstruction',matchId:3754217,seasonId:27,teamId:33,tab:'analysis'} as const;
  expect(parseWorkspaceHash(formatWorkspaceHash(route))).toEqual(route);
  // TP217: «/» (y cualquier ruta desconocida) abre la pantalla principal VERSUS, no la reconstrucción.
  for(const hash of ['', '#', '#/', '#/bad', '#/reconstruction/no', '#/simulation/launch'])
    expect(parseWorkspaceHash(hash)).toEqual({mode:'simulation',view:'setup'});
  expect(parseWorkspaceHash('#/reconstruction')).toEqual({mode:'reconstruction'});
  expect(parseWorkspaceHash('#/reconstruction?season=27')).toEqual({mode:'reconstruction',seasonId:27});
  expect(parseWorkspaceHash('#/demo')).toEqual({mode:'demo'});
  expect(parseWorkspaceHash('#/simulation/centre')).toEqual({mode:'simulation',view:'centre'});
  expect(parseWorkspaceHash('#/library')).toEqual({mode:'library'});
  expect(formatWorkspaceHash(parseWorkspaceHash('#/reconstruction?token=secret'))).not.toContain('secret');
});
it('retains only allowlisted sequence profiles and reports unsupported requests',()=>{
  const hash='#/reconstruction/3754078?sequence=ayew-equaliser-1';
  expect(parseWorkspaceHash(hash)).toMatchObject({sequence:'ayew-equaliser-1'});
  expect(formatWorkspaceHash(parseWorkspaceHash(hash))).toBe(hash);
  expect(parseWorkspaceHash('#/reconstruction/3754078?sequence=bad')).toMatchObject({sequence:'unavailable'});
  expect(parseWorkspaceHash('#/reconstruction/99?sequence=ayew-equaliser-1')).toMatchObject({sequence:'unavailable'});
  expect(formatWorkspaceHash(parseWorkspaceHash('#/reconstruction/3754078?sequence=bad&token=secret'))).not.toMatch(/bad|secret/);
});
