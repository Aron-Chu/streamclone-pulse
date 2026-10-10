import {
  CHAT_BADGE_LIST_PATH,
  CHAT_BADGE_MAX_BODY_BYTES,
  verifyChatBadgeList,
  type ChatBadgeDoc,
  type ChatBadgeEntry,
  type ChatBadgeEnvironment,
  type ChatBadgeKey,
  type ChatBadgeRejection,
  type ChatBadgesReply,
} from '../shared/chatBadges.ts'

/**
 * The Seen in chat list, worker side: download, verify, cache, serve.
 *
 * One GET of the whole public list, with no credentials, cookies, query string
 * or channel attached, so the server never learns which chats anyone opens.
 * The list is refreshed about hourly, and only while a Twitch tab asks for it
 * (or, before any list exists, when a Twitch page loads). A list that fails
 * verification is never used; the previous one is kept until its own expiry.
 */

export const CHAT_BADGE_REFRESH_MS = 60 * 60_000
export const CHAT_BADGE_REFRESH_JITTER = 0.1
export const CHAT_BADGE_BACKOFF_MS = [15 * 60_000, 30 * 60_000, 60 * 60_000] as const
export const CHAT_BADGE_NOT_FOUND_MS = 6 * 60 * 60_000
/** Your own on/off change shows at once and stays until the published list has caught up. */
export const CHAT_BADGE_OWN_TTL_MS = 2 * 60 * 60_000
const FETCH_TIMEOUT_MS = 20_000

/** Your own entry, patched in (or out) locally the moment you turn Seen in chat on or off. */
export type ChatBadgeOwnOverlay =
  | { kind: 'on'; entry: ChatBadgeEntry; at: number }
  | { kind: 'off'; id?: string; login?: string; at: number }

export interface StoredChatBadgeList {
  v: 1
  text?: string
  etag?: string
  kid?: string
  nextAt: number
  failures: number
  /** Highest accepted seq per environment; survives a 404 so a rollback is still refused. */
  floor: Partial<Record<ChatBadgeEnvironment, number>>
  received: boolean
  own?: ChatBadgeOwnOverlay
}

export interface ChatBadgeListPorts {
  fetch: typeof fetch
  origin: string
  keys: () => readonly ChatBadgeKey[]
  environments: readonly ChatBadgeEnvironment[]
  subtle: SubtleCrypto | undefined
  now?: () => number
  random?: () => number
  read: () => Promise<unknown>
  write: (value: StoredChatBadgeList) => Promise<void>
  /** The viewer setting "Show Supporter crests in chat". Off: no downloads, nothing served. */
  enabled: () => Promise<boolean>
  /** What a decorating tab would show changed, or whether there is anything to show. */
  changed?: () => void
  /** A list was refused; the reason only, for opt-in diagnostics. */
  rejected?: (reason: ChatBadgeRejection) => void
}

const EMPTY: StoredChatBadgeList = { v: 1, nextAt: 0, failures: 0, floor: {}, received: false }
const ETAG = /^(W\/)?"[\x21\x23-\x7e]{1,128}"$/

function parseStored(value: unknown): StoredChatBadgeList {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...EMPTY, floor: {} }
  const raw = value as Record<string, unknown>
  if (raw.v !== 1) return { ...EMPTY, floor: {} }
  const floor: StoredChatBadgeList['floor'] = {}
  const rawFloor = raw.floor && typeof raw.floor === 'object' ? raw.floor as Record<string, unknown> : {}
  for (const env of ['live', 'sandbox'] as const) if (Number.isSafeInteger(rawFloor[env])) floor[env] = rawFloor[env] as number
  const own = parseOwn(raw.own)
  return {
    v: 1,
    ...(typeof raw.text === 'string' ? { text: raw.text } : {}),
    ...(typeof raw.etag === 'string' && ETAG.test(raw.etag) ? { etag: raw.etag } : {}),
    ...(typeof raw.kid === 'string' ? { kid: raw.kid } : {}),
    nextAt: Number.isFinite(raw.nextAt) ? raw.nextAt as number : 0,
    failures: Number.isSafeInteger(raw.failures) ? Math.max(0, raw.failures as number) : 0,
    floor,
    received: raw.received === true,
    ...(own ? { own } : {}),
  }
}

