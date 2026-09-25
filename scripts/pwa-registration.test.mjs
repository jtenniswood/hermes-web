import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { test } from 'node:test'
import ts from 'typescript'

function registration(network = { pause: async () => true, resume() {} }) {
  const listeners = new Map()
  const windowListeners = new Map(), documentListeners = new Map()
  let poll, pollInterval, updates = 0, update = async () => {}
  const worker = { installing: null, waiting: null, addEventListener() {}, async update() { updates++; await update() } }
  const root = { inert: false }
  let drafts = { blocked: false, storageKey: 'drafts', texts: { first: 'one', second: 'two' }, attachments: 0 }
  let persisted = JSON.stringify(drafts.texts)
  let expire
  let reloads = 0
  const context = vm.createContext({
    exports: {},
    navigator: { serviceWorker: {
      controller: {},
      addEventListener: (name, listener) => listeners.set(name, listener),
      register: async () => worker
    } },
    window: {
      location: { hostname: 'localhost', protocol: 'http:', reload: () => { reloads++ } },
      addEventListener: (name, listener) => windowListeners.set(name, listener),
      dispatchEvent() {},
      setInterval: (callback, delay) => { poll = callback; pollInterval = delay },
      localStorage: { getItem: () => persisted },
      __HERMES_WEB_DRAFT_SNAPSHOT__: () => drafts
    },
    document: { readyState: 'complete', visibilityState: 'visible', getElementById: () => root,
      addEventListener: (name, listener) => documentListeners.set(name, listener) },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail } },
    setTimeout: callback => { expire = callback; return 1 }, clearTimeout() {}
  })
  const load = file => {
    const source = readFileSync(new URL(`../apps/web-desktop/src/${file}`, import.meta.url), 'utf8').replaceAll('import.meta.env.DEV', 'false')
    context.exports = {}
    vm.runInContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context)
    return context.exports
  }
  const safety = load('platform/reload-safety.ts')
  context.require = name => name === './update-network'
    ? { installUpdateNetworkBarrier: () => network } : safety
  safety.setActiveWork({ count: 0 })
  const pwa = load('pwa/register.ts')
  pwa.registerPwa()
  return {
    safety, root,
    worker,
    updates: () => updates,
    notice: () => pwa.currentPwaUpdate(),
    updateWith(callback) { update = callback },
    visible(value) { context.document.visibilityState = value ? 'visible' : 'hidden' },
    online(value) { context.navigator.onLine = value },
    async poll() { await new Promise(setImmediate); assert.equal(pollInterval, 60_000); await poll() },
    async event(name) { await new Promise(setImmediate); await (windowListeners.get(name) || documentListeners.get(name))() },
    change(texts, options = {}) {
      drafts = { ...drafts, ...options, texts }
      persisted = JSON.stringify(texts)
    },
    losePersistedDraft() { persisted = '{}' },
    saveWith(flush) { context.window.__HERMES_WEB_FLUSH_DRAFTS__ = flush },
    expire() { expire() },
    controllerChange() { return listeners.get('controllerchange')() },
    reloads: () => reloads,
    async ask(type, transaction = 'update') {
      let reply
      await listeners.get('message')({ data: { type, transaction }, ports: [{ postMessage: value => { reply = value } }] })
      return reply
    }
  }
}

test('visible apps discover waiting updates on return, reconnect, and a timer without activating them', async () => {
  for (const trigger of [app => app.event('focus'), app => app.event('visibilitychange'), app => app.event('online'), app => app.poll()]) {
    const app = registration()
    let messages = 0
    app.updateWith(async () => { app.worker.waiting = { postMessage() { messages++ } } })
    await trigger(app)
    assert.equal(app.updates(), 1)
    assert.equal(app.notice().message, 'A Hermes update is ready.')
    assert.equal(messages, 0)
    assert.equal(app.reloads(), 0)
    assert.equal(app.root.inert, false)
  }
})

test('background update discovery skips hidden, offline, installing, and concurrent checks', async () => {
  const app = registration()
  app.visible(false)
  await app.poll()
  app.visible(true)
  app.online(false)
  await app.event('focus')
  app.online(true)
  app.worker.installing = {}
  await app.poll()
  assert.equal(app.updates(), 0)
  app.worker.installing = null
  let finish
  app.updateWith(() => new Promise(resolve => { finish = resolve }))
  const pending = app.poll()
  await app.event('focus')
  await app.event('visibilitychange')
  assert.equal(app.updates(), 1)
  finish()
  await pending
})

