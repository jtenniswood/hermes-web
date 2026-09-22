import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { test } from 'node:test'

const source = readFileSync(new URL('../apps/web-desktop/public/update-coordinator-sw.js', import.meta.url), 'utf8')
async function run(replies, options = {}) {
  let activate = 0, listener, work, enumerations = 0, transactions = 0
  const messages = [], requests = []
  const clients = replies.map((reply, index) => ({ id: String(index), url: 'https://app.test/', postMessage(message, ports) {
    messages.push(message.type)
    requests.push({ client: index, ...message })
    if (ports && reply !== null) ports[0].respond(message.type === 'HERMES_VERIFY_UPDATE'
      ? { ready: typeof options.verify === 'function' ? options.verify(transactions, index) : options.verify !== false }
      : typeof reply === 'function' ? reply(transactions) : reply)
  } }))
  class Channel {
    port1 = { close() {}, onmessage: undefined }
    port2 = { respond: data => queueMicrotask(() => this.port1.onmessage?.({ data })) }
  }
  const self = {
    registration: { scope: 'https://app.test/' },
    clients: { matchAll: async () => {
      enumerations++
      return (options.newTab && enumerations > 1) || (options.newTabAfterAbort && messages.includes('HERMES_ABORT_UPDATE')) ||
        (options.newTabDuringVerification && messages.includes('HERMES_VERIFY_UPDATE'))
        ? [...clients, { id: 'new', url: 'https://app.test/', postMessage() {} }] : clients
    } },
    skipWaiting: async () => { activate++ },
    addEventListener: (_, handler) => { listener = handler }
  }
  vm.runInNewContext(source, { self, crypto: { randomUUID: () => `transaction-${++transactions}` }, MessageChannel: Channel, setTimeout: fn => setTimeout(fn, 10), clearTimeout })
  listener({ data: { type: 'HERMES_PREPARE_UPDATE' }, source: clients[0], waitUntil: promise => { work = promise } })
  await work
  return { activate, messages, requests, transactions }
}
test('an update activates only after every tab flushes and verifies', async () => {
  const result = await run([{ ready: true, texts: { a: 'one' } }, { ready: true, texts: { b: 'two' } }])
  assert.equal(result.activate, 1)
  assert.equal(result.messages.filter(type => type === 'HERMES_VERIFY_UPDATE').length, 2)
})

test('a verification refusal gets one fresh all-tab handshake after aborting the first', async () => {
  const result = await run([{ ready: true, texts: { a: 'one' } }, { ready: true, texts: { b: 'two' } }], {
    verify: attempt => attempt > 1
  })
  assert.equal(result.activate, 1)
  assert.equal(result.transactions, 2)
  for (const client of [0, 1]) {
    assert.deepEqual(result.requests.filter(request => request.client === client).map(({ type, transaction }) => [type, transaction]), [
      ['HERMES_FLUSH_UPDATE', 'transaction-1'], ['HERMES_VERIFY_UPDATE', 'transaction-1'],
      ['HERMES_ABORT_UPDATE', 'transaction-1'], ['HERMES_FLUSH_UPDATE', 'transaction-2'],
      ['HERMES_VERIFY_UPDATE', 'transaction-2']
    ])
  }
})

test('a retry cannot forget or change a draft from the first attempt', async () => {
  for (const texts of [{}, { a: 'changed' }, { b: 'two' }]) {
    const result = await run([attempt => ({ ready: true, texts: attempt === 1 ? { a: 'one' } : texts })], {
      verify: attempt => attempt > 1
    })
    assert.equal(result.activate, 0)
    assert.equal(result.transactions, 2)
    assert.equal(result.requests.filter(request => request.type === 'HERMES_VERIFY_UPDATE').length, 1)
    assert.equal(result.requests.at(-1).type, 'HERMES_ABORT_UPDATE')
  }
})

test('a retry permits an additional draft when every original draft is still present', async () => {
  const result = await run([attempt => ({ ready: true, texts: attempt === 1 ? { a: 'one' } : { a: 'one', b: 'two' } })], {
    verify: attempt => attempt > 1
  })
  assert.equal(result.activate, 1)
  assert.equal(result.transactions, 2)
})

test('a tab opened during successful verification prevents activation', async () => {
  const result = await run([{ ready: true, texts: { a: 'one' } }], { newTabDuringVerification: true })
  assert.equal(result.activate, 0)
  assert.equal(result.transactions, 1)
  assert.ok(result.messages.includes('HERMES_ABORT_UPDATE'))
})

test('a retry still refuses busy, conflicting or newly opened tabs and repeated verification failures', async () => {
  for (const [replies, options] of [
    [[attempt => ({ ready: attempt === 1, texts: { a: 'one' } })], { verify: attempt => attempt > 1 }],
    [[{ ready: true, texts: { a: 'one' } }, attempt => ({ ready: true, texts: attempt === 1 ? { b: 'two' } : { a: 'different', b: 'two' } })], { verify: attempt => attempt > 1 }],
    [[{ ready: true, texts: { a: 'one' } }], { verify: attempt => attempt > 1, newTabAfterAbort: true }],
    [[{ ready: true, texts: { a: 'one' } }], { verify: false }]
  ]) {
    const result = await run(replies, options)
    assert.equal(result.activate, 0)
    assert.equal(result.transactions, 2)
    assert.ok(result.messages.includes('HERMES_ABORT_UPDATE'))
  }
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
    assert.equal(result.transactions, options?.verify === false ? 2 : 1)
  }
})
