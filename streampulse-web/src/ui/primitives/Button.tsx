import { forwardRef } from 'react'
import type { ButtonHTMLAttributes } from 'react'
import { cn } from './cn'

export type ButtonVariant =
  | 'default'
  | 'secondary'
  | 'outline'
  | 'ghost'
  | 'destructive'
  | 'brand'
export type ButtonSize = 'default' | 'sm' | 'lg' | 'icon'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  block?: boolean
}

export function buttonClass(
  variant: ButtonVariant = 'default',
  size: ButtonSize = 'default',
  options: { block?: boolean; className?: string } = {},
): string {
  return cn(
    'sc-btn',
    `sc-btn--${variant}`,
    size !== 'default' && `sc-btn--${size}`,
    options.block && 'sc-btn--block',
    options.className,
  )
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'default', size = 'default', block = false, className, type, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={buttonClass(variant, size, { block, className })}
      {...rest}
    />
  )
})
