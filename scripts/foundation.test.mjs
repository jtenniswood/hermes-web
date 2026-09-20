import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { rendererLock, prepareRenderer, verifyRenderer } from './renderer.mjs'
import { classifyDiagnostics } from './typecheck.mjs'
import { buildInfo } from './build-info.mjs'

test('renderer preparation verifies clean sources and never replaces a mismatch', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'hermes-renderer-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const upstream = path.join(root, 'upstream')
  for (const name of ['desktop', 'shared']) {
    mkdirSync(path.join(upstream, 'apps', name), { recursive: true })
    writeFileSync(path.join(upstream, 'apps', name, 'source.ts'), '// fixture\n')
  }
  const git = (...args) => execFileSync('git', ['-C', upstream, ...args], { encoding: 'utf8' }).trim()
  git('init', '-q'); git('add', '.')
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'Fixture')
  const rev = git('rev-parse', 'HEAD')
  const writeLock = rev => writeFileSync(path.join(root, 'flake.lock'), JSON.stringify({ nodes: { hermes: { locked: { owner: 'NousResearch', repo: 'hermes-agent', type: 'github', rev } } } }))
  writeLock(rev)
  mkdirSync(path.join(root, 'apps'))
  for (const name of ['desktop', 'shared']) symlinkSync(path.join(upstream, 'apps', name), path.join(root, 'apps', name))
  assert.equal(prepareRenderer(root), rev)
  writeLock('0'.repeat(40))
  assert.throws(() => prepareRenderer(root), /existing path was not changed/)
  assert.equal(readlinkSync(path.join(root, 'apps/desktop')), path.join(upstream, 'apps/desktop'))
  writeLock(rev)
  writeFileSync(path.join(upstream, 'apps/desktop/source.ts'), '// changed\n')
  assert.throws(() => verifyRenderer(root), /local changes/)
  writeLock('main')
  assert.throws(() => rendererLock(root), /exact/)
})

test('diagnostic baseline never hides wrapper errors or missing modules', () => {
  const upstream = { file: 'apps/desktop/src/example.ts', code: 2322, line: 1, column: 1, message: 'Known error' }
  const missing = { ...upstream, code: 2307 }
  const wrapper = { ...upstream, file: 'apps/web-desktop/vite.config.ts' }
  assert.deepEqual(classifyDiagnostics([upstream], [upstream]), { unexpected: [], stale: [] })
  assert.deepEqual(classifyDiagnostics([missing, wrapper], [missing, wrapper]).unexpected, [missing, wrapper])
  assert.deepEqual(classifyDiagnostics([], [upstream]).stale, [upstream])
  assert.equal(classifyDiagnostics([upstream, upstream], [upstream]).unexpected.length, 1)
})

test('build identity includes both revisions and the dependency lock', () => {
  const info = buildInfo({ HERMES_WRAPPER_REV: 'wrapper', HERMES_RELEASE_CHANNEL: 'test', SOURCE_DATE_EPOCH: '1' })
  assert.equal(info.wrapperRevision, 'wrapper')
  assert.equal(info.rendererRevision, rendererLock().rev)
  assert.match(info.dependencyLockHash, /^[a-f0-9]{64}$/)
  assert.equal(info.builtAt, '1970-01-01T00:00:01.000Z')
})
