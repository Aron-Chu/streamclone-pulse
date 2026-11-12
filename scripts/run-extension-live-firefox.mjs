import process from 'node:process'
import { parseHarnessArgs, runFirefoxLiveHarness, HARNESS_USAGE } from './lib/firefox-live-harness.mjs'

try {
  const config = parseHarnessArgs(process.argv.slice(2))
  if (config.help) console.log(HARNESS_USAGE)
  else {
    const { exitCode, result, evidencePath } = await runFirefoxLiveHarness(config)
    console.log(`Firefox ${config.mode} harness: ${result.status}. Local evidence: ${evidencePath}`)
    process.exitCode = exitCode
  }
} catch (error) {
  console.error(`Firefox harness: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
