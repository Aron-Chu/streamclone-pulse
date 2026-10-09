import { details, names, onlyYou } from '../shared/supporter-perks.json'

/**
 * Every Supporter perk the extension gives, from the one list that the
 * website's /supporter page and Terms also render (src/shared/supporter-perks.json).
 * The settings banner chips, quick settings and "Who sees what" name the same
 * perks in the same order; tests pin all of them to that file.
 */
export function SupporterPerkList() {
  return (
    <div className="pulse-supporter-perks" data-supporter-perks-list="true">
      <p className="pulse-supporter-detail"><b>You get</b></p>
      <ul>
        {names.map(name => <li key={name} data-perk-name={name}><b>{name}</b>: {details[name as keyof typeof details]}</li>)}
      </ul>
      <p className="pulse-supporter-detail">{onlyYou}</p>
    </div>
  )
}
