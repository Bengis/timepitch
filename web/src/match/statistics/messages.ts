import { useLanguage } from '../../i18n';
import { clockLabel } from '../replay';
const en={title:'Advanced match statistics',final:'Final match statistics',inspect:'Inspect current statistics',
  through:'Statistics through',loading:'Loading statistics…',error:'Could not load these statistics. Try again.',
  team:'Teams',player:'Player',scope:'Statistics view',group:'Metric group',choosePlayer:'Statistics player',
  chance:'Chance quality and creation',progression:'Progression and territory',defense:'Recovery and pressure',
  sequences:'Sequences',shape:'Team structure',effort:'Physical effort',metric:'Metric',definition:'Definition and evidence',
  simulated:'Simulated',historical:'Historical',estimated:'Estimated',available:'Available',partial:'Partial',unavailable:'Unavailable',
  source:'Source',coverage:'Covered minutes',denominator:'Denominator',events:'Supporting events',samples:'Motion ranges',
  inspectEvent:'Inspect event',note:'Simulated output, not measured player tracking. Restarts add no distance.',
  models:'Independent xT, xPass and post-shot xG models are not available in this version.',
  plots:'Charts',chart:'Chart view',shots:'Shot map',xg:'Cumulative simulated xG',actions:'Action map',occupancy:'Occupancy map',
  effortChart:'Player distance',chartData:'Show chart data',time:'Time',side:'Team',value:'Value',position:'Position (m)',
  direction:'Attacking direction is left to right for both teams.',occupancyUnit:'Outfield player-seconds per cell.',phase:'Phase',inPossession:'In possession',outOfPossession:'Out of possession',
  distanceUnit:'Cumulative simulated metres per player.',actionNote:'Resolved actions; this is not a time-weighted heatmap.',
  teamXg:'Team cumulative xG',shooter:'Shooter at event',xgTeamNote:'Team totals across all shooters; individual totals are in the metric table.',
  passes:'Completed pass links',receiver:'Receiver',passNote:'Schematic links by lineup slot. Each arrow is one recorded completed pass; node positions are a diagram.',
  noChart:'No observations for this chart at this time.',historicalTitle:'Advanced historical statistics',
  historicalPlayer:'Historical player',recorded:'Recorded value',per90:'Per 90',fixtures:'fixtures',
  historicalNote:'Recorded FPL fields vary by season. Covered minutes determine rates; missing values are not zero. Recorded xA differs from TimePitch xG Assisted and Fantasy assists.',
  noMotion:'This previous replay has no canonical motion samples.',noContext:'This previous replay has no spatial event context.',
  zero:'No eligible denominator in this window.',insufficient:'Not enough motion samples.',missing:'Supplement not available.',
  notCovered:'This source or period does not cover this field.',partialNote:'Partial source coverage.',
};
const es:Record<keyof typeof en,string>={title:'Estadísticas avanzadas del partido',final:'Estadísticas finales del partido',inspect:'Consultar estadísticas actuales',
  through:'Estadísticas hasta',loading:'Cargando estadísticas…',error:'No se han podido cargar estas estadísticas. Inténtalo de nuevo.',
  team:'Equipos',player:'Jugador',scope:'Vista de estadísticas',group:'Grupo de métricas',choosePlayer:'Jugador de estadísticas',
  chance:'Ocasiones y creación',progression:'Progresión y territorio',defense:'Recuperación y presión',sequences:'Secuencias',
  shape:'Estructura del equipo',effort:'Esfuerzo físico',metric:'Métrica',definition:'Definición y evidencia',
  simulated:'Simulado',historical:'Histórico',estimated:'Estimado',available:'Disponible',partial:'Parcial',unavailable:'No disponible',
  source:'Fuente',coverage:'Minutos cubiertos',denominator:'Denominador',events:'Eventos de apoyo',samples:'Tramos de movimiento',
  inspectEvent:'Consultar evento',note:'Resultados simulados; no son seguimiento medido de los jugadores. Los reinicios no suman distancia.',
  models:'Esta versión no dispone de modelos independientes de xT, xPass o xG posterior al tiro.',
  plots:'Gráficos',chart:'Vista del gráfico',shots:'Mapa de tiros',xg:'xG simulado acumulado',actions:'Mapa de acciones',occupancy:'Mapa de ocupación',
  effortChart:'Distancia por jugador',chartData:'Ver datos del gráfico',time:'Tiempo',side:'Equipo',value:'Valor',position:'Posición (m)',
  direction:'Ambos equipos atacan de izquierda a derecha en estos gráficos.',occupancyUnit:'Segundos de jugadores de campo por celda.',phase:'Fase',inPossession:'Con balón',outOfPossession:'Sin balón',
  distanceUnit:'Metros simulados acumulados por jugador.',actionNote:'Acciones resueltas; no es un mapa ponderado por tiempo.',
  teamXg:'xG acumulado del equipo',shooter:'Rematador del evento',xgTeamNote:'Totales del equipo con todos sus rematadores; los totales individuales están en la tabla de métricas.',
  passes:'Conexiones de pases completados',receiver:'Receptor',passNote:'Conexiones esquemáticas por puesto del once. Cada flecha es un pase completado registrado; las posiciones son un diagrama.',
  noChart:'No hay observaciones para este gráfico en este instante.',historicalTitle:'Estadísticas históricas avanzadas',
  historicalPlayer:'Jugador histórico',recorded:'Valor registrado',per90:'Por 90',fixtures:'partidos',
  historicalNote:'Los campos registrados por FPL varían según la temporada. Las tasas usan minutos cubiertos; ausencia no es cero. El xA registrado difiere del xG Assisted de TimePitch y de las asistencias Fantasy.',
  noMotion:'Esta repetición anterior no contiene muestras canónicas de movimiento.',noContext:'Esta repetición anterior no tiene contexto espacial de eventos.',
  zero:'No hay denominador elegible en esta ventana.',insufficient:'No hay suficientes muestras de movimiento.',missing:'Suplemento no disponible.',
  notCovered:'Esta fuente o periodo no cubre el campo.',partialNote:'Cobertura parcial de la fuente.',
};
export const metricGroups={
  chance:['simulated_xg','simulated_xga','simulated_xgd','simulated_xg_per_shot','goals_minus_xg','key_passes','xg_assisted'],
  progression:['progressive_passes_attempted','progressive_passes_completed','progressive_carries_attempted','progressive_carries_completed','final_third_entries','box_entries','field_tilt_tp','possession_own_third_pct','possession_middle_third_pct','possession_opponent_third_pct'],
  defense:['high_recoveries','own_half_losses','own_third_losses','recovery_time_s','recovery_episodes_completed','recovery_episodes_open','counterpress_recoveries_tp','pressure_attempts','pressure_linked_recoveries','passes_per_intervention_tp'],
  sequences:['sequence_duration_s','passes_per_sequence','sequence_progress_m','sequence_direct_speed_m_s'],
  shape:['defensive_line_height_m','def_mid_gap_m','mid_fwd_gap_m','team_length_m','team_width_m',
    'team_length_m_in_possession','team_length_m_out_of_possession','team_width_m_in_possession','team_width_m_out_of_possession',
    'defensive_line_height_m_in_possession','defensive_line_height_m_out_of_possession','def_mid_gap_m_in_possession','def_mid_gap_m_out_of_possession','mid_fwd_gap_m_in_possession','mid_fwd_gap_m_out_of_possession'],
  effort:['distance_m','distance_km_per90','metres_per_minute','hsr_distance_m','sprint_distance_m','sprint_count','sprint_duration_s','max_speed_kmh','high_acceleration_count','high_deceleration_count'],
} as const;
const labels:Record<string,[string,string]>={
  simulated_xg:['Simulated xG','xG simulado'],simulated_xga:['Simulated xGA','xGA simulado'],simulated_xgd:['Simulated xG difference','Diferencia de xG simulado'],
  simulated_xg_per_shot:['Simulated xG per shot','xG simulado por tiro'],goals_minus_xg:['Goals minus simulated xG','Goles menos xG simulado'],
  key_passes:['Key passes TP','Pases clave TP'],xg_assisted:['xG Assisted TP','xG Assisted TP'],
  progressive_passes_attempted:['Progressive pass attempts','Intentos de pase progresivo'],progressive_passes_completed:['Completed progressive passes','Pases progresivos completados'],
  progressive_carries_attempted:['Progressive carry attempts','Intentos de conducción progresiva'],progressive_carries_completed:['Completed progressive carries','Conducciones progresivas completadas'],
  final_third_entries:['Final-third entries','Entradas al último tercio'],box_entries:['Box entries','Entradas al área'],field_tilt_tp:['Field tilt TP','Dominio territorial TP'],
  high_recoveries:['High recoveries','Recuperaciones altas'],own_half_losses:['Own-half losses','Pérdidas en campo propio'],own_third_losses:['Own-third losses','Pérdidas en primer tercio'],
  recovery_time_s:['Mean recovery time','Tiempo medio para recuperar'],recovery_episodes_completed:['Completed recovery episodes','Episodios de recuperación completos'],
  recovery_episodes_open:['Open recovery episodes','Episodios de recuperación abiertos'],counterpress_recoveries_tp:['Counterpress recoveries TP','Recuperaciones tras pérdida TP'],
  pressure_attempts:['Pressure attempts','Intentos de presión'],pressure_linked_recoveries:['Pressure-linked recoveries','Recuperaciones vinculadas a presión'],
  passes_per_intervention_tp:['Passes per intervention TP','Pases por intervención TP'],sequence_duration_s:['Mean sequence duration','Duración media de secuencia'],
  passes_per_sequence:['Completed passes per sequence','Pases completados por secuencia'],sequence_progress_m:['Mean sequence progress','Avance medio por secuencia'],
  sequence_direct_speed_m_s:['Mean direct sequence speed','Velocidad directa media de secuencia'],defensive_line_height_m:['Defensive line height','Altura de línea defensiva'],
  def_mid_gap_m:['Defence–midfield gap','Distancia defensa–medio'],mid_fwd_gap_m:['Midfield–attack gap','Distancia medio–ataque'],team_length_m:['Team length','Longitud del equipo'],team_width_m:['Team width','Anchura del equipo'],
  possession_own_third_pct:['Possession in own third','Posesión en primer tercio'],possession_middle_third_pct:['Possession in middle third','Posesión en tercio medio'],possession_opponent_third_pct:['Possession in opponent third','Posesión en último tercio'],
  distance_m:['Distance','Distancia'],distance_km_per90:['Distance per 90','Distancia por 90'],metres_per_minute:['Metres per minute','Metros por minuto'],
  hsr_distance_m:['HSR distance (20–25 km/h)','Distancia HSR (20–25 km/h)'],sprint_distance_m:['Sprint distance (>25 km/h)','Distancia de esprint (>25 km/h)'],
  sprint_count:['Sprints (≥1 s)','Esprints (≥1 s)'],sprint_duration_s:['Time above sprint threshold','Tiempo sobre umbral de esprint'],max_speed_kmh:['Maximum speed','Velocidad máxima'],
  high_acceleration_count:['High accelerations (≥1 s)','Aceleraciones intensas (≥1 s)'],high_deceleration_count:['High decelerations (≥1 s)','Frenadas intensas (≥1 s)'],
  xg:['Recorded xG (FPL)','xG registrado (FPL)'],xa:['Recorded xA (FPL)','xA registrado (FPL)'],starts:['Recorded starts','Titularidades registradas'],
  tackles:['Recorded tackles','Entradas registradas'],recoveries:['Recorded recoveries','Recuperaciones registradas'],cbi:['Clearances, blocks and interceptions','Despejes, bloqueos e intercepciones'],
};
export function metricLabel(id:string,locale:string):string {
  const phase=['_out_of_possession','_in_possession'].find(s=>id.endsWith(s));
  if(phase) return metricLabel(id.slice(0,-phase.length),locale)+' · '+(locale==='es'?(phase==='_in_possession'?'con balón':'sin balón'):(phase==='_in_possession'?'in possession':'out of possession'));
  return labels[id]?.[locale==='es'?1:0]??id.replaceAll('_',' ');
}
export function useStatsText(){const {locale}=useLanguage();return locale==='es'?es:en;}
export function unitLabel(unit:string,locale:string){return locale!=='es'?unit:({'count':'recuento','goals':'goles','xG/shot':'xG/tiro','passes/sequence':'pases/secuencia','passes/intervention':'pases/intervención'} as Record<string,string>)[unit]??unit;}
export function statisticsClock(ms:number,locale:string){const rest=ms%1000;return clockLabel(ms)+(rest?(locale==='es'?',':'.')+String(rest).padStart(3,'0'):'');}
export function reasonText(reason:string|null|undefined,locale:string){const t=locale==='es'?es:en;return reason==='legacy_no_motion'?t.noMotion:reason==='legacy_no_context'?t.noContext:reason==='zero_denominator'?t.zero:reason==='insufficient_samples'?t.insufficient:reason==='missing_supplement'?t.missing:reason==='partial_field_coverage'?t.partialNote:t.notCovered;}
export function metricHelp(id:string,locale:string){
  const es=locale==='es';
  if(id.startsWith('simulated_')||id==='goals_minus_xg')return es?'Probabilidades generativas del motor, sumadas una vez por tiro. No es un modelo independiente de xG de proveedor.':'Engine generative probabilities, summed once per shot. This is not an independent provider xG model.';
  if(id==='key_passes'||id==='xg_assisted')return es?'Último pase completado al rematador: misma secuencia, hasta 5 s y 5 m de conducción. Solo el primer remate.':'Last completed delivery to the shooter: same sequence, at most 5 seconds and 5 metres carried. First shot only.';
  if(id.startsWith('progressive_'))return es?'Reducción de distancia a portería: 30 m en campo propio, 15 m al cruzar y 10 m en campo rival.':'Distance-to-goal reduction: 30 m in own half, 15 m crossing halfway and 10 m in opponent half.';
  if(id==='field_tilt_tp')return es?'Pases completados con ambos extremos en el último tercio, divididos por los de ambos equipos. Variante TP.':'Completed passes with both endpoints in the attacking third, divided by eligible passes of both sides. TP variant.';
  if(id==='passes_per_intervention_tp')return es?'Pases rivales completados dentro de su 60% inicial por entrada ganada o intercepción propia allí. No incluye faltas ni bloqueos; no es PPDA de proveedor.':'Rival completed passes inside their initial 60% per own won tackle or interception there. No fouls or blocks; this is not provider PPDA.';
  if(id.startsWith('sequence_')||id==='passes_per_sequence')return es?'Secuencias desde el control; el tiro cierra al golpeo. Las abiertas usan el último extremo de acción resuelta.':'Sequences start at control; shots close at release. Open sequences use the last resolved action endpoint.';
  if(metricGroups.effort.includes(id as never))return es?'Muestras canónicas simuladas, sin recolocaciones. Tasas por minutos observados; episodios de al menos 1 s y derivadas causales sin filtro futuro.':'Canonical simulated samples, excluding resets. Rates use observed minutes; episodes last at least 1 second and derivatives use no future filter.';
  if(metricGroups.shape.includes(id as never))return es?'Geometría por roles sin portero, media ponderada por tiempo vivo y fase. No identifica líneas profesionales.':'Outfield role geometry, averaged by live time and phase. This is not professional line detection.';
  if(id.includes('recovery')||id.includes('recoveries'))return es?'La media usa episodios completos; los abiertos se informan aparte. Tras pérdida TP exige menos de 5 s; presión requiere vínculo causal.':'Means use completed episodes; open episodes are separate. Counterpress TP requires under 5 seconds; pressure needs a causal link.';
  return es?'Derivada de eventos o muestras resueltos hasta el instante indicado. Un cero medido y un dato ausente se distinguen.':'Derived from resolved events or samples through the stated instant. An observed zero differs from missing data.';
}
