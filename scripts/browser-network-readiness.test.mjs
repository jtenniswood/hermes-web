import { test } from 'node:test'
import assert from 'node:assert/strict'
import { waitForBrowserNetwork } from '../tests/browser/network-readiness.mjs'

function browserFixture(responses) {
  const visits = [], contexts = []
  let closed = 0
  return {
    visits, contexts, get closed() { return closed },
    async newContext(options) {
      contexts.push(options)
      return {
        async newPage() { return { async goto(url) {
          visits.push(url)
          const response = responses.length > 1 ? responses.shift() : responses[0]
          if (response instanceof Error) throw response
          return response
        } } },
        async close() { closed++ }
      }
    }
  }
}
const identity = { status: () => 200, json: async () => ({ rendererRevision: 'a'.repeat(40) }) }
const options = { quietMs: 5, intervalMs: 1, timeoutMs: 1000 }

test('network preparation recovers interface notifications without loading or warming the app', async () => {
  const browser = browserFixture([identity, new Error('page.goto: net::ERR_NETWORK_CHANGED'), identity])
  const result = await waitForBrowserNetwork(browser, 'http://127.0.0.1:1234', options)
  assert.equal(result.networkChanges, 1)
  assert.ok(result.probes >= 3)
  assert.ok(browser.visits.every(url => url === 'http://127.0.0.1:1234/build-info.json'))
  assert.deepEqual(browser.contexts, [{ serviceWorkers: 'block' }])
  assert.equal(browser.closed, 1)
})

test('network preparation fails on application identity or unrelated connection failures', async () => {
  for (const [response, message] of [
    [{ status: () => 503 }, /HTTP 503/],
    [{ status: () => 200, json: async () => ({}) }, /build metadata/],
    [new Error('net::ERR_CONNECTION_REFUSED'), /ERR_CONNECTION_REFUSED/]
  ]) {
    const browser = browserFixture([response])
    await assert.rejects(waitForBrowserNetwork(browser, 'http://127.0.0.1:1234', options), message)
    assert.equal(browser.visits.length, 1)
    assert.equal(browser.closed, 1)
  }
})

test('continuing interface churn fails setup within its bounded readiness window', async () => {
  const browser = browserFixture([new Error('net::ERR_NETWORK_CHANGED')])
  await assert.rejects(waitForBrowserNetwork(browser, 'http://127.0.0.1:1234', { ...options, timeoutMs: 10 }), /did not settle/)
  assert.equal(browser.closed, 1)
})
