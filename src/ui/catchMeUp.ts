import { useEffect, useRef, useState } from 'react'
import { sendBackgroundMessage } from '../content/bridge.ts'
import {
  CATCH_ME_UP_READY_EVENT,
  type CatchMeUpActions,
  type CatchMeUpApi,
  type CatchMeUpModel,
} from '../shared/catchMeUpContract.ts'
import type { ExtensionGameSegment, ExtensionRollup } from '../shared/messages.ts'
import { isRenderableGameName } from './extensionChartAdapter.ts'
import { useMomentFrames } from './momentPicture.ts'

let loading: Promise<CatchMeUpApi | null> | undefined

/** Asks the worker for the script once per tab; a failed ask may be made again by a later recap. */
function loadCatchMeUp(): Promise<CatchMeUpApi | null> {
  loading ??= Promise.resolve()
    .then(() => sendBackgroundMessage({ type: 'CATCH_ME_UP_SCRIPT' }))
    .then(() => globalThis.__pulseCatchMeUp ?? null, () => null)
    .then(script => {
      if (!script) loading = undefined
      return script
    })
  return loading
}

/** How long a recap keeps the summary's place for the script before it gives up on it. */
const SCRIPT_WAIT_MS = 3000

/**
 * The summary script (content/catch-me-up.js): undefined while the worker
 * injects it, null when it cannot (no extension runtime, a failed injection, or
 * no answer in time), so the recap shows no summary.
 */
function useCatchMeUpScript(): CatchMeUpApi | null | undefined {
  const [script, setScript] = useState<CatchMeUpApi | null | undefined>(() =>
    globalThis.__pulseCatchMeUp ?? (typeof chrome !== 'undefined' && chrome.runtime?.id ? undefined : null))
  useEffect(() => {
    if (script !== undefined) return
    let live = true
    const settle = (found: CatchMeUpApi | null | undefined): void => {
      if (live) setScript(current => current ?? found ?? null)
    }
    const ready = (): void => { if (globalThis.__pulseCatchMeUp) settle(globalThis.__pulseCatchMeUp) }
    addEventListener(CATCH_ME_UP_READY_EVENT, ready)
    const timer = setTimeout(() => settle(null), SCRIPT_WAIT_MS)
    void loadCatchMeUp().then(settle)
    return () => {
      live = false
      clearTimeout(timer)
      removeEventListener(CATCH_ME_UP_READY_EVENT, ready)
    }
  }, [script])
  return script
}

export interface CatchMeUpInput {
  rollups: readonly ExtensionRollup[]
  /** The recap's checked game timeline, for the summary's games. */
  played?: readonly ExtensionGameSegment[]
  /** The stream's category, named when no game timeline is known. */
  category?: string | null
  durationSeconds: number
  peakChatPerMin: number
  /** The stream's VOD, for Twitch's cover and title in the summary. */
  vodId?: string | null
  /** The stream's title where the recap knows it; Twitch's VOD title otherwise. */
  title?: string | null
}

export function catchMeUpModel(input: CatchMeUpInput): CatchMeUpModel {
  const played = [...(input.played ?? [])]
    .filter(game => isRenderableGameName(game.gameName))
    .sort((a, b) => a.offsetSeconds - b.offsetSeconds)
    .map(game => game.gameName)
    .filter((name, index, names) => name !== names[index - 1])
  const category = input.category?.trim()
  return {
    rollups: input.rollups,
    durationSeconds: input.durationSeconds,
    peakChatPerMin: input.peakChatPerMin,
    summary: {
      vodId: input.vodId,
      title: input.title,
      games: played.length > 0 ? played : category && isRenderableGameName(category) ? [category] : [],
    },
  }
}

/**
 * Draws the recap's summary into the returned element once its script is
 * here, and again when the frames script arrives (it reads Twitch's cover).
 * `shown` is true while it shows; `pending` while the script is on its way,
 * so the recap can keep the summary's place and nothing below it moves.
 */
export function useCatchMeUp<T extends HTMLElement>(model: CatchMeUpModel, actions: CatchMeUpActions) {
  const script = useCatchMeUpScript()
  const frames = useMomentFrames()
  const ref = useRef<T>(null)
  const latest = useRef(actions)
  latest.current = actions
  const [shown, setShown] = useState(false)
  // A poll hands over equal data in new objects; only a change redraws.
  const key = JSON.stringify({ ...model, rollups: model.rollups.length })
  useEffect(() => {
    const host = ref.current
    if (!script || !host) return
    const mounted = script.mount(host, model, { minute: offsetSeconds => latest.current.minute(offsetSeconds) })
    setShown(mounted != null)
    return () => {
      mounted?.remove()
      setShown(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands for the model
  }, [script, frames, key])
  return { ref, shown, pending: script === undefined }
}
