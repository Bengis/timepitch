// TP263: «Pregúntale al partido». Al acabar un partido simulado, el aficionado pregunta y un agente de IA en Azure
// consulta con herramientas los hechos grabados que necesita. Cada frase de la respuesta se comprueba en el servidor
// contra esos hechos antes de llegar aquí; si no pasa, llegan los hechos tal cual. Aquí solo se pregunta y se muestra.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { defineTexts, type Locale } from '../i18n-catalog';
import { namesMode } from '../catalog/fictional';
import './crew-report.css';

type Engine = 'grf' | 'touchlines';
type Sentence = { text: string; fact_ids: string[] };
type Answer = { status: 'answered' | 'facts_only' | 'off_topic'; sentences: Sentence[]; fetched: string[]; cost: string };
type Entry = { question: string; answer?: Answer; error?: string };

const TEXT = defineTexts('ask', {
  en: { title: 'Ask the match', badge: 'AI agent · tools · Azure AI Foundry', placeholder: 'Ask about this match…', ask: 'Ask',
    suggestions: ['Who scored, and when?', 'Which side had more shots?', 'How did the first half compare?'],
    thinking: 'The agent is looking up the recorded facts…',
    checked: (n: number) => `Checked against ${n} recorded fact${n === 1 ? '' : 's'} the agent fetched.`,
    references: 'Fact IDs for this sentence', evidence: 'Facts fetched by the agent',
    identifiersOnly: 'Identifiers returned by the API; the source fact text and event times are not included.',
    cost: (value: string) => `Answer cost: ${value} USD`,
    aiNotice: 'AI answers from the recorded match.', howTitle: 'How answers are checked',
    verificationLimit: 'Checks compare names and numbers with the cited facts. They do not guarantee the interpretation of the match.',
    factsOnly: 'The AI answer did not pass the fact check, so these are the recorded facts the agent fetched.',
    offTopic: 'I can only answer questions about this match, from what the engine recorded.',
    busy: 'Still answering your previous question.', limit: 'You have reached today\'s questions.',
    budget: 'The questions budget for the demo is used up.', failed: 'The question could not be answered this time.',
    how: 'An AI agent (Microsoft Agent Framework) calls tools to fetch the recorded facts it needs; every sentence is checked before you see it.' },
  es: { title: 'Pregúntale al partido', badge: 'Agente IA · herramientas · Azure AI Foundry', placeholder: 'Pregunta sobre este partido…', ask: 'Preguntar',
    suggestions: ['¿Quién marcó y cuándo?', '¿Qué equipo tiró más?', '¿Cómo fue la primera parte?'],
    thinking: 'El agente está consultando los hechos grabados…',
    checked: (n: number) => `Comprobada con ${n} ${n === 1 ? 'hecho grabado' : 'hechos grabados'} que consultó el agente.`,
    references: 'IDs de hechos de esta frase', evidence: 'Hechos consultados por el agente',
    identifiersOnly: 'Identificadores devueltos por la API; no se incluye el texto original del hecho ni su tiempo de evento.',
    cost: (value: string) => `Coste de la respuesta: ${value} USD`,
    aiNotice: 'Respuestas IA basadas en el partido grabado.', howTitle: 'Cómo se comprueban las respuestas',
    verificationLimit: 'La comprobación contrasta nombres y cifras con los hechos citados. No garantiza la interpretación del partido.',
    factsOnly: 'La respuesta de la IA no pasó la comprobación, así que estos son los hechos que consultó el agente.',
    offTopic: 'Solo puedo responder sobre este partido, con lo que grabó el motor.',
    busy: 'Todavía estoy respondiendo tu pregunta anterior.', limit: 'Has llegado a las preguntas de hoy.',
    budget: 'Se ha agotado el presupuesto de preguntas de la demo.', failed: 'Esta vez no se pudo responder la pregunta.',
    how: 'Un agente de IA (Microsoft Agent Framework) usa herramientas para consultar los hechos grabados que necesita; cada frase se comprueba antes de mostrarla.' },
});

