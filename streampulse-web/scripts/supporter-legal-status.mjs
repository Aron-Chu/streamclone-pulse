#!/usr/bin/env node
/**
 * Prints the Supporter legal, tax and Stripe-setting facts that are still
 * pending in src/shared/supporter-offer.json (Supporter launch spec 2026-10-10
 * §7). Run before setting PULSE_BILLING_LIVE_LEGAL_APPROVAL_REF: every line
 * here renders "Pending — not yet stated." or hides a promise on the site.
 *
 *   npm run supporter:legal-status           # human-readable list, exit 0
 *   npm run supporter:legal-status -- --strict   # exit 1 while anything is pending
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const configPath = resolve(here, '../../src/shared/supporter-offer.json')
const config = JSON.parse(readFileSync(configPath, 'utf8'))

const stated = value => typeof value === 'string' && value.trim().length > 0
const descriptorOk = value => typeof value === 'string' && value.length >= 5 && value.length <= 22 && !/[<>\'"*]/.test(value) && /[A-Za-z]/.test(value)

const checks = [
  ['seller.name', stated(config.seller?.name), 'Selling entity on Terms (counsel)'],
  ['seller.address', stated(config.seller?.address), 'Legal address on Terms (counsel)'],
  ['governingLaw', stated(config.governingLaw), 'Governing law on Terms (counsel)'],
  ['consumerRights', stated(config.consumerRights), 'Consumer cancellation rights on Terms and Refunds (counsel)'],
  ['billingContact.confirmed', config.billingContact?.confirmed === true, `Owner confirms ${config.billingContact?.email ?? '(none)'} is monitored for billing mail (memo T1-6)`],
  ['statementDescriptor', descriptorOk(config.statementDescriptor), 'Stripe Dashboard statement descriptor (shows the "On your statement" review row)'],
  ['stripeReceipts', config.stripeReceipts === true, 'Stripe Dashboard customer emails on (shows "Stripe emailed your receipt")'],
  ['tax.none', stated(config.tax?.none), 'Only if not collecting tax: an approved sentence (until then the always-true fallback shows)'],
]

const pending = checks.filter(([, ok]) => !ok)
console.log(`Supporter legal and billing facts (${configPath})`)
for (const [key, ok, note] of checks) console.log(`  ${ok ? 'stated ' : 'PENDING'}  ${key.padEnd(26)} ${note}`)
console.log(pending.length ? `\n${pending.length} pending. Fill src/shared/supporter-offer.json, redeploy the site, then set the live approval refs.` : '\nNothing pending.')
if (process.argv.includes('--strict') && pending.some(([key]) => key !== 'tax.none')) process.exit(1)
