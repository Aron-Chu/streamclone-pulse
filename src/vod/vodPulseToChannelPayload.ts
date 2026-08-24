import type {
  ExtensionPeak,
  ExtensionRollup,
  PulsePayload,
  PulseRecapEmote,
  PulseRecapMoment,
  PulseStreamRecap,
} from '../shared/messages.ts'
import type {
  ExtensionVodPulseResponse,
  VodMoment,
  VodTimelinePoint,
} from '../types/vodPulseTypes.ts'

function timelinePointToRollup(point: VodTimelinePoint): ExtensionRollup {
  const emotes = point.emotesPerMin ?? 0
  return {
    offsetSeconds: point.offsetSeconds,
    chatCount: point.chatPerMin ?? 0,
    sevenTvEmoteCount: emotes,
    totalEmoteCount: emotes,
    viewerCount: point.viewers,
    topEmotes: point.topEmotes,
  }
}
function vodMomentToPeak(moment: VodMoment): ExtensionPeak {
  return {
    offsetSeconds: moment.offsetSeconds,
    score: moment.score ?? 0,
    reasons: moment.reason ? [moment.reason] : [],
    reasonLabel: moment.label,
    dominantSignal: 'composite',
    chatCount: moment.chatPerMin,
    emoteCount: moment.emotesPerMin,
    topEmotes: moment.topEmotes,
  }
}

function vodMomentToRecapMoment(moment: VodMoment): PulseRecapMoment {
  const topEmotes: PulseRecapEmote[] | undefined = moment.topEmotes?.map(emote => ({
    code: emote.name,
    count: emote.count,
    provider: emote.provider,
    id: emote.id,
    providerEmoteId: emote.providerEmoteId,
    imageUrl: emote.imageUrl,
  }))
  return {
    offsetSeconds: moment.offsetSeconds,
    score: moment.score ?? 0,
    reasons: moment.reason ? [moment.reason] : [],
    chatCount: moment.chatPerMin,
    emoteCount: moment.emotesPerMin,
    topEmotes,
  }
}

function extensionEmotesToRecap(
  emotes: ExtensionVodPulseResponse['topEmotes'],
): PulseRecapEmote[] {
  if (!emotes?.length) return []
  return emotes.map(emote => ({
    code: emote.name,
    count: emote.count,
    provider: emote.provider,
    id: emote.id,
    providerEmoteId: emote.providerEmoteId,
    imageUrl: emote.imageUrl,
  }))
}

function synthesizeRecap(vod: ExtensionVodPulseResponse, login: string): PulseStreamRecap | null {
  if (vod.recap) {
    return {
      ...vod.recap,
      login: vod.recap.login || login,
      vodId: vod.recap.vodId ?? (typeof vod.vodId === 'string' ? vod.vodId : undefined),
      streamId: vod.recap.streamId || vod.streamId || '',
    }
  }

  const rollups = vod.timeline?.points ?? []
  const topMoments = vod.topMoments ?? []
  if (rollups.length === 0 && topMoments.length === 0) return null

  const totalMessages = rollups.reduce((sum, point) => sum + (point.chatPerMin ?? 0), 0)
  const peakChatPerMin = rollups.reduce(
    (max, point) => Math.max(max, point.chatPerMin ?? 0),
    0,
  )

  return {
    streamId: vod.streamId ?? '',
    login,
    vodId: typeof vod.vodId === 'string' ? vod.vodId : undefined,
    durationSeconds: vod.durationSeconds ?? 0,
    totalMessages,
    peakChatPerMin,
    topMoments: topMoments.map(vodMomentToRecapMoment),
    topEmotes: extensionEmotesToRecap(vod.topEmotes),
    clipCandidates: [],
  }
}

/** Map extension VOD pulse API response into channel PulsePayload for recap UI reuse. */
export function vodPulseToChannelPayload(vod: ExtensionVodPulseResponse, fallbackLogin?: string): PulsePayload | null {
  if (vod.mode === 'live_dvr') {
    const login = (vod.login || vod.channelLogin)?.trim().toLowerCase()
    if (!login || !vod.streamId.trim()) return null
    return {
      mode: 'live_dvr',
      login,
      isLive: true,
      tracking: vod.tracking,
      streamId: vod.streamId,
      vodId: vod.vodId,
      provisional: vod.provisional,
      resolutionState: vod.resolutionState,
      retryable: vod.retryable,
      startedAt: vod.startedAt,
      title: vod.title,
      durationSeconds: vod.durationSeconds,
      currentOffsetSeconds: vod.currentOffsetSeconds,
      vodOriginDeltaSeconds: vod.vodOriginDeltaSeconds,
      coverageStartOffsetSeconds: vod.coverageStartOffsetSeconds,
      viewerStartOffsetSeconds: vod.viewerStartOffsetSeconds,
      coverage: vod.coverage,
      rollups: vod.rollups,
      fullRollups: vod.fullRollups,
      lanes: vod.lanes,
      peaks: vod.peaks,
      recap: null,
      topEmotes: vod.topEmotes,
      games: vod.games,
      emoteSync: vod.emoteSync,
      helixEnabled: vod.helixEnabled,
      rosterEligible: vod.rosterEligible,
      top500Eligible: vod.top500Eligible,
    }
  }

  if (vod.coverageStatus !== 'ready' && vod.coverageStatus !== 'partial') {
    return null
  }
  if (!vod.vodId) return null

  const login = (vod.channelLogin ?? vod.login ?? fallbackLogin)?.trim().toLowerCase()
  if (!login) return null

  const rollups = (vod.timeline?.points ?? []).map(timelinePointToRollup)
  const peaks = (vod.topMoments ?? []).map(vodMomentToPeak)
  const recap = synthesizeRecap(vod, login)
  const lastOffset = rollups[rollups.length - 1]?.offsetSeconds ?? 0
  const durationSeconds = Math.max(vod.durationSeconds ?? 0, lastOffset + 60)

  return {
    mode: 'vod',
    login,
    isLive: false,
    tracking: false,
    streamId: vod.streamId ?? undefined,
    vodId: vod.vodId,
    provisional: false,
    resolutionState: vod.resolutionState ?? 'vod_validated',
    retryable: vod.retryable ?? false,
    startedAt: vod.startedAt,
    title: vod.title,
    durationSeconds,
    currentOffsetSeconds: durationSeconds,
    rollups,
    fullRollups: rollups.length > 0 ? rollups : undefined,
    lanes: { composite: [], chat: [], seventv: [] },
    peaks,
    recap,
    topEmotes: vod.topEmotes,
    games: vod.games,
    rosterEligible: true,
    top500Eligible: true,
  }
}
