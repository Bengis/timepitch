import {buildMatchCast} from '../../presentation/cast';
import {parseSquad} from '../../catalog/player-registry';
import {fictionalPlayer} from '../../catalog/fictional';
import {recordedSpeechIdentity} from './azure-cues';
import {summaryNamesIdentity} from './summary-plan';
import type {RecordedReplayEntry} from '../adapters/recorded-replay';
import type {RecordedTrack} from '../adapters/recorded-track';
import type {PlayerView} from '../session';

/** Same display-cast calculation as preparation; never accepts a source identity from the manifest. */
export async function resolveSummaryDisplaySource(entry:RecordedReplayEntry,track:RecordedTrack,players:readonly PlayerView[],readSquad:(file:string)=>Promise<unknown>){
  const squads={home:[],away:[]} as {home:ReturnType<typeof parseSquad>;away:ReturnType<typeof parseSquad>};
  for(const side of ['home','away'] as const)squads[side]=parseSquad(await readSquad(`${track[side].key.replace(':','-')}.json`)).map(p=>({...p,display:fictionalPlayer(p.display)}));
  const cast=buildMatchCast({source:'recorded',homeKey:track.home.key,awayKey:track.away.key,players,squads});
  const identities=players.map(p=>({id:p.id,name:cast.players.get(p.id)?.displayName??p.name??'',qid:cast.players.get(p.id)?.record?.qid??null}));
  const source=await summaryNamesIdentity(await recordedSpeechIdentity(entry,track,'fictional'),'display',identities);
  return{source,identities,cast};
}
