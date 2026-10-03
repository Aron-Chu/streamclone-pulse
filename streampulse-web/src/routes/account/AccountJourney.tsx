/**
 * Shared pieces of the account → extension → Supporter journey, so sign-in,
 * device approval and billing read as one flow rather than three pages.
 */
export type JourneyStep = 'done' | 'current' | 'todo'

export function AccountSteps({ labels, steps }: { labels: readonly string[]; steps: readonly JourneyStep[] }) {
  return (
    <ol className="pulse-account-steps" aria-label="Progress">
      {labels.map((label, index) => (
        <li key={label} data-step={steps[index]} aria-current={steps[index] === 'current' ? 'step' : undefined}>
          <span className="pulse-account-step-mark" aria-hidden="true">{steps[index] === 'done' ? '✓' : index + 1}</span>
          <span>{label}<span className="pulse-account-visually-hidden">{steps[index] === 'done' ? ' (done)' : steps[index] === 'current' ? ' (current step)' : ''}</span></span>
        </li>
      ))}
    </ol>
  )
}

export const SUPPORTER_JOURNEY_STEPS = ['Sign in', 'Approve extension', 'Supporter'] as const
export const LINK_JOURNEY_STEPS = ['Sign in', 'Approve extension'] as const

/**
 * A short, non-secret reference to the signed-in account. The extension shows
 * the same reference for its connected account, so a person can confirm both
 * surfaces mean the same account without exposing an email address.
 */
export function accountReference(accountId: unknown): string | null {
  if (typeof accountId !== 'string' || !/^[0-9a-f-]{36}$/i.test(accountId)) return null
  return `··${accountId.replace(/-/g, '').slice(-6).toLowerCase()}`
}
