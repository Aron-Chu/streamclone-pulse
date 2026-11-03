import { CHAT_BADGE_CONSENT_VERSION, TWITCH_LOGIN, TWITCH_USER_ID, waveCode, type ChatBadgeActionError, type ChatBadgeSnapshot } from '../shared/chatBadges.ts'
import type { BackgroundResponse } from '../shared/messages.ts'
import type { SupporterWave } from '../shared/supporterPaint.ts'
import type { ChatBadgeList } from './chatBadgeList.ts'
import type { TwitchBadgeResult, TwitchLinkResult } from './twitchSignIn.ts'

type Reply = Extract<BackgroundResponse, { type: 'SUPPORTER_CHAT_BADGE' }>
type LinkReply = Extract<BackgroundResponse, { type: 'SUPPORTER_TWITCH_LINK' }>
type ActionResult = { body: unknown } | { error: ChatBadgeActionError }

export interface ChatBadgeOptInPorts {
  /** The Twitch check plus consent action (TwitchSignIn.confirmForBadge). */
  confirm: (badge: { consentVersion: number; wave: SupporterWave }) => Promise<TwitchBadgeResult>
  /** Link Twitch to this membership (TwitchSignIn.linkToMembership). */
  link: () => Promise<TwitchLinkResult>
  /** Unlink it; the server withdraws the chat entry first (TwitchSignIn.unlinkTwitch). */
  unlink: () => Promise<TwitchLinkResult>
  /** POST /v1/billing/badge with this device's bearer. */
  request: (body: Record<string, unknown>) => Promise<{ status: number; body: unknown }>
  list: Pick<ChatBadgeList, 'patchOwn' | 'ownOverlay' | 'status'>
  /** Drop the cached Supporter snapshot and tell settings to read it again. */
  invalidate: () => Promise<void>
  /** The wave chosen in "Your look". */
  wave: () => Promise<SupporterWave>
  /** `chatBadge` from the last Supporter snapshot, if the server reports one. */
  snapshot: () => Promise<ChatBadgeSnapshot | undefined>
  now?: () => number
  setTimer?: (run: () => void, ms: number) => unknown
  clearTimer?: (timer: unknown) => void
}

export const CHAT_BADGE_STYLE_DEBOUNCE_MS = 2_000

/**
 * Your own Seen in chat entry. Opting in always goes through the Twitch check
 * and one server action; opting out is one request with no Twitch step, and
 * your own extension hides its cached crest when the receipt or local cache
 * identifies it. Other viewers still wait for their list to refresh or expire.
 */
export class ChatBadgeOptIn {
  private styleTimer: unknown = null

  constructor(private ports: ChatBadgeOptInPorts) {}

  private now(): number { return this.ports.now?.() ?? Date.now() }

  private async reply(extra: Omit<Reply, 'type' | 'listReceived' | 'keysPinned'>): Promise<Reply> {
    const { listReceived, keysPinned } = await this.ports.list.status()
    return { type: 'SUPPORTER_CHAT_BADGE', listReceived, keysPinned, ...extra }
  }

  status(): Promise<Reply> {
    return this.reply({ ok: true })
  }

  async on(): Promise<Reply> {
    // A build that can't verify any list would publish your Twitch ID for a
    // crest nobody using it could see: refuse before the Twitch check.
    if (!(await this.ports.list.status()).keysPinned) return this.reply({ ok: false, error: 'unavailable' })
    const wave = await this.ports.wave().catch((): SupporterWave => 'smooth')
    const result = await this.ports.confirm({ consentVersion: CHAT_BADGE_CONSENT_VERSION, wave })
    if (!result.ok) return this.reply({ ok: false, error: result.error })
    if (result.own) await this.ports.list.patchOwn({ kind: 'on', entry: result.own, at: this.now() })
    await this.ports.invalidate()
    const login = result.chatBadge?.login ?? result.own?.[1]
    return this.reply({ ok: true, own: 'on', ...(login ? { login } : {}) })
  }

  async off(): Promise<Reply> {
    const before = await this.ports.list.ownOverlay()
    const snapshot = await this.ports.snapshot().catch(() => undefined)
    const answer = await this.send({ enabled: false })
    if ('error' in answer) return this.reply({ ok: false, error: answer.error })
    // The authenticated withdrawal receipt survives a missing account cache.
    // An idempotent retry may have no receipt: retain the earlier local removal.
    const body = answer.body && typeof answer.body === 'object' ? answer.body as Record<string, unknown> : undefined
    const receipt = body?.withdrawn && typeof body.withdrawn === 'object' ? body.withdrawn as Record<string, unknown> : undefined
    await this.forgetOwn(before, snapshot, receipt)
    await this.ports.invalidate()
    return this.reply({ ok: true, own: 'off' })
  }

