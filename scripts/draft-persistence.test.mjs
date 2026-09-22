import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import ts from 'typescript'

const context = vm.createContext({ exports: {} })
const source = readFileSync(new URL('../apps/web-desktop/src/platform/draft-persistence.ts', import.meta.url), 'utf8')
vm.runInContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context)
const { createDraftPersistence } = context.exports
function shared(initial = { older: 'keep me' }) {
  let value = JSON.stringify(initial), queue = Promise.resolve(), rejectWrites = false
  const storage = {
    getItem: () => value,
    setItem: (_key, next) => { if (rejectWrites) throw Error('Quota'); value = next },
    removeItem: () => { if (rejectWrites) throw Error('Quota'); value = null }
  }
  const locks = { request: (_key, work) => {
    const result = queue.then(work)
    queue = result.catch(() => {})
    return result
  } }
  return { storage, locks, read: () => JSON.parse(value || '{}'), fail: next => { rejectWrites = next } }
}

test('concurrent draft writes preserve other tabs and cleared sessions do not erase unrelated drafts', async () => {
  const store = shared()
  const first = createDraftPersistence('drafts', 50, store.storage, store.locks)
  const second = createDraftPersistence('drafts', 50, store.storage, store.locks)
  first.write('a', 'one')
  second.write('b', 'two')
  first.write('a', 'newer')
  await Promise.all([first.flush(), second.flush()])
  assert.deepEqual(store.read(), { older: 'keep me', b: 'two', a: 'newer' })
  second.write('b', '')
  await second.flush()
  assert.deepEqual(store.read(), { older: 'keep me', a: 'newer' })
})

test('pending ownership remains until the newest write is durable', async () => {
  const store = shared()
  let release
  const gate = new Promise(resolve => { release = resolve })
  const draft = createDraftPersistence('drafts', 50, store.storage, { request: async (_key, work) => { await gate; return work() } })
  draft.write('a', 'one')
  const flush = draft.flush()
  draft.write('a', 'two')
  assert.equal(draft.pending('a'), true)
  release()
  await flush
  assert.equal(draft.pending('a'), false)
  assert.equal(store.read().a, 'two')
})

test('a resumed ordinary save supersedes an update write still waiting for its lock', async () => {
  const store = shared()
  let release, requested
  const gate = new Promise(resolve => { release = resolve })
  const entered = new Promise(resolve => { requested = resolve })
  const draft = createDraftPersistence('drafts', 50, store.storage, { request: async (_key, work) => { requested(); await gate; return work() } })
  draft.write('a', 'before abort')
  await entered
  draft.cancel('a')
  store.storage.setItem('drafts', JSON.stringify({ older: 'keep me', a: 'typed after abort' }))
  release()
  await draft.flush()
  assert.equal(store.read().a, 'typed after abort')
})

test('failed writes retain pending drafts and can be retried after storage recovers', async () => {
  const store = shared()
  const draft = createDraftPersistence('drafts', 50, store.storage, store.locks)
  store.fail(true)
  draft.write('a', 'one')
  await assert.rejects(draft.flush())
  assert.equal(draft.pending('a'), true)
  assert.deepEqual(store.read(), { older: 'keep me' })
  store.fail(false)
  draft.write('b', 'two')
  await assert.rejects(draft.flush())
  draft.write('a', 'one')
  await draft.flush()
  assert.deepEqual(store.read(), { older: 'keep me', b: 'two', a: 'one' })
})

test('storage bounds retain the newest keys without mutating malformed records', async () => {
  const store = shared({ old: 'old', keep: 'keep' })
  const draft = createDraftPersistence('drafts', 2, store.storage, store.locks)
  draft.write('new', 'new')
  await draft.flush()
  assert.deepEqual(store.read(), { keep: 'keep', new: 'new' })
  store.storage.setItem('drafts', '{broken')
  draft.write('another', 'text')
  await assert.rejects(draft.flush())
  assert.equal(store.storage.getItem('drafts'), '{broken')
})

test('actual composer flushes preserve stale-tab drafts and ordinary saves remain synchronous', async () => {
  const filename = new URL('../apps/web-desktop/src/upstream/transforms.ts', import.meta.url)
  const transformContext = vm.createContext({ exports: {}, require: createRequire(filename) })
  vm.runInContext(ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, transformContext)
  const composerFile = new URL('../apps/desktop/src/store/composer.ts', import.meta.url)
  const composer = transformContext.exports.transformRenderer(readFileSync(composerFile, 'utf8'), composerFile.pathname).code
  const store = shared({})
  const tab = () => {
    const listeners = new Map()
    const window = {
      localStorage: store.storage,
      addEventListener(name, callback) { listeners.set(name, [...(listeners.get(name) || []), callback]) },
      dispatchEvent(event) { for (const callback of listeners.get(event.type) || []) callback(event) }
    }
    const realm = vm.createContext({ exports: {}, window, navigator: { locks: store.locks }, CustomEvent: class {
      constructor(type, options) { this.type = type; this.detail = options.detail }
    } })
    vm.runInContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, realm)
    const persistence = realm.exports
    realm.exports = {}
    realm.require = name => {
      if (name === 'hermes:web-draft-persistence') return persistence
      if (name === 'nanostores') return { atom: initial => { let value = initial; return { get: () => value, set: next => { value = next } } } }
      if (name === '@/lib/draft-title') return { deriveDraftTitle: text => text }
      if (name === '@/lib/haptics') return { triggerHaptic() {} }
      throw Error(`Unexpected import ${name}`)
    }
    vm.runInContext(ts.transpileModule(composer, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, realm)
    return { window, composer: realm.exports }
  }
  // Neither tab receives the other's storage events before the flush requests.
  const first = tab(), second = tab()
  first.composer.onComposerDraftSyncRequest(() => first.composer.stashSessionDraft('a', 'first live composer', []))
  second.composer.onComposerDraftSyncRequest(() => second.composer.stashSessionDraft('b', 'second live composer', []))
  first.window.__HERMES_WEB_DRAFT_SNAPSHOT__()
  second.window.__HERMES_WEB_DRAFT_SNAPSHOT__()
  first.composer.reloadPersistedDrafts()
  assert.equal(first.composer.takeSessionDraft('a').text, 'first live composer')
  await Promise.all([first.window.__HERMES_WEB_FLUSH_DRAFTS__?.(), second.window.__HERMES_WEB_FLUSH_DRAFTS__?.()])
  assert.deepEqual(store.read(), { a: 'first live composer', b: 'second live composer' })
  first.composer.stashSessionDraft('a', 'pagehide draft', [])
  assert.equal(store.read().a, 'pagehide draft')
  assert.equal(store.read().b, 'second live composer')
  const attachment = { id: 'file', kind: 'file', label: 'unsent' }
  first.composer.stashSessionDraft('attachment-only', '', [attachment])
  first.composer.reloadPersistedDrafts()
  assert.equal(first.composer.takeSessionDraft('attachment-only').attachments.length, 1)
})

test('unavailable storage or shared locks refuse readiness without breaking construction', async () => {
  for (const [storage, locks] of [
    [{ getItem() { throw Error('Blocked storage') } }, shared().locks],
    [shared().storage, null]
  ]) {
    const draft = createDraftPersistence('drafts', 50, storage, locks)
    draft.write('a', 'keep this text')
    await assert.rejects(draft.flush())
    assert.equal(draft.pending('a'), true)
  }
})
