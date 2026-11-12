import { describe, expect, it } from 'vitest'
import { vodPulseToChannelPayload } from '../src/vod/vodPulseToChannelPayload.ts'
import type { PulseRecapMoment, PulseStreamRecap } from '../src/shared/messages.ts'
import type { ExtensionVodPulseResponse } from '../src/types/vodPulseTypes.ts'

const moment = (offsetSeconds: number): PulseRecapMoment => ({ offsetSeconds, score: 1, reasons: [] })

// jynxzi 2906121675 (10-22): a 150,733 s stream whose answer also carried the
// next broadcast's moments at 42-47 h.
describe('vodPulseToChannelPayload stream range', () => {
  const recap: PulseStreamRecap = {
    streamId: '319640266711',
    login: 'jynxzi',
    durationSeconds: 150733,
    totalMessages: 10,
    peakChatPerMin: 5,
    topMoments: [moment(4860), moment(150700), moment(152912), moment(164432)],
    topEmotes: [],
    clipCandidates: [moment(4860), moment(170852)],
    biggestChatSpike: { offsetSeconds: 168212, chatPerMin: 900 },
    funniestEmoteBurst: { offsetSeconds: 7740, count: 40 },
  }
  const base: ExtensionVodPulseResponse = {
    mode: 'vod',
    vodId: '2906121675',
    coverageStatus: 'ready',
    channelLogin: 'jynxzi',
    streamId: '319640266711',
    durationSeconds: 150733,
    timeline: { bucketSeconds: 60, points: [{ offsetSeconds: 0, chatPerMin: 1 }, { offsetSeconds: 150660, chatPerMin: 1 }] },
    topMoments: [
      { offsetSeconds: 4860, label: 'Chat spike' },
      { offsetSeconds: 164432, label: 'Chat spike' },
    ],
    recap,
  }

  it('drops Top moments after the stream ends', () => {
    const payload = vodPulseToChannelPayload(base)
    expect(payload?.peaks.map(peak => peak.offsetSeconds)).toEqual([4860])
    expect(payload?.recap?.topMoments.map(item => item.offsetSeconds)).toEqual([4860, 150700])
    expect(payload?.recap?.clipCandidates.map(item => item.offsetSeconds)).toEqual([4860])
  })

  it('drops recap highlights after the stream ends and keeps the rest', () => {
    const payload = vodPulseToChannelPayload(base)
    expect(payload?.recap?.biggestChatSpike).toBeUndefined()
    expect(payload?.recap?.funniestEmoteBurst).toEqual({ offsetSeconds: 7740, count: 40 })
  })

  it('bounds by the chart when the answer has no length', () => {
    const payload = vodPulseToChannelPayload({ ...base, durationSeconds: undefined })
    expect(payload?.peaks.map(peak => peak.offsetSeconds)).toEqual([4860])
  })

  it('keeps every moment when neither a length nor a chart says where the stream ends', () => {
    const payload = vodPulseToChannelPayload({ ...base, durationSeconds: 0, timeline: { bucketSeconds: 60, points: [] } })
    expect(payload?.peaks.map(peak => peak.offsetSeconds)).toEqual([4860, 164432])
  })
})
