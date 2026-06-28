import { forwardRef } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Search } from 'lucide-react'
import { cn } from './cn'

export interface SearchInputProps {
  value: string
  onValueChange: (value: string) => void
  onSubmit?: (value: string) => void
  placeholder?: string
  id?: string
  name?: string
  'aria-label'?: string
  autoFocus?: boolean
  disabled?: boolean
  kbdHint?: string[]
  trailing?: ReactNode
  className?: string
  inputClassName?: string
}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  {
    value,
    onValueChange,
    onSubmit,
    placeholder = 'Search…',
    id,
    name,
    autoFocus,
    disabled,
    kbdHint,
    trailing,
    className,
    inputClassName,
    'aria-label': ariaLabel,
  },
  ref,
) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onSubmit?.(value.trim())
  }

  return (
    <form className={cn('sc-search', className)} role="search" onSubmit={handleSubmit}>
      <span className="sc-search__icon" aria-hidden="true">
        <Search />
      </span>
      <input
        ref={ref}
        id={id}
        name={name}
        type="search"
        autoComplete="off"
        autoFocus={autoFocus}
        disabled={disabled}
        className={cn('sc-input', 'sc-search__input', inputClassName)}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
      />
      {trailing ? (
        <span className="sc-search__kbd">{trailing}</span>
      ) : kbdHint && kbdHint.length > 0 ? (
        <span className="sc-search__kbd" aria-hidden="true">
          {kbdHint.map((key) => (
            <kbd key={key}>{key}</kbd>
          ))}
        </span>
      ) : null}
    </form>
  )
})
