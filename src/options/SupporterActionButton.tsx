import { forwardRef, type ComponentPropsWithoutRef } from 'react'

/** Busy actions stay in the tab order; ARIA alone does not block activation. */
export const SupporterActionButton = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<'button'>>(function SupporterActionButton({ disabled, onClick, ...props }, ref) {
  return <button {...props} ref={ref} aria-disabled={disabled || undefined} onClick={event => {
    if (disabled) { event.preventDefault(); return }
    onClick?.(event)
  }} />
})
