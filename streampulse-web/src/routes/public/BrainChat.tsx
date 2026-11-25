import { Link } from 'react-router-dom'
import { Eye, MessageSquareText, ShieldQuestion } from 'lucide-react'
import { PublicLayout } from '../../ui/components/PublicLayout'
import { BrainChatDemo } from './BrainChatDemo'
import './brainchat.css'

/**
 * /brainchat — the extension's BrainChat card ("Coming later") links here.
 * BrainChat is not out: no date, no sign-up, nothing collected. The demo runs
 * in the page on one made-up stream and says so; nothing is fetched or sent.
 */
export default function BrainChat() {
  return (
    <PublicLayout>
      <div className="brainchat-page" data-testid="brainchat-page">
        <header className="brainchat-page__head">
          <span className="brainchat-page__badge"><span aria-hidden="true" />Coming later</span>
          <h1 className="public-title">BrainChat</h1>
          <p className="brainchat-page__lead">
            BrainChat reads Twitch chat around a moment and says what it was about, who it was aimed at, and how chat felt.
          </p>
          <p className="brainchat-page__status" data-testid="brainchat-status">
            <strong>It isn&rsquo;t out yet.</strong> There&rsquo;s no date and nothing to sign up for, and it isn&rsquo;t connected to the StreamPulse extension.
          </p>
        </header>

        <BrainChatDemo />
        <p className="brainchat-page__note" data-testid="brainchat-made-up">
          Everything in this demo is made up: the stream, the chat and the counts. The emotes are placeholder drawings.
        </p>

        <ul className="brainchat-page__how" aria-label="How BrainChat reads chat">
          <li>
            <Eye aria-hidden="true" />
            <h2>Finds the moments</h2>
            <p>It marks where chat sped up and puts the busiest first.</p>
          </li>
          <li>
            <MessageSquareText aria-hidden="true" />
            <h2>Reads the chat</h2>
            <p>What chat was doing, who it was aimed at and how it felt, with the lines it read.</p>
          </li>
          <li>
            <ShieldQuestion aria-hidden="true" />
            <h2>Says when it can&rsquo;t tell</h2>
            <p>Too few messages or a split chat, and it says &ldquo;not sure&rdquo; instead of guessing.</p>
          </li>
        </ul>

        <article className="panel public-document brainchat-page__until">
          <h2>Until then</h2>
          <p>StreamPulse already shows the moments chat reacted to most and the emotes it used.</p>
          <div className="public-document__actions">
            <Link className="btn btn-primary" to="/analytics">Browse the Hub</Link>
          </div>
        </article>
      </div>
    </PublicLayout>
  )
}
