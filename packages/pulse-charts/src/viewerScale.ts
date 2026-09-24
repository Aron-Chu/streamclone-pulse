/** Y-axis bounds for the viewers lane. Compact fit mode stays zero-anchored so
 * ordinary Helix snapshot changes are not exaggerated into dramatic spikes. */

export type ViewerScaleAxis = {
  min: number
  max: number
  mode: 'fit' | 'peak'
}

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

  const observedMax = Math.max(...positive)
  const absoluteMax = Math.max(safeStreamPeak, observedMax)
  const pad = Math.max(1, absoluteMax * 0.03)
  const fitMin = 0
  const fitMax = Math.max(1, Math.ceil(absoluteMax + pad))

  return { min: fitMin, max: fitMax, mode: 'fit' }
}
