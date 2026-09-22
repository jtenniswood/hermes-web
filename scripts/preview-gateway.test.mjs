import assert from 'node:assert/strict'
import { once } from 'node:events'
import { test } from 'node:test'
import WebSocket from 'ws'
import { createPreviewGateway } from './preview/gateway.mjs'

async function fixture(t) {
  const gateway = createPreviewGateway({ strict: true })
  await new Promise(resolve => gateway.server.listen(0, '127.0.0.1', resolve))
  t.after(() => gateway.close())
  const origin = `http://127.0.0.1:${gateway.server.address().port}`
  const socket = new WebSocket(origin.replace('http:', 'ws:') + '/api/ws?profile=research')
  await once(socket, 'open')
  let id = 0
  const request = (method, params = {}) => {
    const requestId = ++id
    return new Promise(resolve => {
      const receive = data => {
        const reply = JSON.parse(String(data))
        if (reply.id === requestId) { socket.off('message', receive); resolve(reply) }
      }
      socket.on('message', receive)
      socket.send(JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }))
    })
  }
  return { ...gateway, origin, socket, request }
}

test('RPC holds allow later selections to complete first without timing guesses', async t => {
  const gateway = await fixture(t)
  const held = gateway.controls.hold(call => call.method === 'session.resume' && call.params.session_id === 'preview-research')
  let finished = false
  const first = gateway.request('session.resume', { session_id: 'preview-research' }).then(reply => { finished = true; return reply })
  await held.entered
  const second = await gateway.request('session.resume', { session_id: 'preview-writer' })
  assert.equal(second.result.stored_session_id, 'preview-writer')
  assert.equal(finished, false)
  held.release()
  assert.equal((await first).result.stored_session_id, 'preview-research')
  gateway.controls.assertExpected()
})

test('rejected REST mutations leave sessions intact and consume the fault once', async t => {
  const gateway = await fixture(t)
  const path = '/api/sessions/preview-week'
  gateway.controls.reject({ transport: 'http', method: 'DELETE', path }, 'Deletion rejected')
  const failure = await fetch(gateway.origin + path, { method: 'DELETE' })
  assert.equal(failure.status, 503)
  assert.equal((await failure.json()).error, 'Deletion rejected')
  assert.ok(gateway.sessions.has('preview-week'))
  assert.equal((await fetch(gateway.origin + path, { method: 'DELETE' })).status, 200)
  assert.equal(gateway.sessions.has('preview-week'), false)
})

test('approval RPC has authoritative state and errors retain the confirmed value', async t => {
  const gateway = await fixture(t)
  const params = { key: 'approvals.mode' }
  assert.equal((await gateway.request('config.get', params)).result.value, 'smart')
  assert.equal((await gateway.request('config.set', { ...params, value: 'manual' })).result.value, 'manual')
  gateway.controls.reject({ transport: 'rpc', method: 'config.set' }, 'Approval rejected')
  assert.equal((await gateway.request('config.set', { ...params, value: 'off' })).error.message, 'Approval rejected')
  assert.equal((await gateway.request('config.get', params)).result.value, 'manual')
})

test('strict mode reports unknown RPC and REST instead of inventing success', async t => {
  const gateway = await fixture(t)
  assert.equal((await gateway.request('unknown.list')).error.code, -32601)
  assert.equal((await fetch(gateway.origin + '/api/unknown')).status, 501)
  assert.equal(gateway.controls.unexpected.length, 2)
  assert.throws(() => gateway.controls.assertExpected(), /Unexpected gateway operations/)
})

test('disconnect closes active sockets without destroying stored conversations', async t => {
  const gateway = await fixture(t)
  const closed = once(gateway.socket, 'close')
  gateway.disconnect()
  await closed
  assert.equal(gateway.sessions.get('preview-week').title, 'Plan a calmer working week')
})
