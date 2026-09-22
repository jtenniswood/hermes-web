import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import vm from 'node:vm'
import { test } from 'node:test'
import ts from 'typescript'

const root = path.resolve('apps/web-desktop')
function evaluate(source, dependencies, extra = {}) {
  const context = vm.createContext({ exports: {}, require: dependencies, ...extra })
  vm.runInContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, context)
  return context.exports
}
const pluginFile = path.join(root, 'src/upstream/browser-plugin.ts')
const { useBrowserPinWrites } = evaluate(readFileSync(pluginFile, 'utf8'), createRequire(pluginFile))
const transformed = useBrowserPinWrites(readFileSync('apps/desktop/src/store/session-pin-sync.ts', 'utf8'), root)
function harness({ rows = [{ id: 'chat', profile: 'research', pinned: false }], saved = [], active = 'research' } = {}) {
  const atom = initial => {
    let value = initial
    const listeners = new Set()
    return { get: () => value, set(next) { const previous = value; value = next; for (const listener of listeners) listener(next, previous) }, listen(listener) { listeners.add(listener); return () => listeners.delete(listener) } }
  }
  const pins = atom(saved), sessions = atom(rows), cron = atom([]), messaging = atom([]), profile = atom(active)
  const requests = [], errors = []
  const dependencies = {
    atom, $pinnedSessionIds: pins, $sessions: sessions, $cronSessions: cron, $messagingSessions: messaging, $activeGatewayProfile: profile,
    normalizeProfileKey: value => value || 'default',
    sessionMatchesStoredId: (row, id) => row.id === id || row.root_session_id === id,
    sessionPinId: row => row.root_session_id || row.id,
    pinSession: (id, index) => { if (!pins.get().includes(id)) { const next = [...pins.get()]; next.splice(index ?? next.length, 0, id); pins.set(next) } },
    unpinSession: id => { if (pins.get().includes(id)) pins.set(pins.get().filter(value => value !== id)) },
    onConnectionScopeChange: callback => { dependencies.rescope = callback },
    setSessionPinnedRemote: (id, pinned, profile) => new Promise((resolve, reject) => requests.push({ id, pinned, profile, resolve, reject })),
    reportActionFailure: message => errors.push(message)
  }
  const queue = evaluate(readFileSync(path.join(root, 'src/upstream/browser-pin-writes.ts'), 'utf8'), () => dependencies)
  const engine = evaluate(transformed, name => name.endsWith('browser-pin-writes') ? queue : dependencies, { window: { hermesDesktop: {} } })
  engine.watchSessionPins()
  return { ...dependencies, ...queue, pins, sessions, cron, messaging, profile, requests, errors }
}
const flush = () => new Promise(resolve => setImmediate(resolve))

test('pin ordering includes upstream reconciliation and fences stale pages during queued writes', async () => {
  const h = harness()
  h.pinSession('chat')
  await flush()
  h.unpinSession('chat')
  h.sessions.set([{ id: 'chat', profile: 'research', pinned: true }])
  assert.equal(h.requests.length, 1)
  assert.equal(h.pins.get().includes('chat'), false)
  h.requests[0].resolve({ ok: true })
  await flush()
  assert.equal(h.requests[1].pinned, false)
  h.requests[1].resolve({ ok: true })
  await flush()
  h.sessions.set([{ id: 'chat', profile: 'research', pinned: true }])
  assert.equal(h.pins.get().includes('chat'), false)
  assert.equal(h.hasBrowserPinWrite('chat'), false)
  assert.deepEqual(h.errors, [])
})

test('obsolete pin failures cannot alter the latest mirror or report a false failure', async () => {
  const h = harness()
  h.pinSession('chat'); h.unpinSession('chat'); h.pinSession('chat')
  await flush()
  h.requests[0].reject(new Error('Old pin rejected'))
  await flush()
  h.requests[1].resolve({ ok: true })
  await flush()
  h.requests[2].resolve({ ok: true })
  await flush()
  h.sessions.set([{ id: 'chat', profile: 'research', pinned: true }])
  assert.equal(h.pins.get().includes('chat'), true)
  assert.equal(h.requests.length, 3)
  assert.deepEqual(h.errors, [])
})

