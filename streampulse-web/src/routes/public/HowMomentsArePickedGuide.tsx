import { Link } from 'react-router-dom'
import { PublicLayout } from '../../ui/components/PublicLayout'
import { InstallCta } from '../../ui/components/InstallCta'
import './growth-guides.css'

/**
 * How a Moment is picked, in plain words. Each claim follows the backend's
 * peak picker (extension_api.go: five measured minutes, a quarter of the
 * stream's best, no viewer-only peaks), its per-stream scoring, the stream
 * edges in pulse-core, and the Moments page's Latest list (momentsPage.ts).
 */
export default function HowMomentsArePickedGuide() {
  return <PublicLayout><article className="panel public-document growth-guide">
    <h1>How Moments are picked</h1>
    <p>A Moment is one minute of a tracked stream when chat reacted more than usual for that stream. This is how StreamPulse picks those minutes, what it leaves out, and what a Moment can’t tell you.</p>
    <section id="made-of"><h2>What a Moment is made of</h2>
      <p>StreamPulse counts chat messages and emote uses, minute by minute, in the streams it tracks. It doesn’t watch the video or see what happens on screen. A Moment points to a minute when those counts rose well above that stream’s own usual level.</p></section>
    <section id="how-picked"><h2>How a minute is chosen</h2>
      <ul>
        <li><strong>Each stream is compared with itself.</strong> A minute is judged against the rest of the same stream, so a small channel doesn’t need a big channel’s numbers to have a Moment.</li>
        <li><strong>Only a rise counts.</strong> An ordinary minute, or one quieter than usual, doesn’t score.</li>
        <li><strong>Viewer counts don’t make a Moment.</strong> A jump in viewers without a rise in chat or emotes isn’t picked.</li>
        <li><strong>One reaction, one Moment.</strong> When several busy minutes sit close together, StreamPulse keeps the strongest.</li>
        <li><strong>Unrecorded minutes stay empty.</strong> A minute StreamPulse didn’t record can’t become a Moment. It is never filled in or guessed.</li>
        <li><strong>A live minute waits.</strong> On a live stream, the minute in progress isn’t scored until it ends.</li>
        <li><strong>Weak peaks drop out.</strong> A stream needs at least five measured minutes before it has any Moments, and a peak under a quarter of the stream’s strongest is dropped.</li>
      </ul></section>
    <section id="stream-edges"><h2>Stream start and end</h2>
      <p>Chat often fills with hellos when a stream starts and goodbyes when it ends. So a Moment in a stream’s first 5 minutes is labelled “Stream start”, and one in its last 10 minutes, once the stream has ended, is labelled “Stream end”. A stream’s recap ranks them behind its other reactions, and the Latest list on the Moments page leaves out the first 5 minutes.</p></section>
    <section id="reading-a-moment"><h2>Reading a Moment</h2>
      <p>An open Moment shows chat per minute, emotes per minute and the emotes used most in that minute. It can also say how much busier the minute was, for example “2× more chat than this stream’s earlier average”. That average uses only the measured minutes of the same stream before the Moment.</p>
      <p>In a stream’s first 20 minutes there is too little history to compare, so the Moment shows its rates without a ×. The Latest list also leaves out a minute that rose less than 1.2× on both chat and emotes. A Moment with no comparison yet stays listed, because there is nothing to judge it by.</p></section>
    <section id="limits"><h2>What a Moment can’t tell you</h2>
      <ul>
        <li>It counts messages, not people. One chatter can send many messages, and one message can hold several emotes.</li>
        <li>Emotes don’t tell you how chat felt. The same burst can follow a joke, a fail, a raid or something off screen. Watch the replay for the scene.</li>
        <li>It isn’t a replay count, and it doesn’t promise a good clip.</li>
        <li>A gap in recording can hide a real reaction, so check the coverage shown with the stream.</li>
        <li>A replay link can be pending or missing even when the Moment is real.</li>
      </ul>
      <p>The weights behind the score can be tuned on our side, so this guide explains how picking works rather than giving a fixed formula.</p></section>
    <div className="public-document__actions"><InstallCta className="btn btn-primary" /><Link className="btn btn-secondary" to="/analytics/moments">Browse Moments</Link></div>
    <nav className="growth-guide__related" aria-label="Related guides and help"><Link to="/guides/reading-the-chat-chart">Read a stream’s chat chart</Link><Link to="/guides/find-twitch-moments">Find and bookmark tracked moments</Link><Link to="/guides">All guides</Link><Link to="/help">Get help with StreamPulse</Link></nav>
  </article></PublicLayout>
}