export function MatchQuestions({ engine, matchId, locale, ended }: { engine: Engine; matchId: string; locale: Locale; ended: boolean }) {
  const t = TEXT(locale);
  const [available, setAvailable] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const request = useRef<AbortController | null>(null);
  const scope = `${engine}:${matchId}:${locale}:${namesMode()}:${ended}`;

  useEffect(() => {
    setEntries([]); setDraft(''); setBusy(false);
    return () => { request.current?.abort(); request.current = null; };
  }, [scope]);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    void fetch('/api/crew/ask/status', { credentials: 'same-origin', signal: controller.signal }).then(r => r.ok ? r.json() : null)
      .then(body => { if (alive) setAvailable((body as { available?: boolean } | null)?.available === true); })
      .catch(() => { if (alive) setAvailable(false); });
    return () => { alive = false; controller.abort(); };
  }, []);

  if (!available || !ended) return null;

  const ask = async (question: string) => {
    const q = question.trim();
    if (q.length < 3 || busy || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true); setDraft('');
    setEntries(list => [...list, { question: q }]);
    let entry: Entry = { question: q };
    try {
      const response = await fetch('/api/crew/ask', { method: 'POST', credentials: 'same-origin', signal: controller.signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engine, match_id: matchId, locale, names: namesMode(), question: q.slice(0, 200) }) });
      const body = await response.json().catch(() => null) as Answer & { detail?: string } | null;
      if (response.ok && body) entry = { question: q, answer: body };
      else entry = { question: q, error: response.status === 429 ? (body?.detail ?? 'failed') : 'failed' };
    } catch { entry = { question: q, error: 'failed' }; }
    if (controller.signal.aborted || request.current !== controller) return;
    request.current = null;
    setEntries(list => [...list.slice(0, -1), entry]);
    setBusy(false);
  };
  const submit = (e: FormEvent) => { e.preventDefault(); void ask(draft); };
  const errorText = (code: string) => code === 'one_in_flight' ? t.busy : code === 'daily_limit' ? t.limit : code === 'budget_exhausted' ? t.budget : t.failed;

  return <section className="crew-report match-questions" lang={locale} aria-labelledby="match-questions-title">
    <header className="crew-report-head">
      <h2 id="match-questions-title">{t.title}</h2>
    </header>
    <p className="crew-report-teaser">{t.aiNotice}</p>
    {entries.length === 0 && <div className="match-questions-suggestions">
      {t.suggestions.map(s => <button key={s} type="button" disabled={busy} onClick={() => { void ask(s); }}>{s}</button>)}
    </div>}
    <ol className="match-questions-list" aria-live="polite">
      {entries.map((entry, i) => <li key={i}>
        <p className="match-questions-q">{entry.question}</p>
        {!entry.answer && !entry.error && <p className="crew-report-teaser crew-live-pending" role="status"><span className="crew-live-spinner" aria-hidden="true" />{t.thinking}</p>}
        {entry.error && <p className="crew-report-teaser" role="status">{errorText(entry.error)}</p>}
        {entry.answer?.status === 'off_topic' && <p className="crew-report-teaser">{t.offTopic}</p>}
        {entry.answer && entry.answer.status !== 'off_topic' && <>
          {entry.answer.status === 'facts_only' && <p className="crew-report-teaser">{t.factsOnly}</p>}
          <ol className="match-questions-sentences">{entry.answer.sentences.map((s, j) => <li key={j} data-fact-ids={s.fact_ids.join(' ')}>
            <p className="match-questions-a">{s.text}</p>
          </li>)}</ol>
          {entry.answer.status === 'answered' && <p className="match-questions-check">✓ {t.checked(new Set(entry.answer.sentences.flatMap(s => s.fact_ids)).size)}</p>}
        </>}
        {entry.answer && <>
          <details className="match-questions-evidence">
            <summary>{t.evidence} ({entry.answer.fetched.length})</summary>
            <p className="match-questions-cost">{t.cost(entry.answer.cost)}</p>
            <ol>{entry.answer.sentences.map((s, j) => <li key={j} className="match-questions-references">
              {t.references}: {s.fact_ids.map((id, k) => <code key={k}>{id}</code>)}
            </li>)}</ol>
            <p>{t.identifiersOnly}</p>
            <ul>{entry.answer.fetched.map((id, j) => <li key={j}><code>{id}</code></li>)}</ul>
          </details>
        </>}
      </li>)}
    </ol>
    <form className="match-questions-form" onSubmit={submit}>
      <input type="text" value={draft} maxLength={200} placeholder={t.placeholder} aria-label={t.placeholder}
        onChange={e => setDraft(e.target.value)} disabled={busy} />
      <button type="submit" disabled={busy || draft.trim().length < 3}>{t.ask}</button>
    </form>
    <footer className="crew-report-foot">
      <p>{t.verificationLimit}</p>
      <details className="crew-how"><summary>{t.howTitle}</summary><p>{t.badge}</p><p>{t.how}</p></details>
    </footer>
  </section>;
}
