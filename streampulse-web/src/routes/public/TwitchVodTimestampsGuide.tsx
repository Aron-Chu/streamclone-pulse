import { Link } from 'react-router-dom'
import { PublicLayout } from '../../ui/components/PublicLayout'
import { InstallCta } from '../../ui/components/InstallCta'
import { HELP_PATH } from '../../lib/externalLinks'
import { TimestampLinkBuilder } from './TimestampLinkBuilder'
import './growth-guides.css'

/**
 * The timestamp link builder, with the short guide to Twitch replay times
 * under it. The builder's old address (/tools/twitch-vod-timestamp-link)
 * opens this page.
 */
export default function TwitchVodTimestampsGuide() {
  return <PublicLayout><article className="panel public-document growth-guide">
    <h1>Twitch VOD timestamp links</h1>
    <p>Paste a Twitch replay link and the time you found, then copy a clean link that starts there. It runs in your browser. It doesn’t upload anything or check that the replay still exists.</p>
    <TimestampLinkBuilder />
    <h2>Which time to enter</h2>
    <p>Use the elapsed time in the Twitch player: 1:23:45 is one hour, 23 minutes and 45 seconds into that replay. A clock time such as “8:15 pm” doesn’t point to a place in a replay.</p>
    <p>Found the moment in StreamPulse? Use its replay button when it has one. A stream’s time and its replay’s time can differ, and this builder doesn’t line them up.</p>
    <h2>Why a replay link can stop working</h2>
    <p>Twitch saves a replay only when the broadcaster has past broadcasts turned on. It keeps past broadcasts for:</p>
    <ul><li>7 days for most broadcasters.</li><li>14 days for Affiliates.</li><li>60 days for Partners, Prime and Turbo users.</li></ul>
    <p>The broadcaster can also delete a replay or limit who can watch it. <a href="https://help.twitch.tv/s/article/video-on-demand" target="_blank" rel="noopener noreferrer">Twitch’s on-demand content guide</a> has the current rules.</p>
    <h2>Check a link before you share it</h2>
    <ol><li>Open the right broadcaster’s replay.</li><li>Check that the people you share it with can watch it.</li><li>Make sure the time is inside the replay.</li><li>Open the final link and watch a few seconds to confirm the scene.</li></ol>
    <p>A saved link isn’t a backup of the video. StreamPulse shows chat reactions for the streams it tracks; it doesn’t restore deleted replays or analyze every past VOD.</p>
    <div className="public-document__actions"><InstallCta className="btn btn-primary" /><Link className="btn btn-secondary" to="/analytics">Explore tracked channels</Link></div>
    <nav className="growth-guide__related" aria-label="Related guides and help"><Link to="/guides/find-twitch-moments">Find and bookmark tracked moments</Link><Link to={HELP_PATH}>Get help with StreamPulse</Link></nav>
    <p className="growth-guide__source">Twitch sources reviewed October 31, 2026. <a href="https://help.twitch.tv/s/article/how-to-share-a-stream" target="_blank" rel="noopener noreferrer">Twitch’s sharing guide</a> describes its own “Skip to” option.</p>
  </article></PublicLayout>
}
