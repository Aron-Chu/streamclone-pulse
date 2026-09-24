import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { buildDemoLiveSignalModel, demoMinuteTime, LiveSignalScrollGraph } from '../src/ui/components/landing/LiveSignalScrollGraph'

describe('illustrative landing replay', () => {
  it('derives headlines, peaks, times and emote totals from its deterministic fixture', () => {
    const model = buildDemoLiveSignalModel()
    expect(buildDemoLiveSignalModel()).toEqual(model)
    const last = model.min - 1
    expect(model.kpiChat).toBe(model.chat[last])
    expect(model.kpiEmotes).toBe(model.emotes[last])
    expect(model.kpiSeventv).toBe(model.sv[last])
    expect(model.kpiViewers).toBe(model.viewers[last])
    const delta = model.viewers[last] - model.viewers[last - 5]
    expect(model.kpiViewerDelta).toBe(`${delta > 0 ? '+' : ''}${delta} · 5m`)
    expect(model.axisStart).toBe(demoMinuteTime(0))
    expect(model.axisMid).toBe(demoMinuteTime(Math.floor(model.min / 2)))
    expect(demoMinuteTime(last)).toBe('01:25:00')
    for (const peak of model.moments) {
      expect(peak.time).toBe(demoMinuteTime(peak.i))
      expect(peak.count).toBe(model.chat[peak.i])
    }
    expect(new Set(model.moments.map(moment => moment.i)).size).toBe(model.moments.length)
    const top = model.moments.find(moment => moment.top)!
    expect(model.featuredMoment.chatPerMin).toBe(Math.max(...model.chat))
    expect(model.featuredMoment.emotesPerMin).toBe(model.emotes[top.i])
    expect(model.featuredMoment.time).toBe(top.time)
    expect(model.topEmotes.reduce((sum, emote) => sum + emote.count, 0)).toBe(model.kpiEmotes)
    expect(model.topEmoteTotal).toBe(model.kpiEmotes)
    expect(model.topEmoteCount).toBe(model.topEmotes.length)
    expect(model.trackedChannelCount).toBe(model.channels.length)
    model.sv.forEach((value, index) => expect(value).toBeLessThanOrEqual(model.emotes[index]))
    model.topEmotes.forEach(emote => expect(emote.pct).toBe(emote.count / model.topEmotes[0].count * 100))
  })

  it('server-renders the complete static demo with honest status and no fake actions', () => {
    const html = renderToStaticMarkup(<LiveSignalScrollGraph />)
    expect(html).toContain('data-static=""')
    expect(html).toContain('Not live backend data')
    expect(html).toContain('illustrative statuses')
    expect(html).toContain('Sample data')
    expect(html).not.toContain('>Now<')
    expect(html).not.toContain('Jump to moment')
    expect(html).not.toContain('Each bar is real')
  })
})
