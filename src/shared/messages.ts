export type MessageType =
  | 'TRACK'
  | 'UNTRACK'
  | 'GET_PULSE'
  | 'HEALTH'
  | 'PULSE_UPDATE'

export interface TrackMessage {
  type: 'TRACK'
  login: string
}

export interface UntrackMessage {
  type: 'UNTRACK'
  login: string
}

export interface GetPulseMessage {
  type: 'GET_PULSE'
  login: string
}

export interface HealthMessage {
  type: 'HEALTH'
}

export type BackgroundRequest = TrackMessage | UntrackMessage | GetPulseMessage | HealthMessage

export interface ExtensionPeak {
  offsetSeconds: number
  score: number
  reasons: string[]
  dominantSignal: string
  topEmotes?: string[]
}

export interface ExtensionLanes {
  composite: number[]
  chat: number[]
  seventv: number[]
  viewers?: number[]
  keywords?: number[]
}

export interface ExtensionHealthResponse {
  ok: boolean
  version: string
  time: number
}

export interface PulsePayload {
  login: string
  isLive: boolean
  tracking: boolean
  streamId?: string
  vodId?: string | null
  startedAt?: string
  currentOffsetSeconds: number
  rollups: Array<{
    offsetSeconds: number
    chatCount: number
    sevenTvEmoteCount: number
    viewerCount?: number
    topEmotes?: string[]
  }>
  lanes: ExtensionLanes
  peaks: ExtensionPeak[]
  recap: unknown | null
}

export interface PulseUpdateMessage {
  type: 'PULSE_UPDATE'
  login: string
  payload: PulsePayload | null
  error?: string
}

export type BackgroundResponse =
  | PulseUpdateMessage
  | { type: 'HEALTH'; ok: boolean; version?: string; error?: string }
