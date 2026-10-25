// TP248 (25-oct: «el menú principal es un poco confuso porque no ves las opciones claras de renderizado el motor»):
// motor y gráficos a la vista junto a «Jugar partido», como dos grupos de botones, no escondidos en «Opciones».
export type MatchChoice<T extends string> = Readonly<{ value: T; label: string; hint: string; disabled?: boolean }>;

export function ChoiceGroup<T extends string>({ name, title, value, options, disabled = false, onChange }: {
  name: string; title: string; value: T; options: readonly MatchChoice<T>[]; disabled?: boolean; onChange: (value: T) => void;
}) {
  return <fieldset className="vs-choice" disabled={disabled}>
    <legend>{title}</legend>
    <div className="vs-seg">{options.map(o => <label key={o.value} className={o.value === value ? 'on' : undefined} aria-disabled={o.disabled || undefined}>
      <input type="radio" name={name} value={o.value} checked={o.value === value} disabled={o.disabled} onChange={() => onChange(o.value)} />
      <b>{o.label}</b><small>{o.hint}</small>
    </label>)}</div>
  </fieldset>;
}
