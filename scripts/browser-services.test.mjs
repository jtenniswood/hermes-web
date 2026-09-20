import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

function load(name, globals) {
  const source = readFileSync(new URL(`../apps/web-desktop/src/platform/${name}.ts`, import.meta.url), 'utf8')
  const context = vm.createContext({ exports: {}, Blob, ...globals })
  vm.runInContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context)
  return context.exports
}

test('browser attachments preserve bytes and reject unknown handles', async () => {
  class Reader {
    async readAsDataURL(blob) {
      this.result = `data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}`
      this.onload()
    }
  }
  const files = load('files', { FileReader: Reader, require: () => ({ servingBase: () => 'https://web.example.test' }) })
  const handle = files.registerWebFile(new Blob(['pasted text'], { type: 'text/plain' }), '../note.txt')
  assert.match(handle, /^web-file:\/\/\d+\/_note\.txt$/)
  assert.equal(await files.webFileAsDataUrl(handle), 'data:text/plain;base64,cGFzdGVkIHRleHQ=')
  await assert.rejects(files.webFileAsDataUrl('web-file://unknown'), /unavailable/)
  assert.equal(files.isUnderPluginRoot('https://web.example.test/pluginsSecret'), false)
})

test('API errors keep the shell in place and websocket tickets are minted per call', async () => {
  let calls = []
  let response = { ok: true, json: async () => ({ ticket: `ticket-${calls.length}` }) }
  const client = load('connection', {
    URL, AbortSignal,
    window: { location: { href: 'https://web.example.test/' } },
    localStorage: { getItem: () => null },
    fetch: async (...args) => { calls.push(args); return response },
    require: () => ({
      getActiveGateway: () => ({ url: '', authMode: 'oauth' }),
      normalizeBase: () => 'https://web.example.test',
      activeUpstreamOrigin: () => null,
      withGatewayRoute: url => url
    })
  })
  assert.equal(await client.mintWsTicket(null), 'ticket-1')
  assert.equal(await client.mintWsTicket(null), 'ticket-2')
  response = { ok: false, status: 401, text: async () => 'Sign in again' }
  await assert.rejects(client.apiFetch({ path: '/api/session' }), /401: Sign in again/)
  response = { ok: true, text: async () => '<html>wrong route</html>' }
  await assert.rejects(client.apiFetch({ path: '/api/session' }), /Expected JSON/)
})
