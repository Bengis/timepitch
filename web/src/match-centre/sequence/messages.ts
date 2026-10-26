import { useLanguage } from '../../i18n';
import { defineTexts } from '../../i18n-catalog';
const en={thisPlay:'This play',details:'Match details',replay:'Replay sequence',next:'Next moment',position:'Sequence position',
  evidence:'View evidence',source:'Recorded events · Synthetic movement',start:'Watch how the play develops.',quality:'Shot quality · StatsBomb xG',
  unavailable:'Movement unavailable for this interval',loading:'Preparing the saved sequence…',pilotUnavailable:'Sequence preview unavailable. The ordinary viewer remains available.',
  retry:'Try again',sequence:'This sequence',clipEnd:'End of sequence',continue:'Start second half',first:'1st half',second:'2nd half',full:'Full-time',
  settings:'Display settings',players:'Inspect player',context:'Illustrative movement; analysis uses recorded events.',historical:'Historical reconstruction',boundary:'Half-time check'};
const es:Record<keyof typeof en,string>={thisPlay:'Esta jugada',details:'Detalles del partido',replay:'Repetir secuencia',next:'Siguiente momento',position:'Posición de la secuencia',
  evidence:'Ver evidencias',source:'Eventos reales · Movimiento sintético',start:'Observa cómo se desarrolla la jugada.',quality:'Calidad del tiro · xG de StatsBomb',
  unavailable:'Movimiento no disponible en este intervalo',loading:'Preparando la secuencia guardada…',pilotUnavailable:'Vista de secuencia no disponible. Puedes usar el visor habitual.',
  retry:'Reintentar',sequence:'Esta secuencia',clipEnd:'Fin de la secuencia',continue:'Empezar la segunda parte',first:'1.ª parte',second:'2.ª parte',full:'Final del partido',
  settings:'Ajustes de imagen',players:'Ver jugador',context:'Movimiento ilustrativo; el análisis utiliza eventos registrados.',historical:'Reconstrucción histórica',boundary:'Comprobación del descanso'};
const TEXTS = defineTexts('sequence', { en, es });
export function useSequenceText(){return TEXTS(useLanguage().locale);}
