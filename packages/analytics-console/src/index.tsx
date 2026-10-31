export type {
  AnalyticsApi,
  AnalyticsStreamOptions,
  PulseBookmarkQuery,
  SetupWelcome,
  StartHistoricalSyncOptions,
} from './configureApi.ts'
export type {
  AnalyticsMinuteRollup,
  AnalyticsStream,
  AnalyticsStreamDetail,
  AnalyticsStreamsResponse,
  AnalyticsTopEmote,
  GameSegment,
  PulseRecapEmote,
  PulseRecapMoment,
  PulseStreamRecap,
  SyncStatus,
} from './apiTypes.ts'
export {
  findNearestRollupByOffset,
  parseDeepLinkOffset,
  parseMomentHash,
  rollupOffsetSeconds,
} from './utils/momentSelection.ts'
export {
  configureAnalyticsApi,
  configureEmoteAssetBase,
  getConfiguredAnalyticsApi,
  resolveEmoteAssetUrl,
} from './configureApi.ts'
export {
  clampGamesDurationSeconds,
  deriveChartGameSegments,
  minuteRollupEndOffsetSeconds,
  minuteRollupSpanSeconds,
  streamWallDurationSeconds,
  trimRollupsToWallDuration,
} from './utils/gameSegmentChart.ts'
// (fix, 10-30) GP-8: name-based box art and Twitch's "?" cover check, shared with the hub.
export { isTwitchPlaceholderBoxArt, twitchBoxArtByName } from './utils/twitchBoxArt.ts'
export { AnalyticsConsole } from './components/AnalyticsConsole.tsx'
