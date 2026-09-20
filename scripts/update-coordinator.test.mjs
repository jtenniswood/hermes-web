import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { test } from 'node:test'

const source = readFileSync(new URL('../apps/web-desktop/public/update-coordinator-sw.js', import.meta.url), 'utf8')
async function run(replies, options = {}) {
  let activate = 0, listener, work, enumerations = 0
  const messages = []
  const clients = replies.map((reply, index) => ({ id: String(index), url: 'https://app.test/', postMessage(message, ports) {
    messages.push(message.type)
    if (ports && reply !== null) ports[0].respond(message.type === 'HERMES_VERIFY_UPDATE' ? { ready: options.verify !== false } : reply)
  } }))
  class Channel {
    port1 = { close() {}, onmessage: undefined }
    port2 = { respond: data => queueMicrotask(() => this.port1.onmessage?.({ data })) }
  }
  const self = {
    registration: { scope: 'https://app.test/' },
    clients: { matchAll: async () => {
      enumerations++
      return options.newTab && enumerations > 1 ? [...clients, { id: 'new', url: 'https://app.test/', postMessage() {} }] : clients
    } },
    skipWaiting: async () => { activate++ },
    addEventListener: (_, handler) => { listener = handler }
  }
  vm.runInNewContext(source, { self, crypto: { randomUUID: () => 'transaction' }, MessageChannel: Channel, setTimeout: fn => setTimeout(fn, 10), clearTimeout })
  listener({ data: { type: 'HERMES_PREPARE_UPDATE' }, source: clients[0], waitUntil: promise => { work = promise } })
  await work
  return { activate, messages }
}
test('an update activates only after every tab flushes and verifies', async () => {
  const result = await run([{ ready: true, texts: { a: 'one' } }, { ready: true, texts: { b: 'two' } }])
  assert.equal(result.activate, 1)
  assert.equal(result.messages.filter(type => type === 'HERMES_VERIFY_UPDATE').length, 2)
})
test('busy, older, conflicting, newly opened and failed-verification tabs prevent activation', async () => {
  for (const [replies, options] of [
    [[{ ready: true }, { ready: false }]],
    [[{ ready: true }, null]],
    [[{ ready: true, texts: { a: 'one' } }, { ready: true, texts: { a: 'two' } }]],
    [[{ ready: true }], { newTab: true }],
    [[{ ready: true }], { verify: false }]
  ]) {
    const result = await run(replies, options)
    assert.equal(result.activate, 0)
    assert.ok(result.messages.includes('HERMES_ABORT_UPDATE'))
  }
})
