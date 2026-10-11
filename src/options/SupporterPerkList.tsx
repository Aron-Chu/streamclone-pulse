import { details, names, onlyYou, seenInChat as SEEN_IN_CHAT } from '../shared/supporter-perks.json'

/**
 * Every Supporter perk the extension gives, from the one list that the
 * website's /supporter page and Terms also render (src/shared/supporter-perks.json).
 * The settings banner chips, quick settings and "Who sees what" name the same
 * perks in the same order; tests pin all of them to that file.
 *
 * Seen in chat is listed, with its own "who sees it" line, only where the
 * feature is live (`seenInChat`), so the offer names only what ships.
 */
export function SupporterPerkList({ seenInChat = false }: { seenInChat?: boolean }) {
  return (
    <div className="pulse-supporter-perks" data-supporter-perks-list="true">
      <p className="pulse-supporter-detail"><b>You get</b></p>
      <ul>
        {names.map(name => <li key={name} data-perk-name={name}><b>{name}</b>: {details[name as keyof typeof details]}</li>)}
        {seenInChat ? <li data-perk-name={SEEN_IN_CHAT.name}><b>{SEEN_IN_CHAT.name}</b>: {SEEN_IN_CHAT.detail}</li> : null}
      </ul>
      <p className="pulse-supporter-detail">{seenInChat ? SEEN_IN_CHAT.onlyYou : onlyYou}</p>
    </div>
  )
}
