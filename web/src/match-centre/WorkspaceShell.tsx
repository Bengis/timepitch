import type {ReactNode} from 'react';
import {LanguageSelector} from '../i18n';
import {NamesToggle} from '../catalog/NamesToggle';
import {useHistoricalText} from '../historical/messages';
import type {WorkspaceRoute} from './navigation';
export function WorkspaceShell({route,onNavigate,children,busy,ready}:{route:WorkspaceRoute;onNavigate:(route:WorkspaceRoute)=>void;children:ReactNode;busy:boolean;ready:boolean}){
  const h=useHistoricalText();
  return <><header className="topbar modes-topbar"><a className="wordmark" href="#/">TIME<span>PITCH</span></a>
    {/* TP240 («quitaría partidos reales… y mis partidos»): la web es solo jugar un partido; sin pestañas.
        Las rutas de reconstrucción y biblioteca siguen existiendo, pero no se enlazan. */}
    <NamesToggle/><LanguageSelector/>
  </header>{/* TP248 (25-oct: «¿yo por qué tengo que volver al match desde el principal?»): el partido se abre solo al
      terminar la simulación; aquí solo el aviso mientras se simula, sin «Volver a tu partido». */}
  {busy&&<aside className="simulation-access"><span role="status">{h.progress}</span></aside>}{children}</>;
}
