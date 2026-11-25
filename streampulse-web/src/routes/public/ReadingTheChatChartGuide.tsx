import { Link } from 'react-router-dom'
import { PublicLayout } from '../../ui/components/PublicLayout'
import { InstallCta } from '../../ui/components/InstallCta'
import './growth-guides.css'

/**
 * The stream page's chart (analytics-console SessionSpChart), in plain words:
 * its lanes, readout, ranges and Show on chart markers, and the three states a
 * minute can be in (docs/guardrail-policy.md in the SDLC repo).
 */
export default function ReadingTheChatChartGuide() {
  return <PublicLayout><article className="panel public-document growth-guide">
    <h1>Reading the chat chart</h1>
    <p>Each tracked stream has a page with one chart of viewers, chat and emotes on a shared timeline. This is what each part means, and how to tell a quiet minute from one that wasn’t recorded.</p>
    <section id="lanes"><h2>The three lanes</h2>
      <ul>
        <li><strong>Viewers</strong> is the cyan line: the stream’s viewer count.</li>
        <li><strong>Chat</strong> is violet bars, one per minute: how many chat messages were sent. It counts messages, not people.</li>
        <li><strong>Emotes</strong> is green bars: emote uses each minute. One message can hold several emotes, so this lane can run higher than chat. Bars turn brighter above one line set for the whole stream, a little over half of its busiest emote minute. That line helps you spot bursts; it isn’t a score.</li>
      </ul>
      <p>A thin line over the chat and emote bars shows the trend. Each lane’s label names its peak, the busiest measured minute. All, Viewers, Chat and Emotes choose which lanes show, and Emotes on chart adds a line for an emote you pick.</p></section>
    <section id="readout"><h2>Point at a minute</h2>
      <p>The line above the chart reads the time into the stream, then viewers, chat per minute and emotes per minute for the minute under your pointer. With nothing under the pointer, it shows the latest measured minute. Click to pin a minute and see its details.</p></section>
    <section id="ranges"><h2>Zoom in and out</h2>
      <p>The range buttons show the last 15 minutes or 1, 2 or 4 hours, when the stream is longer than that, and Full shows all of it. Expand gives the chart more room. Zoomed out, each bar averages several minutes, and the readout says so, such as “10-min avg”. If only some of those minutes were measured, it adds how many, such as “7 of 10 min measured”, and the bar is drawn fainter.</p></section>
    <section id="show-on-chart"><h2>Show on chart</h2>
      <p>This menu adds markers. They are all off each time the page loads.</p>
      <ul>
        <li><strong>Moments</strong> adds numbered pins, 1 to 5, for the first five rows of the Pulse Moments list on the same page. Pins that sit close together merge.</li>
        <li><strong>Averages</strong> adds a dotted line to each lane at the average of its measured minutes.</li>
        <li><strong>Live edge</strong> marks the newest measured minute of a live stream.</li>
      </ul></section>
    <section id="quiet-or-missing"><h2>Quiet, not recorded, or unknown</h2>
      <p>These three look different on purpose:</p>
      <ul>
        <li><strong>Quiet:</strong> StreamPulse read the minute and nothing happened. It reads 0, and the chat and emote lanes draw a thin bar at the bottom.</li>
        <li><strong>Not recorded:</strong> StreamPulse didn’t read that stretch. It shows as hatched stripes, never as a zero. If tracking began after the stream started, pointing at that start says how long wasn’t tracked.</li>
        <li><strong>Unknown:</strong> a figure the chart doesn’t have reads “—”, never a number.</li>
      </ul></section>
    <section id="limits"><h2>What the chart can’t tell you</h2>
      <p>It shows counts, not the messages themselves. An emote burst doesn’t tell you how chat felt, and a big audience doesn’t mean chat was busy. The figures cover only what StreamPulse recorded, so check for hatched stretches before you compare two parts of a stream.</p></section>
    <div className="public-document__actions"><InstallCta className="btn btn-primary" /><Link className="btn btn-secondary" to="/analytics">Explore tracked channels</Link></div>
    <nav className="growth-guide__related" aria-label="Related guides and help"><Link to="/guides/how-moments-are-picked">See how Moments are picked</Link><Link to="/guides/find-twitch-moments">Find and bookmark tracked moments</Link><Link to="/guides">All guides</Link><Link to="/help">Get help with StreamPulse</Link></nav>
  </article></PublicLayout>
}
