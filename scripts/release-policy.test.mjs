import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { assertRendererOnlyChange, assertCandidateEvidence, promotionTags } from './release-policy.mjs'
const before = JSON.parse(readFileSync(new URL('../flake.lock', import.meta.url)))
const revision = 'a'.repeat(40), renderer = 'b'.repeat(40)
function updated() { const after = structuredClone(before); after.nodes.hermes.locked.rev = revision; return after }
test('updater allows only the three renderer lock metadata fields', () => {
  assert.doesNotThrow(() => assertRendererOnlyChange(before, updated()))
  assert.throws(() => assertRendererOnlyChange(before, updated(), ['flake.lock', 'pnpm-lock.yaml']))
  assert.throws(() => assertRendererOnlyChange(before, before))
  for (const mutate of [x => { x.nodes.hermes.original.repo = 'fork' }, x => { x.nodes.hermes.locked.owner = 'other' }, x => { x.nodes.nixpkgs.locked.rev = revision }]) {
    const after = updated(); mutate(after); assert.throws(() => assertRendererOnlyChange(before, after))
  }
})
test('tested amd64 evidence is eligible for promotion', () => {
  const evidence = [{ arch: 'amd64', wrapper: revision, renderer, digest: 'sha256:' + 'c'.repeat(64), tested: true }]
  assert.doesNotThrow(() => assertCandidateEvidence(evidence, revision, renderer))
  for (const invalid of [[], [...evidence, { ...evidence[0], arch: 'arm64' }], evidence.map(item => ({ ...item, tested: false })), evidence.map(item => ({ ...item, renderer: revision }))]) assert.throws(() => assertCandidateEvidence(invalid, revision, renderer))
})
test('failing and stale candidates leave stable tags unchanged', () => {
  let stable = 'previous-tested-digest'
  function promote(evidence, currentMain) {
    assertCandidateEvidence(evidence, revision, renderer)
    promotionTags({ sourceRevision: revision, currentMain, ref: 'refs/heads/main' })
    stable = 'new-tested-digest'
  }
  const passing = [{ arch: 'amd64', wrapper: revision, renderer, digest: 'sha256:' + 'd'.repeat(64), tested: true }]
  assert.throws(() => promote(passing.map(item => ({ ...item, tested: false })), revision))
  assert.equal(stable, 'previous-tested-digest')
  assert.throws(() => promote(passing, 'e'.repeat(40)))
  assert.equal(stable, 'previous-tested-digest')
  promote(passing, revision); assert.equal(stable, 'new-tested-digest')
  assert.deepEqual(promotionTags({ sourceRevision: revision, currentMain: revision, ref: 'refs/heads/main', nightly: true }), ['main', 'latest', 'nightly'])
  assert.deepEqual(promotionTags({ sourceRevision: revision, currentMain: revision, ref: 'refs/tags/v1.2.3' }), ['1.2.3', 'latest'])
})
