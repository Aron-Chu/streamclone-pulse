import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { build, loadConfigFromFile, type Plugin } from 'vite'
import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => vi.unstubAllEnvs())

// Execute the built worker with the switch enabled only in this in-memory test
// build. Its fetch implementation is a local mock; no HTTP request is sent.
const executeWorker = String.raw`
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { webcrypto } from 'node:crypto';
const { chunks, target } = JSON.parse(fs.readFileSync(0, 'utf8'));
const consentKey = 'pulse-analytics-consent-v1';
const storage = { sync: {}, local: { [consentKey]: { schemaVersion: 1, granted: true, updatedAt: 1 } }, session: {} };
const listeners = [];
const permissionListeners = [];
let platformGranted = true;
const event = () => ({ addListener() {} });
let pauseConsentRead = true;
let resumeRead;
let readStarted;
const readPaused = new Promise(resolve => { readStarted = resolve; });
const resume = new Promise(resolve => { resumeRead = resolve; });
const area = name => ({
  async get(keys) {
    const bag = storage[name];
    const result = typeof keys === 'string' ? { [keys]: bag[keys] } :
      Array.isArray(keys) ? Object.fromEntries(keys.map(key => [key, bag[key]])) : { ...keys, ...bag };
    if (name === 'local' && keys === consentKey && pauseConsentRead) {
      pauseConsentRead = false;
      readStarted();
      await resume;
    }
    return result;
  },
  async set(values) { Object.assign(storage[name], values); },
  async remove(key) { delete storage[name][key]; },
});
const chrome = {
  runtime: {
    id: 'test-extension', getURL: file => 'chrome-extension://test-extension/' + file,
    onMessage: { addListener(listener) { listeners.push(listener); } },
    onStartup: event(), onInstalled: event(), async sendMessage() {},
  },
  tabs: { onUpdated: event() },
  permissions: {
    onRemoved: { addListener(listener) { permissionListeners.push(listener); } },
    async getAll() { return { data_collection: platformGranted ? ['technicalAndInteraction'] : [] }; },
  },
  storage: { sync: area('sync'), local: area('local'), session: area('session'), onChanged: event() },
};
const calls = [];
let fetchStarted;
const fetchReady = new Promise(resolve => { fetchStarted = resolve; });
const context = vm.createContext({
  chrome, URL, AbortController, Event, EventTarget, TextEncoder, TextDecoder, crypto: webcrypto,
  console, setTimeout, clearTimeout,
  location: { href: 'chrome-extension://test-extension/background/service-worker.js' },
  self: new EventTarget(),
  fetch(url, init) {
    calls.push({ url, body: JSON.parse(init.body), signal: init.signal });
    fetchStarted();
    return new Promise((_resolve, reject) => {
      if (init.signal.aborted) reject(new Error('aborted'));
      else init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
  },
});
const modules = new Map();
function moduleFor(file) {
  if (!modules.has(file)) modules.set(file, new vm.SourceTextModule(chunks[file], {
    context, identifier: file,
    importModuleDynamically() { throw new Error('Unexpected dynamic import'); },
  }));
  return modules.get(file);
}
const errors = [];
process.on('unhandledRejection', error => errors.push(String(error)));
const worker = moduleFor('background/service-worker.js');
await worker.link((specifier, importer) => moduleFor(path.posix.join(path.posix.dirname(importer.identifier), specifier)));
await worker.evaluate();
const send = (message, sender) => new Promise((resolve, reject) => {
  if (listeners[0](message, sender, resolve) !== true) reject(new Error('Response channel closed'));
});
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate); };
const twitch = { id: 'test-extension', frameId: 0, tab: { url: 'https://www.twitch.tv/testchannel' } };
const options = { id: 'test-extension', url: target === 'firefox' ? 'moz-extension://test-uuid/options/index.html' : 'chrome-extension://test-extension/options/index.html' };
const emit = { type: 'EMIT_EXTENSION_ANALYTICS', name: 'pulse_load_completed' };
await send(emit, twitch);
await readPaused;
const preparedBeforeWithdrawal = await send({ type: 'PREPARE_ANALYTICS_CONSENT_GRANT' }, options);
const firstWithdrawal = await send({ type: 'SET_ANALYTICS_CONSENT', granted: false }, options);
const staleGrant = await send({ type: 'SET_ANALYTICS_CONSENT', granted: true, grantTicket: preparedBeforeWithdrawal.grantTicket }, options);
const missingTicketGrant = await send({ type: 'SET_ANALYTICS_CONSENT', granted: true }, options);
resumeRead();
await settle();
const afterStaleRead = calls.length;
let deniedGrant = null;
if (target === 'firefox') {
  platformGranted = false;
  const deniedPreparation = await send({ type: 'PREPARE_ANALYTICS_CONSENT_GRANT' }, options);
  deniedGrant = await send({ type: 'SET_ANALYTICS_CONSENT', granted: true, grantTicket: deniedPreparation.grantTicket }, options);
  platformGranted = true;
}
const validPreparation = await send({ type: 'PREPARE_ANALYTICS_CONSENT_GRANT' }, options);
const grant = await send({ type: 'SET_ANALYTICS_CONSENT', granted: true, grantTicket: validPreparation.grantTicket }, options);
const replayedGrant = await send({ type: 'SET_ANALYTICS_CONSENT', granted: true, grantTicket: validPreparation.grantTicket }, options);
await send(emit, twitch);
await fetchReady;
const preparedBeforePermissionRemoval = await send({ type: 'PREPARE_ANALYTICS_CONSENT_GRANT' }, options);
permissionListeners[0]({ permissions: ['tabs'] });
const unrelatedPermissionAborted = calls[0].signal.aborted;
permissionListeners[0]({ data_collection: ['technicalAndInteraction'] });
await settle();
const afterPermissionRemoval = await send({ type: 'SET_ANALYTICS_CONSENT', granted: true, grantTicket: preparedBeforePermissionRemoval.grantTicket }, options);
await send(emit, twitch);
await settle();
console.log(JSON.stringify({
  firstWithdrawal, staleGrant, missingTicketGrant, replayedGrant, afterPermissionRemoval, afterStaleRead, deniedGrant, grant, unrelatedPermissionAborted,
  count: calls.length, body: calls[0]?.body, aborted: calls[0]?.signal.aborted,
  storedConsent: storage.local[consentKey] ?? null, errors,
}));
`

