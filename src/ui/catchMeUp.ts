import { useEffect, useRef, useState } from 'react'
import type { LiveHeatPoint } from '@streampulse/pulse-core'
import { sendBackgroundMessage } from '../content/bridge.ts'
import {
  CATCH_ME_UP_READY_EVENT,
  type CatchMeUpActions,
  type CatchMeUpApi,
  type CatchMeUpBlock,
  type CatchMeUpModel,
} from '../shared/catchMeUpContract.ts'
import type { ExtensionGameSegment, ExtensionRollup } from '../shared/messages.ts'
import { isRenderableGameName } from './extensionChartAdapter.ts'
import { gameAtOffset, momentPictureAt, momentPictureView, useMomentFrames } from './momentPicture.ts'

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

/** How long a recap waits for the script before it lists its moments without it. */
const SCRIPT_WAIT_MS = 3000

/**
 * The Catch me up script (content/catch-me-up.js): undefined while the worker
 * injects it, null when it cannot (no extension runtime, a failed injection, or
 * no answer in time), so the recap lists every moment instead.
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
  /** Ranked moments, best first. */
  points: LiveHeatPoint[]
  rollups: readonly ExtensionRollup[]
  games?: readonly ExtensionGameSegment[]
  /** The recap's checked game timeline, for the summary's games; `games` when absent. */
  played?: readonly ExtensionGameSegment[]
  durationSeconds: number
  peakChatPerMin: number
  backendUrl: string
  vodPage: boolean
  /** The stream's VOD, for Twitch's cover and title in the summary. */
  vodId?: string | null
  /** False where the recap names the stream's title itself. */
  withTitle?: boolean
}

export function catchMeUpModel(input: CatchMeUpInput): CatchMeUpModel | null {
  if (input.points.length === 0) return null
  const games = new Set((input.games ?? []).map(game => game.gameName).filter(isRenderableGameName))
  const played = [...(input.played ?? input.games ?? [])]
    .filter(game => isRenderableGameName(game.gameName))
    .sort((a, b) => a.offsetSeconds - b.offsetSeconds)
    .map(game => game.gameName)
    .filter((name, index, names) => name !== names[index - 1])
  return {
    moments: input.points.slice(0, 3).map(point => ({
      point,
      card: momentPictureView('card', point),
      thumb: momentPictureView('thumb', point),
      game: gameAtOffset(input.games, point.offsetSeconds),
    })),
    rollups: input.rollups,
    durationSeconds: input.durationSeconds,
    peakChatPerMin: input.peakChatPerMin,
    momentCount: input.points.length,
    namesGame: games.size > 1,
    backendUrl: input.backendUrl,
    vodPage: input.vodPage,
    summary: { vodId: input.vodId, withTitle: input.withTitle ?? true, games: played },
    at: momentPictureAt(),
  }
}

/**
 * Draws Catch me up into the returned element once its script is here, and
 * redraws it when this tab's pictures arrive. `shown` is true while it shows,
 * so the recap leaves its three moments out of the list below. `pending` is
 * true while the script is on its way, so the recap holds its moments back
 * rather than list them and then fold them away; when the script cannot be
 * injected, the recap lists every moment. On a VOD page the recap also gives
 * it `head` and `tail` (CatchMeUpParts), and the block draws into all three.
 */
export function useCatchMeUp<T extends HTMLElement>(model: CatchMeUpModel | null, actions: CatchMeUpActions, picked: number | null) {
  const script = useCatchMeUpScript()
  const frames = useMomentFrames()
  const ref = useRef<T>(null)
  const head = useRef<T>(null)
  const tail = useRef<T>(null)
  const block = useRef<CatchMeUpBlock | null>(null)
  const latest = useRef({ model, actions, picked })
  latest.current = { model, actions, picked }
  const [shown, setShown] = useState(false)
  // A poll hands over equal data in new objects; only a change redraws.
  const key = model ? JSON.stringify({ ...model, rollups: model.rollups.length }) : ''
  useEffect(() => {
    const host = ref.current
    const current = latest.current.model
    if (!script || !host || !current) return
    const mounted = script.mount(host, current, {
      jump: index => latest.current.actions.jump(index),
      pick: index => latest.current.actions.pick(index),
      minute: offsetSeconds => latest.current.actions.minute(offsetSeconds),
    }, { head: head.current, tail: tail.current })
    mounted.select(latest.current.picked)
    block.current = mounted
    setShown(true)
    return () => {
      mounted.remove()
      block.current = null
      setShown(false)
    }
  }, [script, frames, key])
  useEffect(() => block.current?.select(picked), [picked])
  return { ref, head, tail, shown, pending: script === undefined && model != null }
}
