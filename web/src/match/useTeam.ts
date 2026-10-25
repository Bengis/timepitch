import { useEffect, useRef, useState } from 'react';
import { getTeam, type TeamSeason } from '../api';
import { defaultLineup, type Formation, type Tactic } from './lineup';
import {slots} from './lineup';
import type {PreparedTeam} from '../historical/matchup';

export function useTeam(initial: string) {
  const [key, setKeyState] = useState(initial);
  const [preparation,setPreparation]=useState<PreparedTeam|null>(null);
  const preparationRef=useRef<PreparedTeam|null>(null);
  const [preparationStatus,setPreparationStatus]=useState<'none'|'loading'|'clubs_only'|'exact'|'edited'|'failed'>('none');
  const [team, setTeam] = useState<TeamSeason | null>(null);
  const [formation, setFormationState] = useState<Formation>('4-4-2');
  const [tactic, setTactic] = useState<Tactic>('balanced');
  const [players, setPlayers] = useState<string[]>([]);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setFailed(false); setTeam(null);
    getTeam(key, controller.signal).then(value => {
      if (controller.signal.aborted) return;
      const f = (value.available_formations.includes('4-4-2') ? '4-4-2' : value.available_formations[0]) as Formation;
      setTeam(value); setFormationState(f); setPlayers(defaultLineup(value, f));
      if(preparation&&preparationRef.current===preparation){
        if(value.key!==preparation.key||value.dataset_version!==preparation.datasetVersion){setPreparationStatus('failed');return;}
        if(preparation.players&&preparation.formation){
          const roles=slots(preparation.formation);
          if(!value.available_formations.includes(preparation.formation)||preparation.players.length!==11||new Set(preparation.players).size!==11||!preparation.players.every((key,i)=>value.players.find(p=>p.key===key)?.role===roles[i])){setPreparationStatus('failed');return;}
          setFormationState(preparation.formation);setPlayers([...preparation.players]);setPreparationStatus('exact');
        }else setPreparationStatus('clubs_only');
      }
    }).catch(error => { if (!controller.signal.aborted&&error.name !== 'AbortError') {setFailed(true);if(preparationRef.current===preparation&&preparation)setPreparationStatus('failed');} });
    return () => controller.abort();
  }, [key, attempt,preparation]);
  const edited=()=>{if(preparation){preparationRef.current=null;setPreparationStatus('edited');}};
  const setKey=(value:string)=>{edited();setKeyState(value);};
  const setFormation = (f: Formation) => { edited();setFormationState(f); if (team) setPlayers(defaultLineup(team, f)); };
  const prepare=(value:PreparedTeam)=>{preparationRef.current=value;setPreparationStatus('loading');setPreparation(value);setKeyState(value.key);setTactic('balanced');};
  const current = team?.key === key ? team : null;
  return { key, setKey, team: current, formation, setFormation, tactic, setTactic, players, setPlayers:(value:string[])=>{edited();setPlayers(value);},failed, retry: () => setAttempt(v => v + 1),prepare,preparationStatus,
    valid: preparationStatus!=='loading'&&preparationStatus!=='failed'&&!!current && players.length === 11 && new Set(players).size === 11 && players.every(Boolean) };
}
export type TeamSelection = ReturnType<typeof useTeam>;
