import { Children, isValidElement, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown } from 'lucide-react'

/** Shared, keyboard-operable filter menu. Options keep their native value/disabled contract. */
export function MomentSelect({ children, value, onValueChange, 'aria-label': label }: {
  children: ReactNode; value: string; onValueChange: (value: string) => void; 'aria-label': string
}) {
  const options = Children.toArray(children).flatMap(child => {
    if (!isValidElement<{ value?: string; children?: ReactNode; disabled?: boolean }>(child)) return []
    const text = String(child.props.children ?? '')
    return [{ value: child.props.value ?? text, label: text, disabled: Boolean(child.props.disabled) }]
  })
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const typed = useRef({ text: '', at: 0 })
  const id = useId()
  const selected = options.findIndex(option => option.value === value)
  const close = (focus = false) => { setOpen(false); if (focus) trigger.current?.focus() }
  const show = () => { setActive(selected >= 0 ? selected : Math.max(0, options.findIndex(option => !option.disabled))); setOpen(true) }
  const choose = (index: number) => {
    const option = options[index]
    if (!option || option.disabled) return
    onValueChange(option.value); close(true)
  }
  useEffect(() => {
    if (!open) return
    list.current?.focus()
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])
  useEffect(() => { if (open) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: 'nearest' }) }, [active, open, id])
  const move = (direction: number) => {
    for (let step = 1; step <= options.length; step++) {
      const index = (active + step * direction + options.length) % options.length
      if (!options[index]?.disabled) { setActive(index); break }
    }
  }
  return <div className="moment-select" ref={root} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false)
  }}>
    <button ref={trigger} type="button" role="combobox" aria-label={label} aria-expanded={open}
      aria-controls={`${id}-list`} aria-haspopup="listbox" onClick={() => open ? close() : show()}
      onKeyDown={event => { if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); show() } }}>
      <span>{options[selected]?.label ?? value}</span><ChevronDown size={16} aria-hidden="true" />
    </button>
    {open ? <div className="moment-select-menu" ref={list} id={`${id}-list`} role="listbox" aria-label={label}
      tabIndex={-1} aria-activedescendant={`${id}-${active}`} onKeyDown={event => {
        if (event.key === 'Tab') { close(); return }
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) event.preventDefault()
        if (event.key === 'ArrowDown') move(1)
        else if (event.key === 'ArrowUp') move(-1)
        else if (event.key === 'Home') setActive(options.findIndex(option => !option.disabled))
        else if (event.key === 'End') setActive(options.map(option => !option.disabled).lastIndexOf(true))
        else if (event.key === 'Enter' || event.key === ' ') choose(active)
        else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          typed.current = { text: (Date.now() - typed.current.at < 700 ? typed.current.text : '') + event.key.toLowerCase(), at: Date.now() }
          const match = options.findIndex(option => !option.disabled && option.label.toLowerCase().startsWith(typed.current.text))
          if (match >= 0) setActive(match)
        }
      }}>
      {options.map((option, index) => <div key={option.value} id={`${id}-${index}`} role="option"
        aria-selected={option.value === value} aria-disabled={option.disabled || undefined}
        className={active === index ? 'is-active' : ''} onMouseEnter={() => { if (!option.disabled) setActive(index) }}
        onPointerDown={event => event.preventDefault()} onClick={() => choose(index)}>
        <span>{option.label}</span>{option.value === value ? <Check size={15} aria-hidden="true" /> : null}
      </div>)}
    </div> : null}
  </div>
}
