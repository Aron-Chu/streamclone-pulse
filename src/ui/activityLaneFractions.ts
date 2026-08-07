const FOCUS_LANE_BOOST = 0.78

export type ActivityLaneFractions = {
  chat: number
  emote: number
  trace: number
}

/**
 * Activity-lane shares inside the plot below the viewer strip.
 * Order: chat → emote aggregate (bars + trend) → optional overlay traces.
 * Fractions always sum to 1.
 */
export function resolveActivityLaneFractions(args: {
  expanded: boolean
  hasOverlays: boolean
  focusedKey?: string | null
}): ActivityLaneFractions {
  let chat: number
  let emote: number
  let trace: number

  if (!args.hasOverlays) {
    if (args.expanded) {
      chat = 0.48
      emote = 0.52
      trace = 0
    } else {
      chat = 0.55
      emote = 0.45
      trace = 0
    }
  } else if (args.expanded) {
    chat = 0.36
    emote = 0.3
    trace = 0.34
  } else {
    chat = 0.48
    emote = 0.34
    trace = 0.18
  }

  return rebalanceActivityLaneFractionsForFocus(
    args.focusedKey,
    args.expanded,
    { chat, emote, trace },
  )
}

export function rebalanceActivityLaneFractionsForFocus(
  focusedSeriesKey: string | null | undefined,
  activityExpanded: boolean,
  fractions: ActivityLaneFractions,
): ActivityLaneFractions {
  if (!focusedSeriesKey || !activityExpanded) return fractions

  const rest = 1 - FOCUS_LANE_BOOST
  const hasTrace = fractions.trace > 0

  switch (focusedSeriesKey) {
    case 'chat': {
      if (!hasTrace) {
        return { chat: FOCUS_LANE_BOOST, emote: rest, trace: 0 }
      }
      const halfRest = rest / 2
      return { chat: FOCUS_LANE_BOOST, emote: halfRest, trace: halfRest }
    }
    case 'emotes': {
      if (!hasTrace) {
        return { chat: rest, emote: FOCUS_LANE_BOOST, trace: 0 }
      }
      const halfRest = rest / 2
      return { chat: halfRest, emote: FOCUS_LANE_BOOST, trace: halfRest }
    }
    default: {
      if (focusedSeriesKey.includes(':') && hasTrace) {
        const halfRest = rest / 2
        return { chat: halfRest, emote: halfRest, trace: FOCUS_LANE_BOOST }
      }
      return fractions
    }
  }
}
