import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

function load(name, globals = {}) {
  const source = readFileSync(new URL(`../apps/web-desktop/src/platform/${name}.ts`, import.meta.url), 'utf8')
  const context = vm.createContext({ exports: {}, require: () => ({}), ...globals })
  vm.runInContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context)
  return context.exports
}
const { createConnectionState } = load('connection-state')
const origin = 'https://gateway.test'
function storage(initial = {}) {
  const data = new Map(Object.entries(initial))
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }
}
const legacy = (gateways, activeId = 'a') => ({ 'hermes-ui.gateways': JSON.stringify({ activeId, gateways }), 'hermes-web.session-token': 'global-old-token' })
const state = (store, id = 'configured') => createConnectionState(store, id, url => url === origin)

test('migrates the matching active credential without deleting other records', () => {
  const store = storage(legacy([{ id: 'a', url: origin, authMode: 'token', token: 'scoped' }, { id: 'b', url: 'https://other.test', token: 'other' }]))
  assert.equal(state(store).load().token, 'scoped')
  assert.equal(JSON.parse(store.getItem('hermes-ui.gateways')).gateways.length, 2)
  assert.equal(store.getItem('hermes-web.session-token'), 'global-old-token')
  state(store).update({ token: 'new-scoped', authMode: 'token' })
  assert.equal(state(store).load().token, 'new-scoped')
  assert.equal(store.getItem('hermes-web.session-token'), 'global-old-token')
  state(store).update({ authMode: 'oauth', token: '' })
  assert.equal(state(store).load().token, '')
})

test('global legacy tokens require one unambiguous matching connection', () => {
  const a = { id: 'a', url: origin, authMode: 'token' }
  assert.equal(state(storage(legacy([a]))).load().token, 'global-old-token')
  for (const connections of [[a, { id: 'b' }], [{ ...a, url: '' }], [{ ...a, url: 'https://different.test' }], [{ ...a, url: '/' }]]) {
    assert.equal(state(storage(legacy(connections))).load().token, '')
  }
  assert.equal(state(storage({ 'hermes-web.session-token': 'alone' })).load().token, '')
})

test('single legacy connection migrates; malformed records remain untouched', () => {
  const store = storage({ 'hermes-web.connection': JSON.stringify({ remoteUrl: origin, remoteAuthMode: 'token', remoteToken: 'single' }) })
  assert.equal(state(store).load().token, 'single')
  for (const value of ['{broken', 'null', '42', '[]']) {
    const invalid = storage({ 'hermes-ui.gateways': value })
    assert.equal(state(invalid).load().token, '')
    assert.equal(invalid.getItem('hermes-ui.gateways'), value)
  }
})

test('a changed backend identity cannot reuse a gateway-bound token', () => {
  const store = storage()
  state(store, 'first').update({ authMode: 'token', token: 'private-first' })
  assert.equal(state(store, 'second').load().token, '')
  assert.equal(state(store, 'first').load().token, 'private-first')
})

test('blocked, full, or unverifiable storage retains a usable in-memory session', () => {
  for (const store of [
    { getItem() { throw Error('blocked') }, setItem() { throw Error('blocked') } },
    { getItem: () => null, setItem() { throw Error('quota') } },
    { getItem: () => null, setItem() {} }
  ]) {
    const connection = state(store)
    connection.update({ authMode: 'token', token: 'memory-only' })
    assert.equal(connection.load().token, 'memory-only')
    assert.equal(connection.load().migration.complete, false)
    assert.equal(connection.persisted(), false)
  }
})

test('reload readiness flushes and verifies text and blocks turns, uploads, files and recordings', async () => {
  let draft = { storageKey: 'drafts', texts: { session: 'hello' }, attachments: 0, blocked: false }
  let persisted = JSON.stringify(draft.texts)
  const track = { readyState: 'live' }
  const navigator = { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [track] }) } }
  const safety = load('reload-safety', { navigator, window: { __HERMES_WEB_DRAFT_SNAPSHOT__: () => draft, localStorage: { getItem: () => persisted } } })
  assert.equal(safety.reloadReadiness().ready, false)
  safety.setActiveWork({ count: 0 }); assert.equal(safety.reloadReadiness().ready, true)
  safety.setActiveWork({ count: 1 }); assert.match(safety.reloadReadiness().reason, /response/)
  safety.setActiveWork({ count: 0 })
  const finish = safety.beginOperation(); assert.equal(safety.reloadReadiness().ready, false); finish(); finish()
  draft.attachments = 1; assert.match(safety.reloadReadiness().reason, /attachments/); draft.attachments = 0
  draft.blocked = true; assert.equal(safety.reloadReadiness().ready, false); draft.blocked = false
  persisted = '{}'; assert.match(safety.reloadReadiness().reason, /could not be saved/); persisted = JSON.stringify(draft.texts)
  safety.trackMediaRequests(); await navigator.mediaDevices.getUserMedia({ audio: true })
  assert.match(safety.reloadReadiness().reason, /recording/)
  track.readyState = 'ended'; assert.equal(safety.reloadReadiness().ready, true)
})
