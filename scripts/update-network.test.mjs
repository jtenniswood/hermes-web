import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { test } from 'node:test'
import ts from 'typescript'

const source = readFileSync(new URL('../apps/web-desktop/src/pwa/update-network.ts', import.meta.url), 'utf8')
function network(fetch) {
  const window = { fetch }
  const context = vm.createContext({ exports: {}, window, setTimeout, Request })
  vm.runInContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context)
  return { window, barrier: context.exports.installUpdateNetworkBarrier() }
}

test('update preparation drains existing fetches and holds new requests until resumed', async () => {
  const calls = []
  let finish
  const response = { ok: true }
  const { window, barrier } = network((...args) => {
    calls.push(args)
    return calls.length === 1 ? new Promise(resolve => { finish = resolve }) : Promise.resolve(response)
  })
  const running = window.fetch('/running')
  const prepared = barrier.pause()
  const options = { method: 'POST', body: 'original body', headers: { 'x-test': 'unchanged' } }
  const queued = window.fetch('/queued', options)
  assert.equal(calls.length, 1)
  finish(response)
  assert.equal(await running, response)
  assert.equal(await prepared, true)
  assert.equal(calls.length, 1)
  barrier.resume()
  assert.equal(await queued, response)
  assert.deepEqual(calls[1], ['/queued', options])
})

test('aborting preparation releases queued requests and invalidates its pending readiness', async () => {
  let calls = 0, finish
  const { window, barrier } = network(() => ++calls === 1 ? new Promise(resolve => { finish = resolve }) : Promise.resolve('queued response'))
  const running = window.fetch('/running')
  const prepared = barrier.pause()
  const queued = window.fetch('/queued')
  barrier.resume()
  assert.equal(await queued, 'queued response')
  finish('original response')
  assert.equal(await running, 'original response')
  assert.equal(await prepared, false)
})

test('a request that remains pending refuses preparation without cancelling that request', async () => {
  let finish
  const { window, barrier } = network(() => new Promise(resolve => { finish = resolve }))
  const running = window.fetch('/running')
  assert.equal(await barrier.pause(), false)
  barrier.resume()
  finish('completed normally')
  assert.equal(await running, 'completed normally')
})

test('a completed preparation cannot be reused after abort and a new preparation', async () => {
  const { barrier } = network(async () => 'response')
  const old = barrier.pause()
  barrier.resume()
  const current = barrier.pause()
  assert.equal(await old, false)
  assert.equal(await current, true)
  barrier.resume()
})

test('aborting a queued request rejects immediately without sending it after resume', async () => {
  for (const requestObject of [false, true]) {
    let calls = 0
    const { window, barrier } = network(async () => { calls++; return 'response' })
    assert.equal(await barrier.pause(), true)
    const controller = new AbortController()
    const request = requestObject ? new Request('https://example.test/queued', { signal: controller.signal }) : '/queued'
    const queued = window.fetch(request, requestObject ? undefined : { signal: controller.signal })
    const reason = new Error('request cancelled')
    controller.abort(reason)
    await assert.rejects(queued, error => error === reason)
    barrier.resume()
    await Promise.resolve()
    assert.equal(calls, 0)
  }
})

test('failed fetches drain normally and an explicit null signal overrides a Request signal', async () => {
  const { window, barrier } = network(async () => { throw new Error('network failed') })
  await assert.rejects(window.fetch('/failed'), /network failed/)
  assert.equal(await barrier.pause(), true)
  const controller = new AbortController()
  controller.abort(new Error('overridden signal'))
  const queued = window.fetch(new Request('https://example.test/queued', { signal: controller.signal }), { signal: null })
  barrier.resume()
  await assert.rejects(queued, /network failed/)
})
