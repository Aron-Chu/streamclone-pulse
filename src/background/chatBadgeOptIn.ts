import { CHAT_BADGE_CONSENT_VERSION, waveCode, type ChatBadgeActionError, type ChatBadgeSnapshot } from '../shared/chatBadges.ts'
import type { BackgroundResponse } from '../shared/messages.ts'
import type { SupporterWave } from '../shared/supporterPaint.ts'
import type { ChatBadgeList } from './chatBadgeList.ts'
import type { TwitchBadgeResult } from './twitchSignIn.ts'

type Reply = Extract<BackgroundResponse, { type: 'SUPPORTER_CHAT_BADGE' }>

export interface ChatBadgeOptInPorts {
  /** The Twitch check plus consent action (TwitchSignIn.confirmForBadge). */
  confirm: (badge: { consentVersion: number; wave: SupporterWave }) => Promise<TwitchBadgeResult>
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
 * your own extension stops showing your crest at once.
 */
export class ChatBadgeOptIn {
  private styleTimer: unknown = null

  constructor(private ports: ChatBadgeOptInPorts) {}

  private now(): number { return this.ports.now?.() ?? Date.now() }

  private async reply(extra: Omit<Reply, 'type' | 'listReceived'>): Promise<Reply> {
    const { listReceived } = await this.ports.list.status()
    return { type: 'SUPPORTER_CHAT_BADGE', listReceived, ...extra }
  }

  status(): Promise<Reply> {
    return this.reply({ ok: true })
  }

  async on(): Promise<Reply> {
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
    if (answer !== null) return this.reply({ ok: false, error: answer })
    const id = before?.kind === 'on' ? before.entry[0] : undefined
    const login = before?.kind === 'on' ? before.entry[1] : snapshot?.login
    await this.ports.list.patchOwn({ kind: 'off', at: this.now(), ...(id ? { id } : {}), ...(login ? { login } : {}) })
    await this.ports.invalidate()
    return this.reply({ ok: true, own: 'off' })
  }

  async style(wave: SupporterWave): Promise<Reply> {
    const answer = await this.send({ enabled: true, wave })
    if (answer !== null) return this.reply({ ok: false, error: answer })
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

  private async send(body: Record<string, unknown>): Promise<ChatBadgeActionError | null> {
    try {
      const result = await this.ports.request(body)
      if (result.status === 200 || result.status === 204) return null
      const code = result.body && typeof result.body === 'object' ? (result.body as Record<string, unknown>).error : undefined
      if (result.status === 409 && code === 'consent_required') return 'consent_required'
      if (result.status === 403 && code === 'supporter_required') return 'supporter_required'
      if (result.status === 429) return 'try_later'
      if (result.status === 404 || result.status === 503) return 'unavailable'
      return 'error'
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (message === 'account_authorization_required' || message === 'account_identity_changed') return 'sign_in_required'
      if (message === 'account_temporarily_unavailable' || message === 'account_hosted_only') return 'unavailable'
      return 'network'
    }
  }
}
