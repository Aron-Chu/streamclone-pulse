import { Link } from 'react-router-dom'
import { SUPPORTER_PATH } from '../../lib/externalLinks'

export function AccountFooter({ current }: { current?: 'settings' | 'billing' }) {
  return <footer className="pulse-account-footer">
    <p>Your free Pulse tools do not require a <Link to={SUPPORTER_PATH}>Supporter subscription</Link>.</p>
    <nav aria-label="Account navigation">
      {current !== 'settings' ? <Link to="/account/settings">Account &amp; devices</Link> : null}
      {current !== 'billing' ? <Link to="/account/billing">Membership &amp; billing</Link> : null}
      <Link to="/support">Help &amp; support</Link>
    </nav>
  </footer>
}