test('latest failed unpin restores the preceding confirmed pin without a retry loop', async () => {
  const h = harness()
  h.pinSession('chat'); h.unpinSession('chat')
  await flush()
  h.requests[0].resolve({ ok: true })
  await flush()
  h.requests[1].reject(new Error('Unpin rejected'))
  await flush()
  assert.equal(h.pins.get().includes('chat'), true)
  assert.equal(h.requests.length, 2)
  assert.deepEqual(h.errors, ['Could not change pinned status.'])
  h.sessions.set([{ id: 'chat', profile: 'research', pinned: false }])
  assert.equal(h.pins.get().includes('chat'), true)
  assert.equal(h.requests.length, 2)
})

test('negative pin acknowledgment rolls back and allows an explicit retry', async () => {
  const h = harness()
  h.pinSession('chat')
  await flush()
  h.requests[0].resolve({ ok: false })
  await flush()
  assert.equal(h.pins.get().includes('chat'), false)
  assert.equal(h.errors.length, 1)
  h.pinSession('chat')
  await flush()
  h.requests[1].resolve({ ok: true })
  await flush()
  assert.equal(h.pins.get().includes('chat'), true)
})

test('rescope discards queued writes and ignores late callbacks from the old gateway', async () => {
  const h = harness()
  h.pinSession('chat'); h.unpinSession('chat')
  await flush()
  h.rescope()
  h.pinSession('chat')
  await flush()
  assert.equal(h.requests.length, 2)
  h.requests[0].reject(new Error('Old gateway rejected'))
  await flush()
  assert.equal(h.requests.length, 2)
  assert.equal(h.pins.get().includes('chat'), true)
  assert.deepEqual(h.errors, [])
  h.requests[1].resolve({ ok: true })
  await flush()
})

test('saved lineage pins resolve the active profile and remain ordered at boot', async () => {
  const h = harness({ saved: ['root'], rows: [
    { id: 'foreign-tip', root_session_id: 'root', profile: 'writer', pinned: false },
    { id: 'tip', root_session_id: 'root', profile: 'research', pinned: false }
  ] })
  await flush()
  assert.equal(h.requests[0].id, 'root')
  assert.equal(h.requests[0].profile, 'research')
  h.requests[0].resolve({ ok: true })
  await flush()
  assert.deepEqual([...h.pins.get()], ['root'])
})

test('unresolved saved pins wait for messaging or cron rows before writing', async () => {
  const h = harness({ rows: [], saved: ['later'] })
  await flush()
  assert.equal(h.requests.length, 0)
  h.messaging.set([{ id: 'later', profile: 'writer', pinned: false }])
  await flush()
  assert.equal(h.requests[0].profile, 'writer')
  h.requests[0].resolve({ ok: true })
  await flush()
})

test('remote pins are adopted without echoing a write and unrelated writes run independently', async () => {
  const h = harness({ rows: [{ id: 'remote', profile: 'research', pinned: true }, { id: 'local', profile: 'writer', pinned: false }] })
  await flush()
  assert.equal(h.pins.get().includes('remote'), true)
  assert.equal(h.requests.length, 0)
  h.unpinSession('remote'); h.pinSession('local')
  await flush()
  assert.equal(h.requests.length, 2)
  for (const request of h.requests) request.resolve({ ok: true })
  await flush()
})

test('failed unpin restores its saved position among other pins', async () => {
  const h = harness({ saved: ['first', 'chat', 'last'], rows: ['first', 'chat', 'last'].map(id => ({ id, profile: 'research', pinned: true })) })
  await flush()
  for (const request of h.requests) request.resolve({ ok: true })
  await flush()
  h.unpinSession('chat')
  await flush()
  h.requests[3].reject(new Error('Unpin rejected'))
  await flush()
  assert.deepEqual([...h.pins.get()], ['first', 'chat', 'last'])
  assert.equal(h.requests.length, 4)
})
