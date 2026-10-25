import type {ReactNode} from 'react';
import {LanguageSelector} from '../i18n';
import {useHistoricalText} from '../historical/messages';
import type {WorkspaceRoute} from './navigation';
export function WorkspaceShell({route,onNavigate,children,busy,ready}:{route:WorkspaceRoute;onNavigate:(route:WorkspaceRoute)=>void;children:ReactNode;busy:boolean;ready:boolean}){
  const h=useHistoricalText();
  return <><header className="topbar modes-topbar"><a className="wordmark" href="#/">TIME<span>PITCH</span></a>
    {/* TP240 («quitaría partidos reales… y mis partidos»): la web es solo jugar un partido; sin pestañas.
        Las rutas de reconstrucción y biblioteca siguen existiendo, pero no se enlazan. */}
    <LanguageSelector/>
  </header>{/* TP239 (jueces: la barra salía hasta dentro del partido): solo en curso o con un partido esperando en otra pantalla. */}
  {(busy||ready&&!(route.mode==='simulation'&&route.view==='centre'))&&<aside className="simulation-access">{busy&&<span role="status">{h.progress}</span>}<button onClick={()=>onNavigate({mode:'simulation',view:'centre'})}>{h.viewSimulation}</button></aside>}{children}</>;
}
