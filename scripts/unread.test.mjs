import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { test } from 'node:test'
import ts from 'typescript'

function harness(rows = [{ id: 'chat', profile: 'research', unread: false }]) {
  const atom = initial => {
    let value = initial
    const listeners = new Set()
    return { get: () => value, set(next) { const previous = value; value = next; for (const listener of listeners) listener(next, previous) }, listen(listener) { listeners.add(listener); return () => listeners.delete(listener) } }
  }
  const sessions = atom(rows), requests = []
  const dependencies = {
    atom, $sessions: sessions, setSessions: update => sessions.set(update(sessions.get())),
    setSessionUnreadRemote: (id, unread, profile) => new Promise((resolve, reject) => requests.push({ id, unread, profile, resolve, reject }))
  }
  const context = vm.createContext({ exports: {}, require: () => dependencies })
  vm.runInContext(ts.transpileModule(readFileSync('apps/web-desktop/src/upstream/browser-unread.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context)
  context.exports.watchUnreadWriteGuard()
  return { ...context.exports, sessions, requests }
}
const flush = () => new Promise(resolve => setImmediate(resolve))

test('unread writes reach the server in intent order and obsolete failures stay quiet', async () => {
  const h = harness()
  const first = h.markSessionUnread('chat', true)
  const second = h.markSessionUnread('chat', false)
  const third = h.markSessionUnread('chat', true)
  await flush()
  assert.equal(h.requests.length, 1)
  assert.equal(h.sessions.get()[0].unread, true)
  assert.equal(h.$unreadWriteGuard.get().get('chat').value, true)
  h.requests[0].reject(new Error('Older failure'))
  await first
  await flush()
  assert.equal(h.requests.length, 2)
  assert.equal(h.requests[1].unread, false)
  h.requests[1].resolve({ ok: true })
  await second
  await flush()
  assert.equal(h.requests.length, 3)
  assert.equal(h.requests[2].unread, true)
  assert.ok(h.requests.every(request => request.profile === 'research'))
  h.requests[2].resolve({ ok: true })
  await third
  assert.equal(h.sessions.get()[0].unread, true)
  assert.equal(h.pendingUnreadValue('chat', 'research'), undefined)
  h.sessions.set([...h.sessions.get()])
  assert.equal(h.$unreadWriteGuard.get().has('chat'), false)
})

test('a failed latest unread write restores confirmed state after earlier failures', async () => {
  const h = harness()
  const first = h.markSessionUnread('chat', true)
  const last = h.markSessionUnread('chat', false)
  const failure = assert.rejects(last, /Latest failure/)
  await flush()
  h.requests[0].reject(new Error('Older failure'))
  await first
  await flush()
  h.requests[1].reject(new Error('Latest failure'))
  await failure
  assert.equal(h.sessions.get()[0].unread, false)
  assert.equal(h.$unreadWriteGuard.get().has('chat'), false)
})

test('unread writes require an affirmative gateway acknowledgment', async () => {
  const h = harness()
  const result = h.markSessionUnread('chat', true)
  const failure = assert.rejects(result, /did not confirm/)
  await flush()
  h.requests[0].resolve({ ok: false })
  await failure
  assert.equal(h.sessions.get()[0].unread, false)
})

test('automatic read-on-open shares the manual unread queue', async () => {
  const h = harness()
  const first = h.markSessionUnread('chat', true)
  const opened = h.clearUnreadOnOpen('chat')
  await flush()
  assert.equal(h.requests.length, 1)
  h.requests[0].resolve({ ok: true })
  await first
  await flush()
  assert.equal(h.requests[1].unread, false)
  h.requests[1].resolve({ ok: true })
  await opened
  assert.equal(h.sessions.get()[0].unread, false)
})

test('pending unread intent survives stale list refreshes until its acknowledgment', async () => {
  const h = harness()
  const writing = h.markSessionUnread('chat', true)
  await flush()
  h.sessions.set([{ id: 'chat', profile: 'research', unread: false }])
  assert.equal(h.pendingUnreadValue('chat', 'research'), true)
  assert.equal(h.$unreadWriteGuard.get().get('chat').value, true)
  h.requests[0].resolve({ ok: true })
  await writing
  assert.equal(h.sessions.get()[0].unread, true)
})

test('unread queues do not block other conversations or change a same-ID foreign profile', async () => {
  const h = harness([{ id: 'chat', profile: 'research', unread: false }, { id: 'chat', profile: 'writer', unread: false }, { id: 'other', profile: 'writer', unread: false }])
  const first = h.markSessionUnread('chat', true)
  const second = h.markSessionUnread('other', true)
  await flush()
  assert.equal(h.requests.length, 2)
  assert.equal(h.sessions.get()[1].unread, false)
  h.requests[1].resolve({ ok: true })
  await second
  assert.equal(h.pendingUnreadValue('chat', 'research'), true)
  h.requests[0].resolve({ ok: true })
  await first
})
