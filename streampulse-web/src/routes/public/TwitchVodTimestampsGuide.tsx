import { Link } from 'react-router-dom'
import { PublicLayout } from '../../ui/components/PublicLayout'
import { InstallCta } from '../../ui/components/InstallCta'
import './growth-guides.css'

export default function TwitchVodTimestampsGuide() {
  return <PublicLayout><article className="panel public-document growth-guide">
    <p className="growth-guide__eyebrow">Twitch replay guide</p>
    <h1>Twitch VOD availability and timestamps explained</h1>
    <p>A timestamp identifies a position in one recording. It cannot make an expired or restricted recording playable. Check the source first, then the time.</p>
    <h2>Why a replay link can stop working</h2>
    <p>A broadcaster must enable past-broadcast storage for Twitch to save a VOD. Publishing choices, deletion and viewing restrictions can also affect access. A stream having been live does not guarantee a public replay.</p>
    <p>Twitch’s published retention periods for past broadcasts are generally:</p>
    <ul><li>7 days for other broadcasters.</li><li>14 days for Affiliates.</li><li>60 days for Partners, Prime and Turbo users.</li></ul>
    <p>These are storage windows, not an availability promise. Check the actual video and Twitch’s current rules. Highlights and clips are separate video types with different behavior. <a href="https://help.twitch.tv/s/article/video-on-demand" target="_blank" rel="noopener noreferrer">Twitch’s on-demand content guide</a> explains the settings and retention details.</p>
    <h2>Use the replay’s elapsed time</h2>
    <p>A player time of 1:23:45 means one hour, 23 minutes and 45 seconds into that VOD. It is not the clock time when the stream happened. Confirm that the video ID belongs to the same broadcast before adjusting a timestamp.</p>
    <p>Twitch’s sharing controls can include a “Skip to” time. You can also use the <Link to="/tools/twitch-vod-timestamp-link">free timestamp link builder</Link> to format a link from an ID or VOD URL and a known elapsed time. It strips unrelated query parameters and keeps the video ID and requested position. <a href="https://help.twitch.tv/s/article/how-to-share-a-stream" target="_blank" rel="noopener noreferrer">Twitch’s sharing guide</a> describes its own controls.</p>
    <h2>Why a StreamPulse moment may need an offset</h2>
    <p>StreamPulse measurements are attached to a broadcast timeline. A Twitch archive may start at a different point. The verified replay action uses the available source mapping; copying a broadcast offset directly into an unrelated VOD can land in the wrong scene.</p>
    <p>When source identity, alignment or available duration is uncertain, StreamPulse may show the reaction measurements without a working replay action. That is useful historical data, but it does not establish that a recording exists. A timestamp formatter cannot resolve that missing mapping.</p>
    <h2>Check a link before sharing it</h2>
    <ol><li>Open the correct broadcaster’s video and confirm the broadcast.</li><li>Check that the video is accessible to the intended viewer.</li><li>Use the elapsed player time and verify that it is inside the recording’s duration.</li><li>Open the final timestamped link and watch enough context to confirm the scene.</li><li>If the recording disappears, remove the replay promise. A saved link or reaction recap is not a video backup.</li></ol>
    <p>StreamPulse works with tracked-stream data and available source checks. It does not restore deleted VODs, remove subscriber restrictions, or analyze every historical recording.</p>
    <div className="public-document__actions"><InstallCta className="btn btn-primary" /><Link className="btn btn-secondary" to="/analytics">Explore tracked reaction data</Link></div>
    <nav className="growth-guide__related" aria-label="Related tools and guides"><Link to="/tools/twitch-vod-timestamp-link">Build a timestamp link</Link><Link to="/guides/find-twitch-moments">Find and bookmark tracked moments</Link><Link to="/support">Get help with StreamPulse</Link></nav>
    <p className="growth-guide__source">Twitch sources reviewed October 31, 2026. Follow the linked official guidance for current retention and sharing behavior.</p>
  </article></PublicLayout>
}
