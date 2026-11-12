import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readPilot, writeRuntimeManifests } from './recap-pilot.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pages = readPilot(join(root, 'content', 'recap-pilot.json'))
writeRuntimeManifests(root, pages)
console.log(`recap-pilot: ${pages.length} manually reviewed pages; unapproved pages remain noindex`)
