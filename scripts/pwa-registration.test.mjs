import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { test } from 'node:test'
import ts from 'typescript'

function registration() {
  const listeners = new Map()
  const root = { inert: false }
  let drafts = { blocked: false, storageKey: 'drafts', texts: { first: 'one', second: 'two' }, attachments: 0 }
  let persisted = JSON.stringify(drafts.texts)
  let expire
  let reloads = 0
  const context = vm.createContext({
    exports: {},
    navigator: { serviceWorker: {
      addEventListener: (name, listener) => listeners.set(name, listener),
      register: async () => ({ addEventListener() {} })
    } },
    window: {
      location: { hostname: 'localhost', protocol: 'http:', reload: () => { reloads++ } },
      addEventListener() {},
      localStorage: { getItem: () => persisted },
      __HERMES_WEB_DRAFT_SNAPSHOT__: () => drafts
    },
    document: { readyState: 'complete', getElementById: () => root },
    setTimeout: callback => { expire = callback; return 1 }, clearTimeout() {}
  })
  const load = file => {
    const source = readFileSync(new URL(`../apps/web-desktop/src/${file}`, import.meta.url), 'utf8').replaceAll('import.meta.env.DEV', 'false')
    context.exports = {}
    vm.runInContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context)
    return context.exports
  }
  const safety = load('platform/reload-safety.ts')
  context.require = () => safety
  safety.setActiveWork({ count: 0 })
  load('pwa/register.ts').registerPwa()
  return {
    safety, root,
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
