import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { inspectContracts, reportMarkdown } from './renderer-compatibility-report.mjs'

const hash = source => createHash('sha256').update(source).digest('hex')
test('preflight reports all changed and missing contracts without accepting new fingerprints', () => {
  const contracts = ['stable.ts', 'changed.ts', 'missing.ts'].map(module => ({ module, sourceHash: hash('reviewed'), reason: 'Preserve selection', manifest: 'contracts.json' }))
  const snapshot = structuredClone(contracts)
  const results = inspectContracts(contracts, module => {
    if (module === 'missing.ts') throw Object.assign(new Error('Missing'), { code: 'ENOENT' })
    return module === 'stable.ts' ? 'reviewed' : 'upstream edit'
  })
  assert.deepEqual(results.map(row => row.status), ['unchanged', 'changed', 'missing'])
  assert.deepEqual(contracts, snapshot)
  assert.equal(results[1].sourceHash, hash('reviewed'))
  assert.equal(results[1].actualHash, hash('upstream edit'))
  const markdown = reportMarkdown({ wrapper: 'wrapper', renderer: 'a'.repeat(40), results })
  assert.match(markdown, /2 require review/)
  assert.match(markdown, /changed.ts/)
  assert.match(markdown, /missing.ts/)
  assert.match(markdown, /must still pass/)
})

test('invalid contracts and unreadable files fail rather than produce passing evidence', () => {
  for (const module of ['../secret', '/absolute', 'file|table']) {
    assert.throws(() => inspectContracts([{ module, sourceHash: hash('') }], () => ''), /Invalid/)
  }
  assert.throws(() => inspectContracts([{ module: 'valid.ts', sourceHash: 'invalid' }], () => ''), /Invalid/)
  assert.throws(() => inspectContracts([{ module: 'valid.ts', sourceHash: hash('') }], () => { throw Object.assign(new Error('Denied'), { code: 'EACCES' }) }), /Denied/)
})
