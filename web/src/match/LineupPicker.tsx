import { useLanguage } from '../i18n';
import { slots, type Formation, type Tactic } from './lineup';
import { useMatchText } from './messages';
import type { TeamSelection } from './useTeam';
import {useGrfText} from '../grf/messages';

export function LineupPicker({ selection,disableTactics=false }: { selection: TeamSelection;disableTactics?:boolean }) {
  const m = useMatchText(), { t } = useLanguage();
  const g=useGrfText();
  const { team, formation, tactic, players } = selection;
  if (!team) return null;
  return <section className="lineup-picker"><div className="filter-row">
    <label>{m.formation}<select value={formation} onChange={e => selection.setFormation(e.target.value as Formation)}>{team.available_formations.map(f => <option key={f}>{f}</option>)}</select></label>
    <label>{m.tactic}<select disabled={disableTactics} value={disableTactics?'balanced':tactic} onChange={e => selection.setTactic(e.target.value as Tactic)}>{disableTactics?<option value="balanced">{g.nativeAI}</option>:(['balanced', 'press', 'counter'] as const).map(v => <option key={v} value={v}>{m[v]}</option>)}</select></label>
  </div>{disableTactics&&<p className="small-note">{g.tactics}</p>}<details><summary>{m.lineup} · {formation}</summary><p className="small-note">{m.lineupNote}</p><div className="lineup-slots">
    {slots(formation).map((role, i) => <label key={i}>{i + 1} · {t[role as 'GK' | 'DEF' | 'MID' | 'FWD']}<select value={players[i] ?? ''} onChange={e => selection.setPlayers(players.map((v, index) => i === index ? e.target.value : v))}>
      {!players[i] && <option value="">{t.choose}</option>}{team.players.filter(p => p.role === role).map(p => <option key={p.key} value={p.key} disabled={players.includes(p.key) && players[i] !== p.key}>{p.name}</option>)}
    </select></label>)}
  </div></details></section>;
}
