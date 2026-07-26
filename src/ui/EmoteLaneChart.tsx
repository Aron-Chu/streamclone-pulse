import { useLayoutEffect, useRef } from 'react'
import type { CSSProperties } from 'react'

export interface EmoteLaneChartProps {
  values: number[]
  color: string
  height?: number
  primary?: boolean
}

/** Compact per-emote sparkline — mirrors analytics emote lanes under the main chart. */
export function EmoteLaneChart({ values, color, height = 22, primary = false }: EmoteLaneChartProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const parent = canvas.parentElement
    const cssWidth = Math.max(1, parent?.clientWidth ?? canvas.clientWidth ?? 120)
    const cssHeight = Math.max(1, height)
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
    canvas.width = Math.floor(cssWidth * dpr)
    canvas.height = Math.floor(cssHeight * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cssWidth, cssHeight)

    if (values.length < 2) return
    const max = Math.max(1, ...values)
    const pad = 2
    const usableH = cssHeight - pad * 2
    const stepX = cssWidth / Math.max(1, values.length - 1)
    const coords = values.map((value, index) => {
      const x = index * stepX
      const y = pad + usableH - (Math.max(0, value) / max) * usableH
      return [x, y] as const
    })

    ctx.beginPath()
    coords.forEach(([x, y], index) => (index === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
    ctx.lineWidth = primary ? 1.75 : 1.25
    ctx.strokeStyle = color
    ctx.setLineDash(primary ? [5, 4] : [3, 3])
    ctx.lineJoin = 'round'
    ctx.stroke()
    ctx.setLineDash([])
  }, [color, height, primary, values])

  return <canvas ref={canvasRef} style={{ ...styles.canvas, height }} aria-hidden="true" />
}

const styles: Record<string, CSSProperties> = {
  canvas: { display: 'block', width: '100%' },
}
