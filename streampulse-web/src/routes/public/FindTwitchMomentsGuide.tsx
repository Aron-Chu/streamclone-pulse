import { Link } from 'react-router-dom'
import { PublicLayout } from '../../ui/components/PublicLayout'
import { InstallCta } from '../../ui/components/InstallCta'
import './growth-guides.css'

export default function FindTwitchMomentsGuide() {
  return <PublicLayout><article className="panel public-document growth-guide">
    <p className="growth-guide__eyebrow">StreamPulse workflow guide</p>
    <h1>Find and bookmark Twitch moments chat reacted to</h1>
    <p>Chat reactions are useful clues when you are catching up or reviewing a long stream. Start with measured peaks, watch the surrounding context, and keep the moments worth returning to.</p>
    <nav className="public-toc" aria-label="On this page"><a href="#coverage-first">Check coverage</a><a href="#review-moment">Review a moment</a><a href="#save-context">Save context</a><a href="#editor-workflow">Editor workflow</a></nav>
    <section id="coverage-first"><h2>1. Start with a tracked stream</h2>
      <p>Install StreamPulse and open a Twitch channel or VOD. Use the Chat / Pulse switch beside chat to open the panel. You can also start in the <Link to="/analytics">public analytics portal</Link>.</p>
      <p>Check the coverage and freshness shown with the data. A quiet measured minute, a gap in collection, and a stream with no chat measurements mean different things. Viewer counts alone do not establish chat reactions.</p>
      <p>Recaps are available for streams StreamPulse tracked. Installing the extension does not reconstruct missing history for an arbitrary old VOD. If there is no measured history, use Twitch’s replay and note timestamps manually.</p></section>
    <section id="review-moment"><h2>2. Use a reaction as a starting point</h2>
      <p>Choose a Top Moment and inspect its time and chat/emote context. A reaction score ranks audience activity; it is not a guarantee of video quality, a replay count, or a prediction that a clip will go viral.</p>
      <p>When a verified Twitch replay is linked, open the moment and watch before and after it. Chat may react to a joke, a surprising play, a raid, or something unrelated to the video. The surrounding scene determines what is worth sharing.</p>
      <p>If the replay is pending or unavailable, keep that uncertainty. A chart can have valid measurements while Twitch has no accessible recording. Do not substitute a different broadcast merely because its date looks close.</p></section>
    <section id="save-context"><h2>3. Bookmark the useful part</h2>
      <p>Use the extension moment’s bookmark control to keep it in your browser. In a normal window, local bookmarks do not require an account. Private windows keep no device bookmarks. Keep the same browser profile; local storage is not a cross-device backup, and clearing browser data or uninstalling the extension can remove it.</p>
      <p>When sharing, prefer the verified replay link. If you already know the correct time in an accessible Twitch VOD, the <Link to="/tools/twitch-vod-timestamp-link">timestamp link builder</Link> makes a clean link without uploading your input. Sharing a link does not preserve the video itself.</p></section>
    <section id="editor-workflow"><h2>A practical editor or moderator pass</h2>
      <ol><li>Confirm the broadcast and measured window before selecting peaks.</li><li>Review a small shortlist of reactions in context instead of treating every spike as a finished highlight.</li><li>Write a brief human note for each useful moment: what happened and how much context it needs.</li><li>Test each replay link with the permissions your audience will have.</li><li>Recheck the link before publishing a timestamp thread or handing it to an editor.</li></ol>
      <p>StreamPulse helps with discovery and review. This workflow does not create an edited video, grant media rights, or bypass subscriber-only access.</p></section>
    <div className="public-document__actions"><InstallCta className="btn btn-primary" /><Link className="btn btn-secondary" to="/docs#extension">Installation guide</Link></div>
    <nav className="growth-guide__related" aria-label="Related tools and guides"><Link to="/tools/twitch-vod-timestamp-link">Build a Twitch timestamp link</Link><Link to="/guides/twitch-vod-timestamps">Why a VOD or timestamp may be unavailable</Link><Link to="/support">Get help with StreamPulse</Link></nav>
  </article></PublicLayout>
}
