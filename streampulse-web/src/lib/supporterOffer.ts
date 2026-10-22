import offer from '../../../src/shared/supporter-offer.json'

/**
 * The Supporter price, from the one offer file the extension reads too
 * (src/shared/supporter-offer.json). USD only at launch.
 */
export const SUPPORTER_PRICE = offer.price
export const SUPPORTER_PRICE_MONTHLY = `${offer.price} per ${offer.period}`
export const SUPPORTER_PRICE_DISPLAY = `${SUPPORTER_PRICE_MONTHLY}, charged in US dollars`
