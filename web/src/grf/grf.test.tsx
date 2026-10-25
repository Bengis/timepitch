import {afterEach,beforeEach,expect,it} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {LanguageProvider,LanguageSelector} from '../i18n';
import {EngineSelector} from './EngineSelector';

beforeEach(()=>localStorage.clear());afterEach(cleanup);
it('starts with TimePitch and shows a disabled GRF choice while capabilities are loading',()=>{
  render(<LanguageProvider><EngineSelector value="timepitch" capabilities={null} disabled={false} onChange={()=>{}}/></LanguageProvider>);
  expect(screen.getByLabelText('Simulation engine')).toHaveValue('timepitch');
  expect(screen.getByRole('option',{name:'Google Research Football'})).toBeDisabled();
});
it('explains unavailable GRF in both languages without enabling the option',()=>{
  render(<LanguageProvider><LanguageSelector/><EngineSelector value="timepitch" capabilities={[{id:'timepitch',available:true},{id:'grf',available:false,reason:'missing_runtime'}]} disabled={false} onChange={()=>{}}/></LanguageProvider>);
  expect(screen.getByText(/GRF runtime is not installed/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Language: Español' }));
  expect(screen.getByText(/entorno GRF no está instalado/)).toBeVisible();
});
