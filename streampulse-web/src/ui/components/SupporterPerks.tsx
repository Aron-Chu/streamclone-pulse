import perks from '../../../../src/shared/supporter-perks.json'

/**
 * Every Supporter perk the extension gives: the one list in
 * src/shared/supporter-perks.json that the extension's offer, settings banner
 * and quick settings also render (owner decision 2026-10-09, Terms option a).
 * /supporter and the Terms show it through this component, so the two pages
 * and the extension cannot drift apart.
 */
export const SUPPORTER_PERKS = perks

export function SupporterPerkItems() {
  return (
    <>
      {perks.names.map(name => (
        <li key={name} data-perk-name={name}>
          <strong>{name}</strong>: {perks.details[name as keyof typeof perks.details]}
        </li>
      ))}
    </>
  )
}