it.each(['cws', 'edge', 'firefox'])('built %s worker cancels stale and in-flight analytics on withdrawal', async target => {
  vi.stubEnv('EXTENSION_TARGET', target)
  const root = resolve(import.meta.dirname, '..')
  const loaded = await loadConfigFromFile({ command: 'build', mode: 'production' }, resolve(root, 'vite.config.ts'))
  if (!loaded) throw new Error('Missing extension Vite configuration')
  let switched = false
  const testSwitch: Plugin = {
    name: 'test-enable-analytics-in-memory',
    enforce: 'pre',
    transform(code, id) {
      if (!id.replaceAll('\\', '/').endsWith('/src/shared/extensionAnalytics.ts')) return
      const original = 'export const EXTENSION_ANALYTICS_INGEST_ENABLED = false'
      if (!code.includes(original)) throw new Error('Expected disabled analytics switch')
      switched = true
      return code.replace(original, 'export const EXTENSION_ANALYTICS_INGEST_ENABLED = true')
    },
  }
  const config = loaded.config
  const configuredPlugins = ((config.plugins ?? []) as unknown[]).flat(Infinity)
    .filter((plugin): plugin is Plugin => !!plugin && typeof plugin === 'object' && 'name' in plugin && plugin.name !== 'streamclone-pulse-extension')
  const output = await build({
    ...config, root, configFile: false, logLevel: 'silent',
    plugins: [testSwitch, ...configuredPlugins],
    build: { ...config.build, write: false, emptyOutDir: false },
  })
  expect(switched).toBe(true)
  const chunks: Record<string, string> = {}
  for (const result of Array.isArray(output) ? output : [output]) {
    if (!('output' in result)) throw new Error('Unexpected watch build')
    for (const chunk of result.output) if (chunk.type === 'chunk') chunks[chunk.fileName] = chunk.code
  }
  const execution = spawnSync(process.execPath, ['--experimental-vm-modules', '--input-type=module', '-e', executeWorker], {
    input: JSON.stringify({ chunks, target }), encoding: 'utf8', timeout: 10_000,
  })
  expect(execution.status, execution.stderr).toBe(0)
  const observed = JSON.parse(execution.stdout.trim())
  expect(observed.firstWithdrawal).toEqual({ ok: true })
  expect(observed.staleGrant).toEqual({ ok: false, error: 'analytics_consent_superseded' })
  expect(observed.missingTicketGrant).toEqual({ ok: false, error: 'analytics_consent_superseded' })
  expect(observed.replayedGrant).toEqual({ ok: false, error: 'analytics_consent_superseded' })
  expect(observed.afterPermissionRemoval).toEqual({ ok: false, error: 'analytics_consent_superseded' })
  expect(observed.afterStaleRead).toBe(0)
  if (target === 'firefox') expect(observed.deniedGrant).toEqual({ ok: false, error: 'analytics_consent_update_failed' })
  expect(observed.grant).toEqual({ ok: true })
  expect(observed.unrelatedPermissionAborted).toBe(false)
  expect(observed.count).toBe(1)
  expect(observed.body).toEqual({ events: [{ name: 'pulse_load_completed' }] })
  expect(observed.aborted).toBe(true)
  expect(observed.storedConsent).toBeNull()
  expect(observed.errors).toEqual([])
}, 30_000)
