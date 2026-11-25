import { Link } from 'react-router-dom'
import { PublicLayout } from '../../ui/components/PublicLayout'
import './growth-guides.css'

/** Every public guide, and the timestamp link builder at the top of its guide. */
export const GUIDE_CARDS = [
  { kind: 'Guide', to: '/guides/how-moments-are-picked', title: 'How Moments are picked',
    description: 'What makes a minute a Moment, what gets left out, and what a Moment can’t tell you.' },
  { kind: 'Guide', to: '/guides/reading-the-chat-chart', title: 'Reading the chat chart',
    description: 'Viewers, chat and emotes on a stream’s page, and how to tell a quiet minute from a missing one.' },
  { kind: 'Guide', to: '/guides/find-twitch-moments', title: 'Find and bookmark tracked moments',
    description: 'Check coverage, review a reaction in context, and keep the moments worth returning to.' },
  { kind: 'Guide', to: '/guides/twitch-vod-timestamps', title: 'Twitch VOD timestamp links',
    description: 'Which time to enter, why a replay link can stop working, and how to check one before you share it.' },
  { kind: 'Tool', to: '/guides/twitch-vod-timestamps#builder', title: 'Timestamp link builder',
    description: 'Paste a Twitch replay link and a time, then copy a link that starts there. It runs in your browser.' },
] as const

export default function GuidesIndex() {
  return <PublicLayout><article className="panel public-document growth-guide">
    <h1>Guides</h1>
    <p>Short guides to reading what StreamPulse measures, and a tool for sharing the moment you found.</p>
    <ul className="guides-index">
      {GUIDE_CARDS.map(card => <li key={card.to} className="guides-index__card">
        <p className="guides-index__kind">{card.kind}</p>
        <h2><Link to={card.to}>{card.title}</Link></h2>
        <p>{card.description}</p>
      </li>)}
    </ul>
  </article></PublicLayout>
}
