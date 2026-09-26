import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const root = path.resolve('apps/web-desktop/src')

function startupHarness({ configurationError, rendererError, existingBridge } = {}) {
  const state = { configured: false, tracking: false, tokenConsumed: false, rendererLoaded: false }
  const listeners = new Map()
  const storage = new Map([['hermes-web.comparison.profile', 'saved-profile']])
  const window = {
    location: { href: 'https://web.example.test/?win=hud' },
    history: { replaceState: (_state, _title, url) => { window.location.href = new URL(url, window.location.href).href } },
    addEventListener: (type, handler) => { listeners.set(type, handler) },
    hermesDesktop: existingBridge
  }
  const document = { documentElement: { dataset: {} } }
  const sessionStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: key => storage.delete(key)
  }
  let finishRenderer
  const rendererReady = new Promise(resolve => { finishRenderer = resolve })
  const mocks = new Map(Object.entries({
    'pwa/register.ts': { registerPwa() {} },
    'platform/runtime.ts': { runtimeConfig() {
      if (configurationError) throw configurationError
      state.configured = true
    } },
    'platform/reload-safety.ts': { trackMediaRequests() { state.tracking = true } },
    'platform/connection-state.ts': { consumeConnectionToken() { state.tokenConsumed = true } },
    'web-bridge/bridge.ts': () => {
      // Check prerequisites at dependency evaluation, before installation.
      assert.equal(state.configured && state.tracking && state.tokenConsumed, true)
      assert.equal(document.documentElement.dataset.experience, 'browser')
      assert.equal(storage.get('hermes-web.browser.profile'), 'saved-profile')
      return { createWebBridge: () => ({ getConnection: async profile => ({ profile }), profile: {} }) }
    },
    '../../desktop/src/main.ts': () => {
      state.rendererLoaded = true
      assert.ok(window.hermesDesktop)
      assert.ok(listeners.has('contextmenu'))
      assert.ok(listeners.has('click'))
      assert.equal(new URL(window.location.href).searchParams.has('win'), false)
      if (rendererError) throw rendererError
      // Preserve the asynchronous module load through TypeScript's import helper.
      return Object.assign(rendererReady, { __esModule: true })
    }
  }).map(([file, value]) => [path.resolve(root, file), value]))
  const cache = new Map()
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename)
    if (mocks.has(filename)) {
      const value = mocks.get(filename)
      const exports = typeof value === 'function' ? value() : value
      cache.set(filename, exports)
      return exports
    }
    const context = vm.createContext({
      exports: {}, window, document, sessionStorage, URL,
      require: specifier => load(path.resolve(path.dirname(filename), `${specifier}.ts`))
    })
    const source = readFileSync(filename, 'utf8')
    vm.runInContext(ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText, context)
    cache.set(filename, context.exports)
    return context.exports
  }
  return { load: file => load(path.join(root, file)), state, window, listeners, finishRenderer }
}

test('startup prepares browser state and the bridge before evaluating the renderer, and awaits it', async () => {
  const harness = startupHarness()
  const { startBrowserApplication } = harness.load('startup.ts')
  assert.equal(harness.window.hermesDesktop, undefined)
  assert.equal(harness.listeners.size, 0)
  assert.equal(harness.state.rendererLoaded, false)

  let completed = false
  const starting = startBrowserApplication().then(() => { completed = true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(harness.state.rendererLoaded, true)
  assert.equal(completed, false)
  assert.equal((await harness.window.hermesDesktop.getConnection()).profile, 'saved-profile')
  assert.equal((await harness.window.hermesDesktop.getConnection('other')).profile, 'other')
  assert.equal((await harness.window.hermesDesktop.profile.get()).profile, 'saved-profile')
  harness.finishRenderer()
  await starting
  assert.equal(completed, true)
})

test('invalid configuration stops startup before bridge and renderer initialization', async () => {
  const error = new Error('Gateway configuration is unavailable')
  const harness = startupHarness({ configurationError: error })
  await assert.rejects(harness.load('startup.ts').startBrowserApplication(), thrown => thrown === error)
  assert.equal(harness.window.hermesDesktop, undefined)
  assert.equal(harness.listeners.size, 0)
  assert.equal(harness.state.rendererLoaded, false)
})

test('renderer load errors reach the caller unchanged for startup recovery', async () => {
  const error = new Error('Failed to fetch dynamically imported module')
  const harness = startupHarness({ rendererError: error })
  await assert.rejects(harness.load('startup.ts').startBrowserApplication(), thrown => thrown === error)
})

test('explicit bridge installation preserves a preinstalled bridge', async () => {
  const bridge = { getConnection: async profile => ({ profile }), profile: {} }
  const harness = startupHarness({ existingBridge: bridge })
  harness.finishRenderer()
  await harness.load('startup.ts').startBrowserApplication()
  assert.equal(harness.window.hermesDesktop, bridge)
})
