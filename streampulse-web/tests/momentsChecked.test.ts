import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { MomentsFeedItem } from '../src/lib/momentsFeed'
import {
  actOf, ariaOf, checkLines, checkMoment, freshCounts, groupsOf, hms, SERIES_BEFORE, seriesFromSpark, SORTS, sparkBars, stc, streamTime, stripModel,
  avatarImage, boxArtImage, liveFrameImage, updatedText, usualAt, when,
} from '../src/lib/momentsChecked'

const fixture = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/moments_feed_v1.json'), 'utf8')) as { generatedAt: number; items: MomentsFeedItem[] }
const NOW = fixture.generatedAt
const pool = fixture.items.map(item => checkMoment(item, NOW))
const byId = (pick: (item: MomentsFeedItem) => boolean) => {
  const item = fixture.items.find(pick)
  if (!item) throw new Error('fixture lacks the case')
  return item
}

describe('checked moments display model', () => {
  it('shows the backend verdict as sent, whatever the figures say', () => {
    for (const m of pool) expect(m.item.verdict).toBe(fixture.items.find(item => item.id === m.key)?.verdict)
    // the page words and draws; it never re-decides
    const ok = byId(item => item.verdict === 'ok')
    const quiet = checkMoment({ ...ok, chat: { ...ok.chat, perMin: 1, x: 0.1 }, emotes: { ...ok.emotes, perMin: 0, x: 0 } }, NOW)
    expect(quiet.item.verdict).toBe('ok')
  })

  it('puts the × on a row only for a moment that holds up and rose', () => {
    for (const m of pool) {
      if (m.rowX != null) expect([m.item.verdict, m.item.checks.rise?.code]).toEqual(['ok', 'rose'])
      else if (m.item.verdict !== 'ok') expect(m.why).not.toBe('')
    }
  })

  it('shows only the feed’s ×: none when it sends none', () => {
    for (const m of pool) expect(m.x).toBe(m.item[m.kind].x)
    const rose = byId(item => item.verdict === 'ok' && item.checks.rise?.code === 'rose' && item[item.label.kind].x != null)
    const kind = rose.label.kind
    const bare = checkMoment({ ...rose, [kind]: { ...rose[kind], x: null } }, NOW)
    expect(bare.x).toBeNull()
    expect(bare.rowX).toBeNull()
    expect(bare.checks.find(c => c.id === 'rise')?.long).not.toMatch(/\d×/)
    expect([bare, checkMoment(rose, NOW)].sort(SORTS.jump)[0].item.id).toBe(rose.id)
  })

  it('words the opening check and keeps its reason for the row', () => {
    const opening = checkMoment(byId(item => item.checks.history.code === 'opening'), NOW)
    expect(opening.item.verdict).toBe('bad')
    expect(opening.why).toBe('the stream had just started')
    expect(opening.checks[0].long).toMatch(/opening always looks like a jump/)
  })

  it('says what happened in the feed’s words', () => {
    const spammed = byId(item => !!item.label.spammed)
    expect(actOf(spammed)).toMatchObject({ type: 'spammed', emote: { name: spammed.topEmotes[0].name } })
    const burst = byId(item => item.label.kind === 'emotes' && !item.label.spammed && item.topEmotes.length === 3)
    const act = actOf(burst)
    expect(act.type).toBe('emotes')
    expect(act.type === 'emotes' && act.emotes.length).toBeLessThanOrEqual(2)
    expect(actOf(burst, true).type === 'emotes' && (actOf(burst, true) as { emotes: unknown[] }).emotes.length).toBeLessThanOrEqual(3)
    expect(actOf(byId(item => item.label.kind === 'chat')).text).toBe('chat burst')
  })

  it('writes check lines for every check the feed sent', () => {
    for (const item of fixture.items) {
      const lines = checkLines(item)
      expect(lines.filter(l => l.id !== 'label').length).toBe(1 + (item.checks.busy ? 1 : 0) + (item.checks.rise ? 1 : 0))
      for (const line of lines) expect(line.long).not.toMatch(/undefined|NaN/)
    }
  })

  it('groups a stream’s moments under its newest, in list order', () => {
    const list = pool.slice().sort(SORTS.new)
    const groups = groupsOf(list)
    expect(groups.flat().length).toBe(list.length)
    for (const g of groups) {
      expect(new Set(g.map(m => m.sid)).size).toBe(1)
      expect(g.map(m => m.at)).toEqual(g.map(m => m.at).sort((a, b) => b - a))
    }
    expect(groups.find(g => g[0].item.login === 'ml7support')?.length).toBe(6)
  })

  it('reads a row the way the mockup does', () => {
    const m = pool.find(x => x.rowX != null)!
    expect(ariaOf(m, NOW, 2)).toMatch(new RegExp(`^${m.name} .+ times the 15 minutes before.+Holds up\\. 2 earlier moments\\.$`))
  })

  it('draws the moment teal and the compared minutes stronger', () => {
    const m = pool[0]
    const bars = sparkBars(m)
    expect(bars.filter(b => b.tone === 'mo')).toHaveLength(1)
    expect(bars.length).toBe(m.item.spark.chat.filter(v => v != null).length)
    expect(bars.filter(b => b.tone === 'in').length).toBeGreaterThan(0)
  })

  it('puts the sparkline where the chart reads it', () => {
    const m = pool[0]
    const s = seriesFromSpark(m)
    expect(s.fromSpark).toBe(true)
    expect(s.c[SERIES_BEFORE]).toBe(m.item.spark.chat[16])
    expect(s.c[SERIES_BEFORE - 16]).toBe(m.item.spark.chat[0])
    expect(s.t3[SERIES_BEFORE]?.map(e => e.name)).toEqual(m.item.topEmotes.map(e => e.name))
  })

  it('compares a held minute with its own 15 minutes before, inside the stream', () => {
    const m = pool[0]
    const s = seriesFromSpark(m)
    expect(usualAt(s.c, m, -12, 10)).toEqual({ why: 'too early to compare' })
    const at = usualAt(s.c, m, 0, 10)
    expect('x' in at && at.fromRel).toBe(-16)
    expect('x' in at && at.toRel).toBe(-2)
    expect(usualAt(s.c, m, 0, 1e9)).toMatchObject({ why: 'quiet before' })
  })

  it('lays a stream’s moments on the stream’s own timeline', () => {
    const ml7 = pool.filter(m => m.item.login === 'ml7support')
    const strip = stripModel(ml7[0], pool, NOW)!
    expect(strip.count).toBe(6)
    for (const s of strip.stems) expect(s.left).toBeGreaterThanOrEqual(0)
    for (const s of strip.stems) expect(s.left).toBeLessThanOrEqual(100)
    expect(stripModel(pool.find(m => pool.filter(x => x.sid === m.sid).length === 1)!, pool, NOW)).toBeNull()
  })

  it('formats times as Twitch does', () => {
    expect(stc(59)).toBe('0:59')
    expect(stc(3725)).toBe('1:02:05')
    expect(hms(3725)).toBe('1h2m5s')
    expect(streamTime(pool[0], { vodId: '1', alignSeconds: 30 })).toBe(stc(pool[0].item.offsetSeconds + 30))
    expect(when(NOW - 30_000, NOW)).toBe('just now')
    expect(when(NOW - 5 * 60_000, NOW)).toBe('5 min ago')
    expect(updatedText(35_000)).toBe('updated 30 s ago')
    expect(updatedText(130_000)).toBe('updated 2 min ago')
  })

  it('counts the freshness line', () => {
    const counts = freshCounts(pool)
    expect(counts).toMatchObject({ all: 40, ok: 20, warn: 6, bad: 14 })
  })

  it('loads images only through the repo’s Twitch CDN checks', () => {
    const cdn = 'https://static-cdn.jtvnw.net'
    // every image the fixture sends passes
    for (const item of fixture.items) {
      if (item.profileImageUrl) expect(avatarImage(item)).toBe(item.profileImageUrl)
      if (item.category?.boxArtUrl) expect(boxArtImage(item)).toBe(item.category.boxArtUrl)
      if (item.liveFrameUrl) expect(liveFrameImage(item)).toBe(item.liveFrameUrl)
    }
    const avatar = `${cdn}/jtv_user_pictures/a-profile_image-70x70.png`, frame = `${cdn}/previews-ttv/live_user_a-440x248.jpg`
    for (const bad of ['http://static-cdn.jtvnw.net/jtv_user_pictures/a.png', 'https://example.com/jtv_user_pictures/a.png', 'javascript:alert(1)',
      `${avatar}?x=1`, `${avatar}#x`, 'https://u:p@static-cdn.jtvnw.net/jtv_user_pictures/a.png', `${cdn}/previews-ttv/a.jpg`]) {
      expect(avatarImage({ profileImageUrl: bad })).toBeUndefined()
    }
    for (const bad of [`${frame}?x=1`, `${frame}#x`, 'https://u@static-cdn.jtvnw.net/previews-ttv/a.jpg', `${cdn}/jtv_user_pictures/a.png`, frame.replace('https', 'http')]) {
      expect(liveFrameImage({ liveFrameUrl: bad })).toBeUndefined()
    }
    expect(avatarImage({ profileImageUrl: avatar })).toBe(avatar)
    expect(liveFrameImage({ liveFrameUrl: frame })).toBe(frame)
    // box art only when it is the category's own
    expect(boxArtImage({ category: { id: '509672', name: 'x', boxArtUrl: `${cdn}/ttv-boxart/509672-144x192.jpg` } })).toBeDefined()
    expect(boxArtImage({ category: { id: '1', name: 'x', boxArtUrl: `${cdn}/ttv-boxart/509672-144x192.jpg` } })).toBeUndefined()
    expect(boxArtImage({ category: { id: '509672', name: 'x', boxArtUrl: `${cdn}/ttv-boxart/509672-144x192.jpg?x=1` } })).toBeUndefined()
  })
})
