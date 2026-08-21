import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ComponentProps,
} from 'react'
import type { LiveHeatPoint } from '@streampulse/pulse-core'
import { LiveStatsBand } from './LiveStatsBand.tsx'
import { MostReactedSection } from './MostReactedSection.tsx'
import {
  EMPTY_MOMENT_INSPECTION,
  inspectionSelectionFromPoint,
  reduceMomentInspection,
  type InspectionSelection,
} from './momentInspection.ts'
import { createFrameCoalescer } from './frameCoalescer.ts'
import { createInspectionPreviewStore } from './inspectionPreviewStore.ts'

type LiveStatsSurfaceProps = Omit<
  ComponentProps<typeof LiveStatsBand>,
  | 'inspectionPreview'
  | 'inspectionPreviewStore'
  | 'inspectionCommitted'
   | 'onInspectionPreview'
   | 'onInspectionCommit'
   | 'onInspectionClear'
   | 'pinOffsetSeconds'
   | 'previewOffsetSeconds'
   | 'onPinOffset'
>

type MostReactedSurfaceProps = Omit<
  ComponentProps<typeof MostReactedSection>,
  'pinnedOffsetSeconds' | 'onPreviewMoment' | 'onSelectMoment' | 'onHighlightOffset' | 'onPinOffset'
>

export interface LiveMomentInteractionSurfaceProps {
  liveStatsProps?: LiveStatsSurfaceProps | null
  mostReactedProps?: MostReactedSurfaceProps | null
}

/**
 * Own live-chart inspection below Overlay so bucket hover cannot re-render the
 * complete Twitch sidebar. The chart paints hover chrome immediately; larger
 * cards consume only the latest preview once per animation frame.
 */
export const LiveMomentInteractionSurface = memo(function LiveMomentInteractionSurface({
  liveStatsProps,
  mostReactedProps,
}: LiveMomentInteractionSurfaceProps) {
  const [inspection, dispatchInspection] = useReducer(
    reduceMomentInspection,
    EMPTY_MOMENT_INSPECTION,
  )
  const interactionBoundaryRef = useRef<HTMLDivElement | null>(null)
  const previewStore = useMemo(() => createInspectionPreviewStore(), [])
  const previewCoalescer = useMemo(
    () => createFrameCoalescer<InspectionSelection | null>(selection => {
      previewStore.set(selection)
    }),
    [previewStore],
  )

  const cancelPendingPreview = useCallback(() => {
    previewCoalescer.cancel()
  }, [previewCoalescer])

  useEffect(() => cancelPendingPreview, [cancelPendingPreview])

  const handleInspectionPreview = useCallback((selection: InspectionSelection | null) => {
    if (selection?.source === 'chart') {
      previewCoalescer.enqueue(selection)
      return
    }
    // Pointer leave and list/keyboard previews are discrete interactions: clear
    // immediately and keep their existing zero-latency behavior.
    previewCoalescer.cancel()
    previewStore.set(selection)
  }, [previewCoalescer, previewStore])

  const handleInspectionCommit = useCallback((selection: InspectionSelection) => {
    cancelPendingPreview()
    previewStore.clear()
    dispatchInspection({ type: 'toggle', selection })
  }, [cancelPendingPreview, previewStore])

  const handleInspectionClear = useCallback(() => {
    cancelPendingPreview()
    previewStore.clear()
    dispatchInspection({ type: 'clear' })
  }, [cancelPendingPreview, previewStore])

  useEffect(() => {
    handleInspectionClear()
  }, [liveStatsProps?.payload.streamId, handleInspectionClear])

  const handleMostReactedPreview = useCallback((point: LiveHeatPoint | null) => {
    handleInspectionPreview(
      point ? inspectionSelectionFromPoint('most-reacted', point) : null,
    )
  }, [handleInspectionPreview])

  const handleMostReactedSelect = useCallback((point: LiveHeatPoint) => {
    cancelPendingPreview()
    previewStore.clear()
    dispatchInspection({
      type: 'toggle',
      selection: inspectionSelectionFromPoint('most-reacted', point),
    })
  }, [cancelPendingPreview, previewStore])

  return (
    <div ref={interactionBoundaryRef} data-live-moment-interaction-surface>
      {liveStatsProps ? (
        <LiveStatsBand
          {...liveStatsProps}
          inspectionBoundaryRef={interactionBoundaryRef}
          inspectionPreviewStore={previewStore}
          inspectionCommitted={inspection.committed}
          onInspectionPreview={handleInspectionPreview}
          onInspectionCommit={handleInspectionCommit}
          onInspectionClear={handleInspectionClear}
        />
      ) : null}

      {mostReactedProps ? (
        <MostReactedSection
          {...mostReactedProps}
          pinnedOffsetSeconds={inspection.committed?.offsetSeconds ?? null}
          onPreviewMoment={handleMostReactedPreview}
          onSelectMoment={handleMostReactedSelect}
        />
      ) : null}
    </div>
  )
})
