import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ChevronDown, UserRound } from 'lucide-react'
import { accountErrorText } from '../../lib/accountApi'
import {
  leaveAccountPagesAfterSignOut,
  signOutAccount,
  useAccountSession,
  type AccountProfile,
} from '../../lib/accountSession'
import { accountMomentsEnabled } from '../../lib/accountMoments'
import './AccountEntry.css'

export type AccountEntryVariant = 'analytics' | 'public'

/**
 * Header account entry: a quiet "Sign in" link, or an account menu button once
 * the session check confirms a sign-in. Nothing renders identity that the API
 * does not provide; email sign-in shows a generic "Account".
 */
export function AccountEntry({ variant }: { variant: AccountEntryVariant }) {
  const session = useAccountSession()
  const signIn = useRef<HTMLAnchorElement>(null)
  const focusSignIn = useRef(false)
  const className = `account-entry account-entry--${variant}`

  useEffect(() => {
    if (session.status !== 'signed_out' || !focusSignIn.current) return
    focusSignIn.current = false
    signIn.current?.focus()
  }, [session.status])

  if (session.status === 'signed_in') {
    return <AccountMenuButton className={className} profile={session.profile}
      onSignOutStart={() => { focusSignIn.current = true }}
      onSignOutFailed={() => { focusSignIn.current = false }} />
  }
  // While a cookie-holder's check runs, hold the signed-out link's space
  // without offering it, so neither state flashes.
  if (session.status === 'checking') {
    return <div className={className} data-account-entry="checking" aria-hidden="true">
      <span className="account-entry__link account-entry__link--pending">Sign in</span>
    </div>
  }
  return <div className={className} data-account-entry="signed-out">
    <Link ref={signIn} to="/account/sign-in" className="account-entry__link">Sign in</Link>
  </div>
}

export interface AccountMenuButtonProps {
  className: string
  profile: AccountProfile
  onSignOutStart?: () => void
  onSignOutFailed?: () => void
}

/** WAI-ARIA menu button: arrow keys move between items, Escape returns focus to the button. */
export function AccountMenuButton({ className, profile, onSignOutStart, onSignOutFailed }: AccountMenuButtonProps) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const initialFocus = useRef<'first' | 'last'>('first')
  const triggerId = useId()
  const menuId = useId()
  const { pathname } = useLocation()
  const name = profile.displayName?.trim()

  useEffect(() => { setOpen(false) }, [pathname])

  const items = () => Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])

  useEffect(() => {
    if (!open) return
    const list = items()
    list[initialFocus.current === 'last' ? list.length - 1 : 0]?.focus()
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer, true)
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer, true)
  }, [open])

  function show(focus: 'first' | 'last') {
    initialFocus.current = focus
    setError('')
    setOpen(true)
  }

  function close(restoreFocus: boolean) {
    setOpen(false)
    if (restoreFocus) trigger.current?.focus()
  }

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const list = items()
    const index = list.indexOf(document.activeElement as HTMLElement)
    const move = (next: number) => { event.preventDefault(); list[(next + list.length) % list.length]?.focus() }
    if (event.key === 'ArrowDown') move(index + 1)
    else if (event.key === 'ArrowUp') move(index - 1)
    else if (event.key === 'Home') move(0)
    else if (event.key === 'End') move(list.length - 1)
    else if (event.key === 'Tab') {
      // Continue the tab sequence from the button, which outlives the menu:
      // Tab moves past it, Shift+Tab stops on it.
      if (event.shiftKey) event.preventDefault()
      close(true)
    }
  }

  async function signOut() {
    if (busy) return
    setBusy(true); setError('')
    onSignOutStart?.()
    try {
      await signOutAccount()
      if (pathname.startsWith('/account/')) leaveAccountPagesAfterSignOut()
    } catch (failure) {
      onSignOutFailed?.()
      setError(accountErrorText(failure))
      setBusy(false)
    }
  }

  return (
    <div ref={root} className={className} data-account-entry="signed-in"
      onKeyDown={event => {
        if (event.key !== 'Escape' || !open) return
        event.preventDefault()
        event.stopPropagation()
        close(true)
      }}
      onBlur={event => {
        if (open && !event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false)
      }}>
      <button ref={trigger} id={triggerId} type="button" className="account-entry__trigger"
        aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close(false) : show('first'))}
        onKeyDown={event => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            show(event.key === 'ArrowUp' ? 'last' : 'first')
          }
        }}>
        {profile.avatarUrl
          ? <img className="account-entry__avatar" src={profile.avatarUrl} alt="" width={24} height={24} referrerPolicy="no-referrer" />
          : <span className="account-entry__avatar" aria-hidden="true"><UserRound size={15} strokeWidth={2.25} /></span>}
        {name ? <span className="account-entry__hidden">Account: </span> : null}
        <span className="account-entry__label">{name || 'Account'}</span>
        <ChevronDown className="account-entry__chevron" size={14} aria-hidden="true" />
      </button>
      {open ? (
        <div className="account-entry__panel">
          <div ref={menu} id={menuId} role="menu" aria-labelledby={triggerId} onKeyDown={onMenuKeyDown}>
            {accountMomentsEnabled() ? <Link role="menuitem" tabIndex={-1} to="/account/moments" onClick={() => setOpen(false)}>My Moments</Link> : null}
            <Link role="menuitem" tabIndex={-1} to="/account/settings" onClick={() => setOpen(false)}>Account &amp; devices</Link>
            <Link role="menuitem" tabIndex={-1} to="/account/billing" onClick={() => setOpen(false)}>Membership &amp; billing</Link>
            <div role="separator" />
            <button role="menuitem" tabIndex={-1} type="button" aria-disabled={busy || undefined}
              onClick={() => void signOut()}>
              {busy ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
          {error ? <p className="account-entry__error" role="alert">{error}</p> : null}
        </div>
      ) : null}
    </div>
  )
}
