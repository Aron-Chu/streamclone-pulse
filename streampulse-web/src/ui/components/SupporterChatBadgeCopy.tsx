import { Link } from 'react-router-dom'
import { PRIVACY_PATH } from '../../lib/externalLinks'

/**
 * Public copy for the optional "Seen in chat" Supporter perk (chat crest and
 * paint shown to other StreamPulse extension users). Rendered only while
 * VITE_SUPPORTER_CHAT_BADGES is on (lib/supporterChatBadgesFlag.ts); with the
 * flag off every page keeps its current text.
 *
 * One file so /supporter, the Terms, the privacy policy and the billing summary
 * say the same thing on every branch that carries them. The facts mirror the
 * Supporter chat badges spec (2026-10-10): opt-in in the extension, off by
 * default; the public list holds Twitch user ID, username, crest level and
 * paint only; the extension downloads the whole list about once an hour and
 * matches chat locally; an entry leaves within about an hour of opt-out,
 * Twitch disconnect or account deletion; stored ID and username are deleted on
 * opt-out and 30 days after a membership ends.
 */

/** Terms, Supporter section: replaces the "What you do not get" bullet and adds the perk's terms. */
export function TermsSeenInChatBullets() {
  return (
    <>
      <li data-testid="terms-not-included">
        <strong>What you do not get:</strong> nothing is added to Twitch&rsquo;s own chat — people
        without StreamPulse always see normal chat — and no analytics, coverage or rate-limit
        changes of any kind.
      </li>
      <li data-testid="terms-seen-in-chat">
        <strong>Seen in chat (optional):</strong> it is off until you turn it on in the
        extension&rsquo;s Account &amp; Supporter settings. If you turn it on, StreamPulse publishes
        your Twitch username, Twitch user ID, crest level and paint in a public list that the
        StreamPulse extension uses to show your crest and paint in Twitch chat to its users who
        haven&rsquo;t hidden crests. Anyone can download that list. Turn it off at any time; your
        entry leaves the list within about an hour. See the{' '}
        <Link to={PRIVACY_PATH}>privacy policy</Link>.
      </li>
    </>
  )
}

/** /supporter, "What it does not include": replaces the "No public Twitch chat badge" paragraph. */
export function SupporterNoTwitchChatBadge() {
  return (
    <p data-testid="supporter-not-included-chat">
      <strong>No Twitch chat badge.</strong> Twitch&rsquo;s own chat never changes. Your crest and
      paint show only to other StreamPulse viewers, and only if you turn on Seen in chat.
    </p>
  )
}

/** /supporter: what Seen in chat publishes, who sees it and how to turn it off. */
export function SupporterSeenInChat() {
  return (
    <p data-testid="supporter-seen-in-chat">
      <strong>Seen in chat is optional.</strong> It stays off until you turn it on in the
      extension&rsquo;s Account &amp; Supporter settings. When it&rsquo;s on, StreamPulse publishes
      your Twitch username, Twitch user ID, crest level and paint in a public list, and other
      StreamPulse extension users who haven&rsquo;t hidden crests see your crest beside your name and
      your paint on it in Twitch chat. People without StreamPulse see normal chat, and nothing is sent
      to Twitch. Turn it off there at any time: your entry leaves the list within about an hour. See
      the <Link to={PRIVACY_PATH}>privacy policy</Link>.
    </p>
  )
}

/** Billing summary "Includes" line, flag on: replaces "Only you see them". */
export const BILLING_SEEN_IN_CHAT_NOTE =
  'Only you see them, unless you turn on Seen in chat: then other StreamPulse viewers see your crest and paint in chat'

/** Privacy summary: appended to "do not expose raw chat messages or chatter identity to users". */
export const PRIVACY_CHATTER_IDENTITY_EXCEPTION =
  ', except the Twitch usernames of Supporters who choose to be seen in chat'

/** Privacy, Continue with Twitch paragraph: appended sentence. */
export const PRIVACY_TWITCH_PLAIN_ID_SENTENCE =
  'If you turn on Seen in chat, StreamPulse also stores your Twitch user ID and username in plain form so it can publish them; turning it off deletes them.'

/** Privacy, "What the Chrome extension observes on Twitch": extra item. */
export function PrivacyObservesChatUsernames() {
  return (
    <li data-testid="privacy-observes-chat-usernames">
      To show Supporter crests, the extension reads the usernames on chat lines in your browser and
      compares them with the Seen in chat list. It doesn&rsquo;t store or send them.
    </li>
  )
}

/** Privacy, third-party Twitch bullet: appended sentences. */
export const PRIVACY_TWITCH_THIRD_PARTY_SEEN_IN_CHAT =
  'If you turned on Seen in chat, StreamPulse also uses that notification to delete your Seen in chat entry. For Supporters who turned on Seen in chat, StreamPulse asks Twitch’s API about once an hour for the current username of each Twitch user ID in the list, so a renamed account keeps its crest.'

/** Privacy: the Seen in chat section. */
export function PrivacySeenInChat() {
  return (
    <section data-testid="privacy-seen-in-chat">
      <h2 id="seen-in-chat">Seen in chat (optional, Supporters only)</h2>
      <p>
        <strong>What is stored.</strong> Nothing until you turn it on. When an active Supporter turns
        on Seen in chat in the extension and confirms with Twitch that it&rsquo;s their account,
        StreamPulse stores that Twitch user ID and Twitch username in plain form, the paint wave
        picked, and when the Supporter agreed and to which version of the consent text.
      </p>
      <p>
        <strong>What is public.</strong> One entry in a public list: your Twitch user ID, Twitch
        username, crest level (it shows roughly how long you&rsquo;ve supported) and paint. The list
        carries no account identifier, email, billing detail or date. Anyone can download it.
      </p>
      <p>
        <strong>How the extension uses it.</strong> Each StreamPulse extension, signed in or not,
        downloads the whole list about once an hour while a Twitch page is open, without your
        account, credentials or any channel information, and compares it with chat usernames in your
        browser. It then shows the crest and paint to its own user. StreamPulse never learns which
        channels or chats anyone opens. Twitch chat itself never changes: people without StreamPulse
        see normal chat, and nothing is sent to Twitch. You can hide everyone&rsquo;s crests in the
        extension&rsquo;s settings; then it doesn&rsquo;t download the list.
      </p>
      <p>
        <strong>Usernames.</strong> About once an hour StreamPulse asks Twitch&rsquo;s API for the
        current username of each Twitch user ID in the list, so a renamed account keeps its crest.
      </p>
      <p>
        <strong>Turning it off and deletion.</strong> Turning Seen in chat off deletes the Twitch user
        ID and username StreamPulse stored for it, and your entry leaves the list within about an
        hour. The same happens if you disconnect StreamPulse in your Twitch settings or delete your
        account. If your membership ends, your entry leaves the list within about an hour and the
        stored ID and username are deleted 30 days later, unless you support again before then.
        An extension that can&rsquo;t refresh stops using its copy of the list after 36 hours at
        most. Because the list is public, a copy someone saved outside the extension is beyond
        StreamPulse&rsquo;s control.
      </p>
    </section>
  )
}
