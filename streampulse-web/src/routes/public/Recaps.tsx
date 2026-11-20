import { Link } from 'react-router-dom'
import recaps from '../../generated/recap-page-list.json'
import { PublicLayout } from '../../ui/components/PublicLayout'
import { InstallCta } from '../../ui/components/InstallCta'
import './growth-guides.css'

/** Every reviewed recap in content/recap-pilot.json, newest first; the list grows with the manifest. */
export default function Recaps() {
  return <PublicLayout><article className="panel public-document growth-guide">
    <h1>Twitch chat recaps</h1>
    <p>Each recap covers one tracked stream: the moments chat reacted to most, the emotes it used, and how much of the stream StreamPulse measured. Every recap is reviewed by hand before it is listed here.</p>
    {recaps.length
      // A full page load: the reviewed summary ships in the recap's own document.
      ? <ul className="recap-index">{recaps.map(recap => <li key={recap.path}><a href={recap.path}>{recap.heading}</a><p className="muted">{recap.description}</p></li>)}</ul>
      : <p>No reviewed recaps yet.</p>}
    <div className="public-document__actions"><InstallCta className="btn btn-primary" /><Link className="btn btn-secondary" to="/analytics">Browse the Hub</Link></div>
    <nav className="growth-guide__related" aria-label="Related guides"><Link to="/guides/find-twitch-moments">Find and bookmark tracked moments</Link><Link to="/guides/twitch-vod-timestamps">Why a VOD or timestamp may be unavailable</Link><Link to="/help">Get help with StreamPulse</Link></nav>
  </article></PublicLayout>
}