  /** Link Twitch to this membership. Seen in chat stays off: linking publishes nothing. */
  async linkTwitch(): Promise<LinkReply> {
    const result = await this.ports.link()
    if (!result.ok) return { type: 'SUPPORTER_TWITCH_LINK', ok: false, error: result.error }
    await this.ports.invalidate()
    return { type: 'SUPPORTER_TWITCH_LINK', ok: true, ...(result.login ? { login: result.login } : {}) }
  }

  /**
   * Unlink Twitch. The server withdraws your chat entry in the same step, so
   * your own extension hides its cached crest as Turn off does.
   */
  async unlinkTwitch(): Promise<LinkReply> {
    const before = await this.ports.list.ownOverlay()
    const snapshot = await this.ports.snapshot().catch(() => undefined)
    const result = await this.ports.unlink()
    if (!result.ok) return { type: 'SUPPORTER_TWITCH_LINK', ok: false, error: result.error }
    if (before?.kind === 'on' || (snapshot && snapshot.state !== 'off')) await this.forgetOwn(before, snapshot)
    await this.ports.invalidate()
    return { type: 'SUPPORTER_TWITCH_LINK', ok: true }
  }

  private async forgetOwn(before: Awaited<ReturnType<ChatBadgeOptInPorts['list']['ownOverlay']>>, snapshot: ChatBadgeSnapshot | undefined, receipt?: Record<string, unknown>): Promise<void> {
    const id = typeof receipt?.twitchUserId === 'string' && TWITCH_USER_ID.test(receipt.twitchUserId)
      ? receipt.twitchUserId : before?.kind === 'on' ? before.entry[0] : before?.id
    const login = typeof receipt?.login === 'string' && TWITCH_LOGIN.test(receipt.login)
      ? receipt.login : before?.kind === 'on' ? before.entry[1] : before?.login ?? snapshot?.login
    await this.ports.list.patchOwn({ kind: 'off', at: this.now(), ...(id ? { id } : {}), ...(login ? { login } : {}) })
  }

  async style(wave: SupporterWave): Promise<Reply> {
    const answer = await this.send({ enabled: true, wave })
    if ('error' in answer) return this.reply({ ok: false, error: answer.error })
    const own = await this.ports.list.ownOverlay()
    if (own?.kind === 'on') {
      const [id, login, tier, paint] = own.entry
      await this.ports.list.patchOwn({ kind: 'on', entry: [id, login, tier, paint, waveCode(wave)], at: this.now() })
    }
    return this.reply({ ok: true })
  }

  /** "Your look" changed the wave: follow it in chat too, 2 s after the last change. */
  waveChanged(wave: SupporterWave): void {
    const set = this.ports.setTimer ?? ((run: () => void, ms: number) => setTimeout(run, ms))
    const clear = this.ports.clearTimer ?? ((timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>))
    if (this.styleTimer !== null) clear(this.styleTimer)
    this.styleTimer = set(() => {
      this.styleTimer = null
      void (async () => {
        const own = await this.ports.list.ownOverlay()
        const snapshot = await this.ports.snapshot().catch(() => undefined)
        if (own?.kind === 'on' || snapshot?.state === 'on' || snapshot?.state === 'waiting') await this.style(wave)
      })().catch(() => undefined)
    }, CHAT_BADGE_STYLE_DEBOUNCE_MS)
  }

  private async send(body: Record<string, unknown>): Promise<ActionResult> {
    try {
      const result = await this.ports.request(body)
      if (result.status === 200 || result.status === 204) return { body: result.body }
      const code = result.body && typeof result.body === 'object' ? (result.body as Record<string, unknown>).error : undefined
      if (result.status === 409 && code === 'consent_required') return { error: 'consent_required' }
      if (result.status === 403 && code === 'supporter_required') return { error: 'supporter_required' }
      if (result.status === 429) return { error: 'try_later' }
      if (result.status === 404 || result.status === 503) return { error: 'unavailable' }
      return { error: 'error' }
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (message === 'account_authorization_required' || message === 'account_identity_changed') return { error: 'sign_in_required' }
      if (message === 'account_temporarily_unavailable' || message === 'account_hosted_only') return { error: 'unavailable' }
      return { error: 'network' }
    }
  }
}