function parseOwn(value: unknown): ChatBadgeOwnOverlay | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  if (!Number.isFinite(raw.at)) return undefined
  if (raw.kind === 'on' && Array.isArray(raw.entry) && raw.entry.length === 5) return { kind: 'on', entry: raw.entry as ChatBadgeEntry, at: raw.at as number }
  if (raw.kind === 'off') return { kind: 'off', at: raw.at as number, ...(typeof raw.id === 'string' ? { id: raw.id } : {}), ...(typeof raw.login === 'string' ? { login: raw.login } : {}) }
  return undefined
}

export class ChatBadgeList {
  private stored: StoredChatBadgeList | null = null
  private doc: ChatBadgeDoc | null = null
  private loading: Promise<void> | null = null
  private inflight: Promise<void> | null = null
  private cachedView: { key: string; reply: Extract<ChatBadgesReply, { ver: string }> } | null = null

  constructor(private ports: ChatBadgeListPorts) {}

  private now(): number { return this.ports.now?.() ?? Date.now() }

  /** The tab's question. Never touches the network unless a refresh is due. */
  async ask(have?: string): Promise<ChatBadgesReply> {
    if (!await this.ports.enabled()) return { type: 'CHAT_BADGES', off: true }
    await this.load()
    if (!this.doc && this.due()) await this.refresh()
    else if (this.due()) void this.refresh()
    const view = this.view()
    if (!view) return { type: 'CHAT_BADGES', off: true }
    return have === view.ver ? { type: 'CHAT_BADGES', unchanged: true } : view
  }

  /** Whether a decorator should be registered: the setting is on and there is something to show. */
  async wanted(): Promise<boolean> {
    if (!await this.ports.enabled()) return false
    await this.load()
    return this.view() !== null
  }

  /** Before any list exists: a Twitch page loaded, so fetch once if due. */
  async bootstrap(): Promise<void> {
    if (!await this.ports.enabled()) return
    await this.load()
    if (!this.doc && this.due()) await this.refresh()
  }

  async status(): Promise<{ listReceived: boolean }> {
    await this.load()
    return { listReceived: this.stored?.received === true }
  }

  /** The opt-in or opt-out response patches your own entry at once. */
  async patchOwn(own: ChatBadgeOwnOverlay | null): Promise<void> {
    await this.load()
    const stored = this.stored!
    // Each change gets a later stamp, so the version tabs compare always moves.
    if (own) stored.own = { ...own, at: Math.max(own.at, (stored.own?.at ?? 0) + 1) }
    else delete stored.own
    this.cachedView = null
    await this.persist()
    this.ports.changed?.()
  }

  async ownOverlay(): Promise<ChatBadgeOwnOverlay | undefined> {
    await this.load()
    return this.stored?.own
  }

  /** Single-flight network refresh. */
  refresh(): Promise<void> {
    if (!this.inflight) {
      this.inflight = this.fetchOnce().finally(() => { this.inflight = null })
    }
    return this.inflight
  }

  private due(): boolean {
    return this.now() >= (this.stored?.nextAt ?? 0)
  }

  private jittered(ms: number): number {
    const random = this.ports.random?.() ?? Math.random()
    return Math.round(ms * (1 - CHAT_BADGE_REFRESH_JITTER + 2 * CHAT_BADGE_REFRESH_JITTER * random))
  }

  private load(): Promise<void> {
    if (this.stored) return Promise.resolve()
    if (!this.loading) {
      this.loading = (async () => {
        let stored: StoredChatBadgeList
        try { stored = parseStored(await this.ports.read()) } catch { stored = { ...EMPTY, floor: {} } }
        // Re-verify on every worker wake: storage is trusted-only, but the keys a
        // new build pins may have changed, and the list may have expired.
        if (stored.text) {
          const result = await verifyChatBadgeList(stored.text, {
            keys: this.ports.keys(), environments: this.ports.environments, subtle: this.ports.subtle,
            minSeq: env => stored.floor[env] ?? 0, nowS: Math.floor(this.now() / 1000),
          })
          if (result.ok) this.doc = result.doc
          else { delete stored.text; delete stored.etag; delete stored.kid }
        }
        this.stored = stored
      })().finally(() => { this.loading = null })
    }
    return this.loading
  }

  private async persist(): Promise<void> {
    if (this.stored) await this.ports.write(this.stored).catch(() => undefined)
  }

  private dropDoc(): void {
    const stored = this.stored!
    this.doc = null
    delete stored.text
    delete stored.etag
    delete stored.kid
  }

