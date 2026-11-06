import { useState } from 'react'
import { PulseSectionCard } from '../ui/PulseSectionCard.tsx'
import type { FirstSignInAnswer, MyMomentsSnapshot } from '../shared/myMoments.ts'
import { myMomentsProblem } from './MyMomentsPage.tsx'

const count = (n: number, one: string, many: string) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`
const saves = (n: number) => count(n, 'save', 'saves')
const named = (name: string | null) => name ?? 'this account'

/** The one-time move ask's words, and the notice each answer leaves on the page. */
export const FIRST_SIGN_IN_COPY = {
  // The same words as the Account row's (ACCOUNT_COPY.signedInWithTwitch).
  signedIn: (name: string | null) => name ? `Signed in with Twitch as ${name}` : 'Signed in with Twitch',
  moveHeading: (n: number) => `Move this browser’s ${saves(n)} to your account?`,
  moveBody: 'They’ll follow you to every browser where you sign in. Notes stay on this browser.',
  addHeading: (n: number, name: string | null) => `Add these ${saves(n)} to ${named(name)}?`,
  addBody: 'They were saved on this browser while nobody was signed in. Another Twitch account has used this browser before, so they may not be yours.',
  history: (n: number) => `Also sync watched history (${count(n, 'moment', 'moments')})`,
  historyDetail: 'Up to 1,000 recent moments. You can turn this off in My Moments.',
  move: (n: number) => `Move ${saves(n)}`,
  add: (name: string | null) => `Add to ${named(name)}`,
  moving: 'Moving…',
  notNow: 'Not now',
  notMine: 'Not mine',
  stay: 'Saves stay on this browser. You can add them from My Moments.',
  moved: (n: number) => `Moved ${saves(n)}.`,
  rest: (n: number) => ` ${count(n, 'more stays', 'more stay')} on this browser. Add ${n === 1 ? 'it' : 'them'} from My Moments.`,
  syncOn: ' History sync is on.',
  syncOnHistoryStays: ' History sync is on. This browser’s earlier history stays here.',
  syncOff: ' History sync didn’t turn on. You can turn it on in My Moments.',
} as const

type Mutation = { kind: 'import-device-saves' } | { kind: 'history-sync'; enabled: true } | { kind: 'import-device-history' }

/**
 * Once per Twitch account, after it signs in on a browser that kept saves
 * while nobody was signed in: move them to the account, or leave them here.
 * Nothing moves without an explicit yes. On a browser another Twitch account
 * has used, the safe answer comes first ("Not mine") and history is unticked.
 * The worker records the answer; this card only asks.
 */
export function FirstSignInMove({ scope, deviceSaves, deviceHistory, accountName, otherAccountSeen, onDone }: {
  /** The account's My Moments scope, which every change names. */
  scope: string
  deviceSaves: number
  /** History this browser kept signed out; 0 leaves out the history box. */
  deviceHistory: number
  accountName: string | null
  otherAccountSeen: boolean
  /** The card's work is over: the notice to show in its place. */
  onDone: (notice: string) => void
}) {
  const [withHistory, setWithHistory] = useState(!otherAccountSeen)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')

  async function change(command: Mutation): Promise<MyMomentsSnapshot | undefined> {
    let reply: { type?: string; snapshot?: MyMomentsSnapshot; error?: unknown } | undefined
    try { reply = await chrome.runtime.sendMessage({ type: 'MY_MOMENTS', action: 'mutate', scope, command }) }
    catch (error) { throw new Error(myMomentsProblem(error, true)) }
    if (reply?.type !== 'MY_MOMENTS') throw new Error(myMomentsProblem(reply?.error, true))
    return reply.snapshot
  }
  // A lost answer only means the card asks again; the moves already happened.
  const answer = (value: FirstSignInAnswer) => Promise.resolve(chrome.runtime.sendMessage({ type: 'MY_MOMENTS', action: 'first-sign-in', answer: value })).catch(() => undefined)

  async function leave(value: 'later' | 'not-mine') {
    if (busy) return
    setBusy(true)
    await answer(value)
    setBusy(false)
    onDone(FIRST_SIGN_IN_COPY.stay)
  }

  async function move() {
    if (busy) return
    setBusy(true); setFailure('')
    let left: number
    try {
      const after = await change({ kind: 'import-device-saves' })
      left = after?.deviceBookmarks?.length ?? 0
    } catch (error) {
      setBusy(false)
      setFailure(error instanceof Error ? error.message : myMomentsProblem(error, true))
      return
    }
    let notice = FIRST_SIGN_IN_COPY.moved(deviceSaves - left) + (left ? FIRST_SIGN_IN_COPY.rest(left) : '')
    if (withHistory && deviceHistory > 0) {
      let syncing = true
      try { await change({ kind: 'history-sync', enabled: true }) } catch { syncing = false }
      if (!syncing) notice += FIRST_SIGN_IN_COPY.syncOff
      else notice += await change({ kind: 'import-device-history' }).then(() => FIRST_SIGN_IN_COPY.syncOn, () => FIRST_SIGN_IN_COPY.syncOnHistoryStays)
    }
    await answer('move')
    setBusy(false)
    onDone(notice)
  }

  const moveButton = <button key="move" className={otherAccountSeen ? undefined : 'pulse-journey-primary'} type="button" disabled={busy} aria-busy={busy || undefined} onClick={() => void move()}>
    {busy ? FIRST_SIGN_IN_COPY.moving : otherAccountSeen ? FIRST_SIGN_IN_COPY.add(accountName) : FIRST_SIGN_IN_COPY.move(deviceSaves)}
  </button>
  const stayButton = otherAccountSeen
    ? <button key="stay" className="pulse-journey-primary" type="button" disabled={busy} onClick={() => void leave('not-mine')}>{FIRST_SIGN_IN_COPY.notMine}</button>
    : <button key="stay" type="button" disabled={busy} onClick={() => void leave('later')}>{FIRST_SIGN_IN_COPY.notNow}</button>

  return (
    <PulseSectionCard title={otherAccountSeen ? FIRST_SIGN_IN_COPY.addHeading(deviceSaves, accountName) : FIRST_SIGN_IN_COPY.moveHeading(deviceSaves)} headingLevel={3}>
      <p className="pulse-supporter-detail">{FIRST_SIGN_IN_COPY.signedIn(accountName)}</p>
      <p>{otherAccountSeen ? FIRST_SIGN_IN_COPY.addBody : FIRST_SIGN_IN_COPY.moveBody}</p>
      {deviceHistory > 0 ? <label className="pl-check"><input type="checkbox" checked={withHistory} disabled={busy} onChange={event => setWithHistory(event.target.checked)} />
        <span><strong>{FIRST_SIGN_IN_COPY.history(deviceHistory)}</strong><span className="pl-muted pl-block">{FIRST_SIGN_IN_COPY.historyDetail}</span></span></label> : null}
      <div className="pulse-account-link-actions pulse-journey-actions">{otherAccountSeen ? [stayButton, moveButton] : [moveButton, stayButton]}</div>
      {/* Failures use role=alert, as the Seen in chat card does. */}
      <div className="pulse-supporter-account-status">{failure ? <p className="pulse-journey-notice" role="alert">{failure}</p> : null}</div>
    </PulseSectionCard>
  )
}

/**
 * The Account card's rows for what follows a Twitch account to every browser
 * it signs in on, and what stays on this one. Rendered inside its `dl`.
 */
export function AccountFollows({ saves: saved, historySync, supporter }: {
  /** The account's saves; null while they cannot be read. */
  saves: number | null
  historySync: 'on' | 'off' | 'unavailable'
  /** The membership line, for a Supporter only. */
  supporter: { line: string } | null
}) {
  return <>
    <div data-row="saves">
      <dt>Saves</dt>
      <dd>{saved === null ? 'On every browser you sign in to' : `${saved.toLocaleString('en-US')} · on every browser you sign in to`}</dd>
      <dd className="pulse-account-link-actions"><a href="#moments">Open</a></dd>
    </div>
    {historySync === 'unavailable' ? null : <div data-row="watched-history">
      <dt>Watched history</dt>
      <dd>{historySync === 'on' ? 'Syncing · up to 1,000 moments' : 'Off · this browser only'}</dd>
      <dd className="pulse-account-link-actions"><a href="#moments-history">Change</a></dd>
    </div>}
    {supporter ? <div data-row="supporter">
      <dt>Supporter</dt>
      <dd>{supporter.line}</dd>
      {/* The membership card is above on this page: Details goes back to it. */}
      <dd className="pulse-account-link-actions"><a href="#supporter" onClick={event => {
        const card = document.querySelector('[data-journey-state]')
        if (!card) return
        event.preventDefault()
        card.scrollIntoView({ block: 'start' })
      }}>Details</a></dd>
    </div> : null}
    <div data-row="notes">
      <dt>Notes</dt>
      <dd>Stay on this browser</dd>
      <dd />
    </div>
  </>
}