test('a failed update check can retry after proxy sign-in or connectivity recovers', async () => {
  const app = registration()
  app.updateWith(async () => { throw new Error('Proxy returned a login page') })
  await app.poll()
  assert.equal(app.notice(), null)
  app.updateWith(async () => {})
  await app.event('online')
  assert.equal(app.updates(), 2)
  assert.equal(app.reloads(), 0)
})

test('update verification accepts unchanged draft entries after their insertion order changes', async () => {
  const app = registration()
  assert.equal((await app.ask('HERMES_FLUSH_UPDATE')).ready, true)
  app.change({ second: 'two', first: 'one' })
  assert.equal((await app.ask('HERMES_VERIFY_UPDATE')).ready, true)
})

test('update verification rejects changed, removed, or unpersisted drafts', async () => {
  for (const texts of [{ first: 'changed', second: 'two' }, { first: 'one' }, { other: 'one', second: 'two' }]) {
    const app = registration()
    assert.equal((await app.ask('HERMES_FLUSH_UPDATE')).ready, true)
    app.change(texts)
    assert.equal((await app.ask('HERMES_VERIFY_UPDATE')).ready, false)
  }
  const app = registration()
  assert.equal((await app.ask('HERMES_FLUSH_UPDATE')).ready, true)
  app.losePersistedDraft()
  assert.equal((await app.ask('HERMES_VERIFY_UPDATE')).ready, false)
})

test('verification still requires the prepared transaction and idle composers', async () => {
  for (const change of [
    app => app.safety.setActiveWork({ count: 1 }),
    app => app.change({ first: 'one', second: 'two' }, { attachments: 1 }),
    app => app.change({ first: 'one', second: 'two' }, { blocked: true }),
    app => app.change({ first: 'one', second: 'two' }, { storageKey: 'other-drafts' })
  ]) {
    const app = registration()
    assert.equal((await app.ask('HERMES_FLUSH_UPDATE')).ready, true)
    assert.equal(app.root.inert, true)
    change(app)
    assert.equal((await app.ask('HERMES_VERIFY_UPDATE')).ready, false)
    await app.ask('HERMES_ABORT_UPDATE')
    assert.equal(app.root.inert, false)
  }
  const app = registration()
  assert.equal((await app.ask('HERMES_VERIFY_UPDATE')).ready, false)
  assert.equal((await app.ask('HERMES_FLUSH_UPDATE')).ready, true)
  assert.equal((await app.ask('HERMES_VERIFY_UPDATE', 'other-update')).ready, false)
})

test('verification accepts an independently persisted draft added by another tab', async () => {
  const app = registration()
  assert.equal((await app.ask('HERMES_FLUSH_UPDATE')).ready, true)
  app.change({ first: 'one', second: 'two', third: 'another tab' })
  assert.equal((await app.ask('HERMES_VERIFY_UPDATE')).ready, true)
})

test('an aborted or expired asynchronous flush cannot relock the page or acknowledge readiness', async () => {
  for (const abort of [app => app.ask('HERMES_ABORT_UPDATE'), app => app.expire()]) {
    const app = registration()
    let finish
    app.saveWith(() => new Promise(resolve => { finish = resolve }))
    const flushing = app.ask('HERMES_FLUSH_UPDATE')
    assert.equal(app.root.inert, true)
    await abort(app)
    assert.equal(app.root.inert, false)
    finish()
    assert.equal((await flushing).ready, false)
    assert.equal(app.root.inert, false)
  }
})

test('an abort during the final persistence check prevents controller-change reload', async () => {
  const app = registration()
  assert.equal((await app.ask('HERMES_FLUSH_UPDATE')).ready, true)
  let finish
  app.saveWith(() => new Promise(resolve => { finish = resolve }))
  const changed = app.controllerChange()
  await app.ask('HERMES_ABORT_UPDATE')
  finish()
  await changed
  assert.equal(app.reloads(), 0)
  assert.equal(app.root.inert, false)
})

test('pending network activity refuses update and resumes requests without reloading', async () => {
  let resumed = 0
  const app = registration({ pause: async () => false, resume: () => { resumed++ } })
  assert.equal((await app.ask('HERMES_FLUSH_UPDATE')).ready, false)
  assert.equal(app.root.inert, false)
  assert.equal(resumed, 1)
  await app.controllerChange()
  assert.equal(app.reloads(), 0)
})

test('an abort while requests drain prevents a late readiness reply from freezing the page', async () => {
  let finish, resumed = 0
  const app = registration({ pause: () => new Promise(resolve => { finish = resolve }), resume: () => { resumed++ } })
  const flushing = app.ask('HERMES_FLUSH_UPDATE')
  await app.ask('HERMES_ABORT_UPDATE')
  finish(true)
  assert.equal((await flushing).ready, false)
  assert.equal(app.root.inert, false)
  assert.equal(resumed, 1)
})
