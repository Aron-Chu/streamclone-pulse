import { lazy, Suspense } from 'react'
import type { AccountEntryVariant } from './AccountEntry'

// The header account entry loads only with its switch on (VITE_ACCOUNT_HEADER=1).
// The switch is read inline, so a build without it folds both slots to null and
// ships no account session code in the headers' bundle.
const AccountEntry = /* @__PURE__ */ lazy(() => import('./AccountEntry').then((m) => ({ default: m.AccountEntry })))
const MenuAccountLink = /* @__PURE__ */ lazy(() => import('./AccountEntry').then((m) => ({ default: m.MenuAccountLink })))

export function AccountEntrySlot({ variant }: { variant: AccountEntryVariant }) {
  if (import.meta.env.VITE_ACCOUNT_HEADER !== '1') return null
  return <Suspense fallback={null}><AccountEntry variant={variant} /></Suspense>
}

/** The analytics menu's one account link, which follows the session. */
export function MenuAccountSlot({ onNavigate }: { onNavigate: () => void }) {
  if (import.meta.env.VITE_ACCOUNT_HEADER !== '1') return null
  return <Suspense fallback={null}><MenuAccountLink onNavigate={onNavigate} /></Suspense>
}
