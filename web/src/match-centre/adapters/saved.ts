import type { TeamSeason } from '../../api';
import { getTeam } from '../../api';
import type { MatchSessionAdapter, MatchSection, PanelData, SessionDescriptor, SessionSnapshot } from '../session';
import { missing, guard, ReadPool, store } from './base';
import { catalogPlayer } from './metrics';

/** Read-only lifecycle shared by immutable saved replay adapters. */
export function savedSession<T>({descriptor,resolve,metadata,readStatistics,normalize,statisticsAt,team=getTeam,dataset}:{
  descriptor:SessionDescriptor; resolve:(ms:number)=>SessionSnapshot; metadata:()=>PanelData;
  readStatistics:(ms:number,signal:AbortSignal)=>Promise<T|null>; normalize:(value:T|null,ms:number)=>PanelData;
  statisticsAt:(ms:number,final:boolean)=>number|null; team?:(id:string,signal:AbortSignal)=>Promise<TeamSeason>;dataset:string;
}):MatchSessionAdapter & {resolveFrame:(ms:number)=>SessionSnapshot} {
  const catalog=new Map<string,{source:TeamSeason;sourceKey:string}>();
  const state=store(resolve(0)),stats=new ReadPool<T|null>(2),teams=new ReadPool<TeamSeason>(2);
  let panelGeneration=0,panelCursor=0,failed=false,lastPanel:{section:MatchSection;ms:number;final:boolean}|null=null;
  const adapter:MatchSessionAdapter={
    identity:descriptor.identity,snapshot:state.snapshot,subscribe:state.subscribe,
    async ensure(ms,signal){
      guard(signal,state.disposed);const next=resolve(ms);
      if(next.presentedCursor.elapsedMs<panelCursor)panelGeneration++;
      const panels={...state.snapshot().panels};
      for(const key of Object.keys(panels) as MatchSection[])if(panels[key]?.scope==='cursor'&&(panels[key]?.cutoff?.elapsedMs??0)>next.presentedCursor.elapsedMs)delete panels[key];
      state.publish({...next,panels:{...next.panels,...panels}});
    },
    async loadPanel(section,ms,final,signal){
      guard(signal,state.disposed);lastPanel={section,ms,final};const generation=++panelGeneration;panelCursor=ms;
      const cutoff=statisticsAt(ms,final);let panel:PanelData;
      if(cutoff===null)panel=metadata();
      else if(failed)panel={...metadata(),availability:missing('statistics_failed_retry_required')};
      else try { const data=await stats.get(String(cutoff),signal,s=>readStatistics(cutoff,s));guard(signal,state.disposed);panel=normalize(data,cutoff); }
      catch(error){if(signal.aborted||state.disposed)return;failed=true;panel={...metadata(),availability:missing('statistics_failed_retry_required')};}
      if(signal.aborted||state.disposed||generation!==panelGeneration)return;
      panel={...panel,playerDetails:panel.players.map(item=>{const data=catalog.get(item.id);return data?catalogPlayer(item,data.source,data.sourceKey,dataset):item;})};
      if(final)panel={...panel,scope:'final'};
      state.publish({...state.snapshot(),panels:{...state.snapshot().panels,[section]:panel}});
    },
    async loadPlayer(playerId,signal){
      guard(signal,state.disposed);const before=state.snapshot(),panel=before.panels.players??metadata();
      const item=panel.players.find(p=>p.id===playerId);if(!item)return;
      const teamKey=item.details?.teamKey,sourceKey=item.details?.sourceKey;
      if(typeof teamKey!=='string'||typeof sourceKey!=='string')return;
      let source:TeamSeason|null=null;
      try {const data=await teams.get(teamKey,signal,s=>team(teamKey,s));guard(signal,state.disposed);
        if(data.key!==teamKey)throw new Error('Catalog identity changed');source=data;
      }catch(error){if(signal.aborted||state.disposed)return;}
      if(signal.aborted||state.disposed)return;
      if(source)catalog.set(playerId,{source,sourceKey});
      const current=state.snapshot(),base=current.panels.players??panel;
      const fresh=base.players.find(p=>p.id===playerId)??item;
      const updated=source?catalogPlayer(fresh,source,sourceKey,dataset):{...fresh,availability:{status:'partial' as const,reason:'catalog_player_unavailable'},details:{...fresh.details,catalogUnavailable:true}};
      state.publish({...current,panels:{...current.panels,players:{...base,playerDetails:[...base.playerDetails.filter(p=>p.id!==playerId),updated]}}});
    },
    async loadEvents(_period,_from,_to,signal){guard(signal,state.disposed);},
    async retry(ms,signal){failed=false;stats.clearFailures();teams.clearFailures();await adapter.ensure(ms,signal);
      if(lastPanel)await adapter.loadPanel(lastPanel.section,lastPanel.ms,lastPanel.final,signal);},
    dispose(){panelGeneration++;state.dispose();stats.dispose();teams.dispose();},
  };
  return Object.assign(adapter,{resolveFrame:resolve});
}
