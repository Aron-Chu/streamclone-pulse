import { details, names, onlyYou, seenInChat as chatPerk } from '../shared/supporter-perks.json'

/**
 * Every Supporter perk the extension gives, from the one list that the
 * website's /supporter page and Terms also render (src/shared/supporter-perks.json).
 * The settings banner chips, quick settings and the Your look preview name the same
 * perks in the same order; tests pin all of them to that file. With Seen in
 * chat, the full list leaves who-sees-what to the cards' Only you and Public
 * tags; the compact offer keeps the sentence.
 */
export function SupporterPerkList({ compact = false, seenInChat = false }: { compact?: boolean; seenInChat?: boolean } = {}) {
  return (
    <div className={`pulse-supporter-perks${compact ? ' pulse-supporter-perks-compact' : ''}`} data-supporter-perks-list="true">
      {compact ? null : <p className="pulse-supporter-detail"><b>You get</b></p>}
      <ul>
        {names.map(name => <li key={name} data-perk-name={name}><b>{name}</b>{compact ? null : <>: {details[name as keyof typeof details]}</>}</li>)}
        {seenInChat ? <li data-perk-name={chatPerk.name}><b>{chatPerk.name}</b>{compact ? null : <>: {chatPerk.detail}</>}</li> : null}
      </ul>
      {seenInChat && !compact ? null : <p className="pulse-supporter-detail">{seenInChat ? chatPerk.onlyYou : onlyYou}</p>}
    </div>
  )
}
