import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { build, loadConfigFromFile } from 'vite'
import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => vi.unstubAllEnvs())

// Execute Vite's emitted module graph, not TypeScript under Vitest's import
// transform: only the build adds the DOM-dependent dynamic-import preloader.
// A separate Node VM also keeps window/document absent and forbids import(),
// matching the Chromium extension worker's module-loading restrictions.
const executeWorker = String.raw`
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
const chunks = JSON.parse(fs.readFileSync(0, 'utf8'));
const trace = [];
const errors = [];
const installed = [];
const messageListeners = [];
const storage = { sync: { watchlist: ['testchannel'] }, local: {}, session: {} };
const event = () => ({ addListener() {} });
const area = name => ({
  async get(keys) {
    if (name === 'sync' && keys === 'watchlist') trace.push('read-watchlist');
    const bag = storage[name];
    if (typeof keys === 'string') return { [keys]: bag[keys] };
    if (Array.isArray(keys)) return Object.fromEntries(keys.map(key => [key, bag[key]]));
    return { ...keys, ...bag };
  },
  async set(values) {
    Object.assign(storage[name], values);
    if (name === 'local' && 'protectSyncState' in values) trace.push('write-protect-state');
  },
  async remove(key) { delete storage[name][key]; },
  async setAccessLevel(level) { trace.push({ [name]: level }); },
});
const chrome = {
  runtime: {
    id: 'test-extension',
    getURL: file => 'chrome-extension://test-extension/' + file,
    onMessage: { addListener(listener) { messageListeners.push(listener); } }, onStartup: event(),
    onInstalled: { addListener(listener) { installed.push(listener); } },
    async sendMessage() {},
  },
  tabs: { onUpdated: event() },
  storage: { sync: area('sync'), local: area('local'), session: area('session'), onChanged: event() },
};
const context = vm.createContext({
  chrome, URL, AbortController, Event, EventTarget, TextEncoder, TextDecoder,
  console, setTimeout, clearTimeout,
  location: { href: 'chrome-extension://test-extension/background/service-worker.js' },
  self: new EventTarget(),
  fetch() { throw new Error('The startup test must not send HTTP requests'); },
});
const modules = new Map();
function moduleFor(file) {
  if (!modules.has(file)) {
    if (!(file in chunks)) throw new Error('Missing emitted module: ' + file);
    modules.set(file, new vm.SourceTextModule(chunks[file], {
      context, identifier: file,
      importModuleDynamically() {
        throw new Error('Dynamic import is unavailable in a Chromium extension service worker');
      },
    }));
  }
  return modules.get(file);
}
process.on('unhandledRejection', error => errors.push(String(error)));
const worker = moduleFor('background/service-worker.js');
await worker.link((specifier, importer) => moduleFor(path.posix.join(path.posix.dirname(importer.identifier), specifier)));
await worker.evaluate();
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate); };
await settle();
const startupTrace = [...trace];
if (installed.length !== 1) throw new Error('Missing onInstalled listener');
const installTraces = {};
for (const reason of ['install', 'update']) {
  trace.length = 0;
  installed[0]({ reason });
  await settle();
  installTraces[reason] = [...trace];
}
const send = (message, sender) => new Promise(resolve => messageListeners[0](message, sender, resolve));
const consentKey = 'pulse-analytics-consent-v1';
storage.local[consentKey] = { schemaVersion: 1, granted: true, updatedAt: 1 };
const twitch = { id: 'test-extension', frameId: 0, tab: { url: 'https://www.twitch.tv/testchannel' } };
const options = { id: 'test-extension', url: 'chrome-extension://test-extension/options/index.html' };
const twitchWithdrawal = await send({ type: 'SET_ANALYTICS_CONSENT', granted: false }, twitch);
const afterTwitch = storage.local[consentKey];
const optionsWithdrawal = await send({ type: 'SET_ANALYTICS_CONSENT', granted: false }, options);
const afterOptions = storage.local[consentKey] ?? null;
const disabledGrant = await send({ type: 'SET_ANALYTICS_CONSENT', granted: true }, options);
console.log(JSON.stringify({ startupTrace, installTraces, errors, local: storage.local, twitchWithdrawal, afterTwitch, optionsWithdrawal, afterOptions, disabledGrant }));
`

it('the built worker starts without import(), syncs the watchlist on install and update, and leaves storage access levels alone', async () => {
  vi.stubEnv('EXTENSION_TARGET', 'cws')
  const root = resolve(import.meta.dirname, '..')
  const loaded = await loadConfigFromFile({ command: 'build', mode: 'production' }, resolve(root, 'vite.config.ts'))
  if (!loaded) throw new Error('Missing extension Vite configuration')
  const config = loaded.config
  const output = await build({
    ...config,
    root,
    configFile: false,
    logLevel: 'silent',
    // Keep the production entry/chunk layout; omit only dist/ copying and
    // nested content/card builds, since this test executes the worker graph.
    plugins: config.plugins?.flat(Infinity).filter(plugin => plugin && typeof plugin === 'object' && 'name' in plugin && plugin.name !== 'streamclone-pulse-extension'),
    build: { ...config.build, write: false, emptyOutDir: false },
  })
  const outputs = Array.isArray(output) ? output : [output]
  const chunks: Record<string, string> = {}
  for (const result of outputs) {
    if (!('output' in result)) throw new Error('Unexpected watch build')
    for (const chunk of result.output) if (chunk.type === 'chunk') chunks[chunk.fileName] = chunk.code
  }
  expect(chunks['background/service-worker.js']).not.toMatch(/\bimport\(/)
  const execution = spawnSync(process.execPath, ['--experimental-vm-modules', '--input-type=module', '-e', executeWorker], {
    input: JSON.stringify(chunks), encoding: 'utf8', timeout: 10_000,
  })
  expect(execution.status, execution.stderr).toBe(0)
  const observed = JSON.parse(execution.stdout.trim())
  expect(observed.errors).toEqual([])
  // Content scripts keep reading storage.local in 0.2.2, so no area is locked.
  expect(observed.startupTrace).toEqual([])
  for (const reason of ['install', 'update']) {
    expect(observed.installTraces[reason], reason).toEqual(['read-watchlist', 'write-protect-state'])
  }
  expect(observed.local.protectSyncState.channels.testchannel.state).toBe('unauthorized')
  expect(observed.twitchWithdrawal).toEqual({ error: 'unauthorized_sender' })
  expect(observed.afterTwitch.granted).toBe(true)
  expect(observed.optionsWithdrawal).toEqual({ ok: true })
  expect(observed.afterOptions).toBeNull()
  expect(observed.disabledGrant).toEqual({ ok: false, error: 'analytics_disabled' })
}, 30_000)
