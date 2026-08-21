/** Y-axis bounds for the viewers lane. Fit mode always includes the full positive source range. */

export type ViewerScaleAxis = {
  min: number
  max: number
  mode: 'fit' | 'peak'
}

const FIT_TOP_PAD = 0.03

export function viewerScaleBounds(
  values: Array<number | null | undefined>,
  streamPeak: number,
  fitToVisible: boolean,
): ViewerScaleAxis {
  const safeStreamPeak = Number.isFinite(streamPeak) && streamPeak > 0 ? streamPeak : 0
  const positive: number[] = []
  for (const v of values) {
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) positive.push(v)
  }

  if (!fitToVisible) {
    const peakMax = Math.max(1, Math.ceil(safeStreamPeak), ...positive.map((v) => Math.ceil(v)))
    return { min: 0, max: peakMax, mode: 'peak' }
  }

  if (positive.length === 0) {
    return { min: 0, max: Math.max(1, Math.ceil(safeStreamPeak)), mode: 'fit' }
  }

  const absoluteMax = Math.max(safeStreamPeak, ...positive)
  const topPad = Math.max(1, Math.ceil(absoluteMax * FIT_TOP_PAD))
  const fitMin = 0
  const fitMax = Math.max(fitMin + 1, Math.ceil(absoluteMax + topPad))

  return { min: fitMin, max: fitMax, mode: 'fit' }
}
