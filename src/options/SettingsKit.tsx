import { type ReactNode, useId } from 'react'

/** Fieldset + legend + bordered group, matching the shadcn settings mockup. */
export function Section({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="set-fieldset">
      <legend className="set-legend">{legend}</legend>
      <div className="set-group">{children}</div>
    </fieldset>
  )
}

export interface TabItem<T extends string> {
  value: T
  label: string
}

/** Secondary tab strip (role=tablist) for switching between settings groups. */
export function TabRow<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T
  options: TabItem<T>[]
  onChange: (next: T) => void
  ariaLabel: string
}) {
  return (
    <div className="set-tabs" role="tablist" aria-label={ariaLabel}>
      {options.map(option => (
        <button
          key={option.value}
          type="button"
          role="tab"
          className="set-tab"
          aria-selected={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/** Toggle row with role=switch (native button keyboard activation). */
export function SwitchRow({
  label,
  help,
  checked,
  onChange,
}: {
  label: string
  help?: ReactNode
  checked: boolean
  onChange: (next: boolean) => void
}) {
  const labelId = useId()
  return (
    <div className="set-row">
      <div className="txt">
        <span className="lbl" id={labelId}>
          {label}
        </span>
        {help ? <span className="help">{help}</span> : null}
      </div>
      <button
        type="button"
        role="switch"
        className="set-switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        onClick={() => onChange(!checked)}
      />
    </div>
  )
}

export interface SegOption<T extends string> {
  value: T
  label: string
}

/** Segmented (tablist-style) control rendered as a labelled field. */
export function SegmentedRow<T extends string>({
  label,
  help,
  value,
  options,
  onChange,
}: {
  label: string
  help?: ReactNode
  value: T
  options: SegOption<T>[]
  onChange: (next: T) => void
}) {
  return (
    <div className="set-fld">
      <span className="lt">{label}</span>
      <div className="set-seg" role="group" aria-label={label}>
        {options.map(option => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      {help ? <span className="help">{help}</span> : null}
    </div>
  )
}

/** Range slider with a live value chip + aria-valuetext mirror. */
export function SliderRow({
  label,
  display,
  ariaValueText,
  min,
  max,
  step,
  value,
  scaleMin,
  scaleMax,
  help,
  onChange,
}: {
  label: string
  display: string
  ariaValueText: string
  min: number
  max: number
  step: number
  value: number
  scaleMin: string
  scaleMax: string
  help?: ReactNode
  onChange: (next: number) => void
}) {
  const id = useId()
  const helpId = useId()
  return (
    <div className="set-slider">
      <div className="head">
        <span className="lt">
          <label htmlFor={id}>{label}</label>
        </span>
        <span className="val tnum">{display}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={ariaValueText}
        aria-describedby={help ? helpId : undefined}
        onChange={event => onChange(Number(event.target.value))}
      />
      <div className="scale">
        <span>{scaleMin}</span>
        <span>{scaleMax}</span>
      </div>
      {help ? (
        <span className="help muted" id={helpId} style={{ fontSize: '0.64rem' }}>
          {help}
        </span>
      ) : null}
    </div>
  )
}

/** Select rendered as a labelled field. */
export function SelectRow<T extends string>({
  label,
  help,
  value,
  options,
  onChange,
}: {
  label: string
  help?: ReactNode
  value: T
  options: SegOption<T>[]
  onChange: (next: T) => void
}) {
  const id = useId()
  const helpId = useId()
  return (
    <div className="set-fld">
      <label className="lt" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className="set-input"
        value={value}
        aria-describedby={help ? helpId : undefined}
        onChange={event => onChange(event.target.value as T)}
      >
        {options.map(option => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {help ? (
        <span className="help" id={helpId}>
          {help}
        </span>
      ) : null}
    </div>
  )
}

/** Sticky save/reset footer with dirty-state messaging. */
export function StickyFooter({
  dirty,
  stateText,
  onReset,
  onSave,
  saving,
}: {
  dirty: boolean
  stateText: string
  onReset: () => void
  onSave: () => void
  saving: boolean
}) {
  return (
    <div className="set-foot">
      <span className={`state${dirty ? ' dirty' : ''}`} aria-live="polite">
        {stateText}
      </span>
      <button
        type="button"
        className="set-btn set-btn-outline"
        onClick={onReset}
        disabled={!dirty || saving}
      >
        Reset
      </button>
      <button
        type="button"
        className="set-btn set-btn-primary"
        onClick={onSave}
        disabled={!dirty || saving}
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  )
}
