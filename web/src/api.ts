import type { components } from './generated/api';

export type TeamSummary = components['schemas']['TeamSummary'];
export type TeamSeason = components['schemas']['TeamSeason'];
export type PlayerSeason = components['schemas']['PlayerSeason'];
export type Statistic = components['schemas']['Statistic'];
export type MatchConfig = components['schemas']['MatchConfig'];
export type LegacyMatchRecord = components['schemas']['MatchRecord'];
export type MatchRecordV2 = components['schemas']['MatchRecordV2'];
export type MotionSample = components['schemas']['MotionSample'];
export type ResolvedEvent = components['schemas']['ResolvedEvent'];
export type ReplayRecord = LegacyMatchRecord | MatchRecordV2;
export type MatchRecord = ReplayRecord;
export type MatchEvent = components['schemas']['MatchEvent'];
export type RenderFrame = components['schemas']['RenderFrame'];
export type MatchJob = components['schemas']['MatchJob'];
export type MatchMetrics = components['schemas']['MatchMetrics'];
export type ExplanationJob = components['schemas']['ExplanationJob'];
export type ExplanationRequest = components['schemas']['ExplanationRequest'];
export type MatchWindow = components['schemas']['MatchWindow'];
export type StatisticsBundle = components['schemas']['StatisticsBundle'];
export type MetricValue = components['schemas']['MetricValue'];
export type MetricDefinition = components['schemas']['MetricDefinition'];
export type PlotPoint = components['schemas']['PlotPoint'];
export type HistoricalStatistic = components['schemas']['HistoricalStatistic'];
export type GrfReplay = components['schemas']['GrfReplay'] | components['schemas']['GrfFullMatchReplay'] | components['schemas']['GrfStatisticsReplay'];
export type GrfReplayResponse = GrfReplay | components['schemas']['PhysicalManifest'] | components['schemas']['ActivityManifest'] | components['schemas']['ActionManifest'];
export class UnsupportedGrfReplayError extends Error { constructor(){super('Physical GRF replay is unavailable in this browser');} }
export function requirePlayableGrfReplay(record:GrfReplayResponse):GrfReplay {
  if(record.schema_version==='grf-experimental-1'||record.schema_version==='grf-experimental-2'||record.schema_version==='grf-experimental-3')return record;
  throw new UnsupportedGrfReplayError();
}
export type GrfStatisticsSummary = components['schemas']['GrfStatisticsSummary'];
export type GrfJob = components['schemas']['GrfJob'];
export type EngineCapability = components['schemas']['EngineCapability'];

export class ApiError extends Error { constructor(public status: number) { super(`HTTP ${status}`); } }
async function request<T>(url: string, signal?: AbortSignal, body?: unknown): Promise<T> {
  const response = await fetch(url, { signal, ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  if (!response.ok) throw new ApiError(response.status);
  return response.json() as Promise<T>;
}

export const getTeams = (signal?: AbortSignal) => request<TeamSummary[]>('/api/catalog/teams', signal);
export const getEngines = (signal?: AbortSignal) => request<EngineCapability[]>('/api/engines', signal);
export const createGrfMatch = (config: MatchConfig, signal?: AbortSignal) => request<GrfJob>('/api/grf/matches', signal, config);
export const getGrfMatches = (signal?: AbortSignal) => request<GrfJob[]>('/api/grf/matches', signal);
export const getGrfMatch = (id: string, signal?: AbortSignal) => request<GrfJob>(`/api/grf/matches/${encodeURIComponent(id)}`, signal);
export const getGrfReplay = async (id: string, signal?: AbortSignal) => requirePlayableGrfReplay(await request<GrfReplayResponse>(`/api/grf/matches/${encodeURIComponent(id)}/replay`, signal));
// TP243: TouchLines en vivo. La grabación y sus eventos llegan comprimidos (gzip) y el navegador los descomprime.
export const createTouchLinesMatch = (config: MatchConfig, signal?: AbortSignal) => request<GrfJob>('/api/touchlines/matches', signal, config);
export const getTouchLinesMatch = (id: string, signal?: AbortSignal) => request<GrfJob>(`/api/touchlines/matches/${encodeURIComponent(id)}`, signal);
export type TouchLinesRecord = Readonly<{ raw: unknown; events: unknown }>;
export const getTouchLinesRecord = async (id: string, signal?: AbortSignal): Promise<TouchLinesRecord> => {
  const base = `/api/touchlines/matches/${encodeURIComponent(id)}`;
  const [raw, events] = await Promise.all([request<unknown>(`${base}/replay`, signal), request<unknown>(`${base}/events`, signal)]);
  return { raw, events };
};
export const getGrfStatistics = (id:string,signal?:AbortSignal) => request<GrfStatisticsSummary>(`/api/grf/matches/${encodeURIComponent(id)}/statistics`,signal);
export const getTeam = (key: string, signal?: AbortSignal) => request<TeamSeason>(`/api/catalog/teams/${encodeURIComponent(key)}`, signal);
export const getMatches = (signal?: AbortSignal) => request<MatchJob[]>('/api/matches', signal);
export const createMatch = (config: MatchConfig, signal?: AbortSignal) => request<MatchJob>('/api/matches', signal, config);
export const getMatch = (id: string, signal?: AbortSignal) => request<MatchJob>(`/api/matches/${encodeURIComponent(id)}`, signal);
export const getReplay = (id: string, signal?: AbortSignal) => request<MatchRecord>(`/api/matches/${encodeURIComponent(id)}/replay`, signal);
export const importReplay = (record: unknown, signal?: AbortSignal) => request<MatchJob>('/api/replays/import', signal, record);
export const getWindows = (id: string, signal?: AbortSignal) => request<MatchWindow[]>(`/api/matches/${encodeURIComponent(id)}/windows`, signal);
export const createExplanation = (id: string, body: ExplanationRequest, signal?: AbortSignal) => request<ExplanationJob>(`/api/matches/${encodeURIComponent(id)}/explanations`, signal, body);
export const getExplanation = (id: string, job: string, signal?: AbortSignal) => request<ExplanationJob>(`/api/matches/${encodeURIComponent(id)}/explanations/${encodeURIComponent(job)}`, signal);
export const getStatistics = (id:string,endMs:number,signal?:AbortSignal) => request<StatisticsBundle>(`/api/matches/${encodeURIComponent(id)}/statistics?end_ms=${Math.floor(endMs/250)*250}`,signal);
