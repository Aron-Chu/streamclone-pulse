import process from 'node:process'
import { ACCEPTANCE_USAGE, parseAcceptanceArgs, runFirefoxAcceptance } from './lib/firefox-live-acceptance.mjs'

try {
  const config = parseAcceptanceArgs(process.argv.slice(2))
  if (config.help) console.log(ACCEPTANCE_USAGE)
  else {
    const run = await runFirefoxAcceptance(config)
    console.log(`Firefox acceptance: ${run.result.status}; local evidence: ${run.evidencePath}`)
    process.exitCode = run.exitCode
  }
} catch (error) {
  console.error(`Firefox acceptance: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
