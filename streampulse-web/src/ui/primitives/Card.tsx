import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from './cn'

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  interactive?: boolean
}

export function Card({ interactive = false, className, ...rest }: CardProps) {
  return (
    <div
      className={cn('sc-card', interactive && 'sc-card--interactive', className)}
      {...rest}
    />
  )
}

export interface CardHeaderProps extends HTMLAttributes<HTMLDivElement> {
  row?: boolean
}

export function CardHeader({ row = false, className, ...rest }: CardHeaderProps) {
  return <div className={cn('sc-card__header', row && 'sc-card__header--row', className)} {...rest} />
}

export function CardTitle({
  as: Tag = 'h3',
  className,
  ...rest
}: HTMLAttributes<HTMLHeadingElement> & { as?: 'h2' | 'h3' | 'h4' }) {
  return <Tag className={cn('sc-card__title', className)} {...rest} />
}

export function CardDescription({ className, ...rest }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('sc-card__desc', className)} {...rest} />
}

export function CardContent({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('sc-card__content', className)} {...rest} />
}

export interface CardWithTitleProps {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
  contentClassName?: string
}

/** Convenience composition for the common "titled card" pattern. */
export function TitledCard({
  title,
  description,
  action,
  children,
  className,
  contentClassName,
}: CardWithTitleProps) {
  return (
    <Card className={className}>
      <CardHeader row={Boolean(action)}>
        <div>
          <CardTitle>{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        {action}
      </CardHeader>
      <CardContent className={contentClassName}>{children}</CardContent>
    </Card>
  )
}
