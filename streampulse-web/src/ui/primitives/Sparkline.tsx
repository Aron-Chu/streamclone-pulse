import { useId } from 'react'
import { cn } from './cn'

export interface SparklineProps {
  data: number[]
  width?: number
  height?: number
  /** chart token index 1-5 for the stroke colour. */
  tone?: 1 | 2 | 3 | 4 | 5
  fill?: boolean
  className?: string
  'aria-label'?: string
}

function buildPoints(data: number[], width: number, height: number) {
  if (data.length === 0) return { line: '', area: '' }
  const max = Math.max(...data)
  const min = Math.min(...data)
  const range = max - min || 1
  const stepX = data.length > 1 ? width / (data.length - 1) : 0
  const pad = 2
  const usable = height - pad * 2
  const coords = data.map((value, index) => {
    const x = data.length > 1 ? index * stepX : width / 2
    const y = pad + (1 - (value - min) / range) * usable
    return [Number(x.toFixed(2)), Number(y.toFixed(2))] as const
  })
  const line = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x} ${y}`).join(' ')
  const area = `${line} L${coords[coords.length - 1][0]} ${height} L${coords[0][0]} ${height} Z`
  return { line, area }
}

export function Sparkline({
  data,
  width = 120,
  height = 36,
  tone = 2,
  fill = true,
  className,
  'aria-label': ariaLabel,
}: SparklineProps) {
  const gradientId = useId()
  const { line, area } = buildPoints(data, width, height)
  const stroke = `hsl(var(--sc-chart-${tone}))`

  if (!line) {
    return <svg className={cn('sc-sparkline', className)} width={width} height={height} aria-hidden="true" />
  }

  return (
    <svg
      className={cn('sc-sparkline', className)}
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      preserveAspectRatio="none"
      role={ariaLabel ? 'img' : 'presentation'}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
    >
      {fill ? (
        <>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
              <stop offset="100%" stopColor={stroke} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${gradientId})`} stroke="none" />
        </>
      ) : null}
      <path className="sc-sparkline__line" d={line} style={{ stroke }} />
    </svg>
  )
}
