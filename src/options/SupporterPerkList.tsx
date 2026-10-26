import { details, names, onlyYou } from '../shared/supporter-perks.json'

/**
 * Every Supporter perk the extension gives, from the one list that the
 * website's /supporter page and Terms also render (src/shared/supporter-perks.json).
 * The settings banner chips, quick settings and the Your look preview name the same
 * perks in the same order; tests pin all of them to that file.
 */
export function SupporterPerkList({ compact = false }: { compact?: boolean } = {}) {
  return (
    <div className={`pulse-supporter-perks${compact ? ' pulse-supporter-perks-compact' : ''}`} data-supporter-perks-list="true">
      {compact ? null : <p className="pulse-supporter-detail"><b>You get</b></p>}
      <ul>
        {names.map(name => <li key={name} data-perk-name={name}><b>{name}</b>{compact ? null : <>: {details[name as keyof typeof details]}</>}</li>)}
      </ul>
      <p className="pulse-supporter-detail">{compact ? 'Only you see these cosmetics. Nothing is added to chat.' : onlyYou}</p>
    </div>
  )
}