  private view(): Extract<ChatBadgesReply, { ver: string }> | null {
    const stored = this.stored
    if (!stored) return null
    const nowMs = this.now()
    let dirty = false
    if (this.doc && this.doc.exp <= Math.floor(nowMs / 1000)) {
      // Past its expiry, every crest goes, even if no refresh succeeded.
      this.dropDoc()
      dirty = true
    }
    if (stored.own && nowMs - stored.own.at > CHAT_BADGE_OWN_TTL_MS) {
      delete stored.own
      dirty = true
    }
    if (dirty) { void this.persist(); this.cachedView = null }
    const own = stored.own
    const doc = this.doc
    if (!doc && own?.kind !== 'on') return null
    const key = `${doc?.seq ?? 0}.${own?.at ?? 0}`
    if (this.cachedView?.key === key) return this.cachedView.reply
    let u: ChatBadgeEntry[] = doc ? doc.u : []
    if (own?.kind === 'on') u = [...u.filter(entry => entry[0] !== own.entry[0]), own.entry]
    else if (own?.kind === 'off') u = u.filter(entry => entry[0] !== own.id && entry[1] !== own.login)
    if (!u.length) { this.cachedView = null; return null }
    const exp = doc ? doc.exp : Math.floor((own!.at + CHAT_BADGE_OWN_TTL_MS) / 1000)
    const reply = { type: 'CHAT_BADGES' as const, ver: key, exp, u }
    this.cachedView = { key, reply }
    return reply
  }

  private backoff(retryAfterMs?: number): void {
    const stored = this.stored!
    const step = CHAT_BADGE_BACKOFF_MS[Math.min(stored.failures, CHAT_BADGE_BACKOFF_MS.length - 1)]
    stored.failures += 1
    stored.nextAt = this.now() + Math.max(step, Math.min(retryAfterMs ?? 0, 6 * 60 * 60_000))
  }

  private async fetchOnce(): Promise<void> {
    await this.load()
    const stored = this.stored!
    if (!await this.ports.enabled()) return
    const before = this.view()?.ver ?? null
    try {
      const headers: Record<string, string> = {}
      if (stored.etag && this.doc) headers['If-None-Match'] = stored.etag
      const response = await this.ports.fetch(`${this.ports.origin}${CHAT_BADGE_LIST_PATH}`, {
        method: 'GET', headers, credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      if (response.status === 304 && this.doc) {
        stored.failures = 0
        stored.nextAt = this.now() + this.jittered(CHAT_BADGE_REFRESH_MS)
      } else if (response.status === 404) {
        // Feature off on the server (the kill switch): clear everything, your own
        // entry included, unregister, and ask again in 6 h.
        this.dropDoc()
        delete stored.own
        stored.failures = 0
        stored.nextAt = this.now() + CHAT_BADGE_NOT_FOUND_MS
      } else if (response.status === 200) {
        const length = Number(response.headers.get('Content-Length'))
        if (Number.isFinite(length) && length > CHAT_BADGE_MAX_BODY_BYTES) {
          this.ports.rejected?.('too_large')
          this.backoff()
        } else {
          const bytes = new Uint8Array(await response.arrayBuffer())
          const result = await verifyChatBadgeList(bytes, {
            keys: this.ports.keys(), environments: this.ports.environments, subtle: this.ports.subtle,
            minSeq: env => stored.floor[env] ?? 0, nowS: Math.floor(this.now() / 1000),
          })
          if (result.ok) {
            this.doc = result.doc
            stored.text = result.text
            stored.kid = result.kid
            const etag = response.headers.get('ETag')
            if (etag && ETAG.test(etag)) stored.etag = etag
            else delete stored.etag
            stored.floor[result.doc.env] = result.doc.seq
            stored.received = true
            stored.failures = 0
            stored.nextAt = this.now() + this.jittered(CHAT_BADGE_REFRESH_MS)
          } else {
            this.ports.rejected?.(result.reason)
            this.backoff()
          }
        }
      } else {
        const retry = response.headers.get('Retry-After')
        this.backoff(retry && /^\d{1,6}$/.test(retry) ? Number(retry) * 1000 : undefined)
      }
    } catch {
      this.backoff()
    }
    this.cachedView = null
    await this.persist()
    if ((this.view()?.ver ?? null) !== before) this.ports.changed?.()
  }
}
