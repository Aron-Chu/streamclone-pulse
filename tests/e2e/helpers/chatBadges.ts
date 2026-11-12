import fs from 'node:fs'
import path from 'node:path'
import type { BrowserContext, Page, Request, TestInfo, Worker } from '@playwright/test'
import { chatPage, type ChatFixtureStyle } from '../../fixtures/chat-badges/chatMarkup.ts'
import { makeDoc, signList, type Entry } from '../../helpers/chatBadgeSigner.ts'

/**
 * Seen in chat e2e: a signed Supporter list served from the mocked API and
 * fake Twitch chat pages (native, BTTV, FFZ, 7TV markup) served for
 * www.twitch.tv. The list is signed with the public e2e test key
 * (32 bytes of 0x07, kid spb-sandbox-7) that only development builds pin.
 * Nothing reaches Twitch or the hosted API.
 */
export const BADGE_LIST_URL = 'https://api.streampulse.stream/v1/billing/badges'
export const CHAT_URL = 'https://www.twitch.tv/popout/fixturechan/chat'

export interface BadgeListServer {
  requests: Request[]
  /** 200 with this list, or another status. */
  set: (next: { status: 200; entries: Entry[] } | { status: 404 | 503 }) => void
}

export async function serveBadgeList(context: BrowserContext, entries: Entry[]): Promise<BadgeListServer> {
  const requests: Request[] = []
  let state: { status: 200; entries: Entry[] } | { status: 404 | 503 } = { status: 200, entries }
  let seq = Math.floor(Date.now() / 1000)
  await context.route(`${BADGE_LIST_URL}*`, route => {
    requests.push(route.request())
    if (state.status !== 200) return route.fulfill({ status: state.status, json: { error: state.status === 404 ? 'not_found' : 'badges_unavailable' } })
    const iat = Math.floor(Date.now() / 1000)
    const body = signList(makeDoc(state.entries, { env: 'sandbox', seq: seq++, iat }))
    return route.fulfill({
      status: 200,
      body,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', ETag: `"spb1-sandbox-${seq}"`, 'Cache-Control': 'public, max-age=300' },
    })
  })
  return { requests, set: next => { state = next } }
}

export interface ChatPageOptions { width?: number; theme?: 'dark' | 'light'; lines?: string }

/** Serve a fake Twitch chat page; other Twitch requests get an empty 204. */
export async function serveChatPage(context: BrowserContext, style: () => ChatFixtureStyle, options: () => ChatPageOptions = () => ({})): Promise<void> {
  // Registered first, so it only catches what the routes below do not: no
  // request ever reaches a real Twitch host from these specs.
  await context.route(/^https:\/\/([a-z0-9-]+\.)*twitch\.tv\//, route => route.abort())
  await context.route('https://www.twitch.tv/**', route => route.request().resourceType() === 'document'
    ? route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: chatPage(style(), options()) })
    : route.fulfill({ status: 204, body: '' }))
  await context.route('https://static.twitchcdn.net/**', route => route.abort())
  await context.route('https://assets.twitch.tv/**', route => route.abort())
}

export async function setViewerSetting(worker: Worker, values: Record<string, boolean>): Promise<void> {
  await worker.evaluate(async items => { await chrome.storage.sync.set(items) }, values)
}

export async function registeredChatScripts(worker: Worker): Promise<string[]> {
  return worker.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).map(script => script.id))
}

/** What the decorator added to the page: crests per line author and painted names. */
export async function decorations(page: Page) {
  return page.evaluate(() => {
    const lines = [...document.querySelectorAll('.chat-line__message, .seventv-message')]
    return {
      style: document.getElementById('streampulse-chat-badges') !== null,
      crests: document.querySelectorAll('.sp-cb-crest').length,
      painted: document.querySelectorAll('[data-sp-paint]').length,
      byLine: lines.map(line => {
        const name = line.querySelector('.chat-author__display-name, .seventv-chat-user-username')
        const crest = line.querySelector<HTMLElement>('.sp-cb-crest')
        return {
          name: name?.textContent?.trim() ?? '',
          crest: crest ? crest.dataset.t ?? '' : null,
          label: crest?.getAttribute('aria-label') ?? null,
          paint: name?.getAttribute('data-sp-paint') ?? name?.querySelector('[data-sp-paint]')?.getAttribute('data-sp-paint') ?? null,
        }
      }),
    }
  })
}

/** Where the screenshots go: the evidence folder when one is named, else the test's output. */
export function evidencePath(testInfo: TestInfo, name: string): string {
  const dir = process.env.PULSE_CHAT_BADGES_EVIDENCE_DIR
  if (!dir) return testInfo.outputPath(name)
  fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, name)
}

/** The decorator's own counters, read through the worker (never from the page). */
export async function decoratorStats(worker: Worker): Promise<{ lines: number; hits: number; callbacks: number; totalMs: number; maxMs: number; samples: number[]; style: string | null; attached: boolean } | null> {
  return worker.evaluate(async url => {
    const [tab] = await chrome.tabs.query({ url })
    if (typeof tab?.id !== 'number') return null
    return chrome.tabs.sendMessage(tab.id, { type: 'CHAT_BADGES_STATS' })
  }, 'https://www.twitch.tv/*')
}
