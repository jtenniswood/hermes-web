import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import * as policy from './release-policy.mjs'

const wrapper = 'a'.repeat(40), renderer = 'b'.repeat(40), digest = 'sha256:' + 'c'.repeat(64)
const source = ts.transpileModule(readFileSync(new URL('./promote-image.mjs', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText

function publish({ enabled = false, current = wrapper, mismatchedTag = false, missingCandidate = false } = {}) {
  const commands = [], records = []
  const evidence = [{ arch: 'amd64', wrapper, renderer, digest: 'sha256:' + 'd'.repeat(64), tested: true }]
  const stopped = Symbol('exit')
  let error
  try {
    vm.runInNewContext(source, {
      exports: {}, console: { log() {} },
      process: { env: { GITHUB_REPOSITORY: 'example/hermes-web', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '2', GITHUB_REF: 'refs/heads/main', GITHUB_STEP_SUMMARY: '/tmp/summary', HERMES_PROMOTION_ENABLED: String(enabled) }, exit: () => { throw stopped } },
      require(name) {
        if (name === './release-policy.mjs') return policy
        if (name === './renderer.mjs') return { rendererLock: () => ({ rev: renderer }) }
        if (name === 'node:fs') return {
          readdirSync: () => (missingCandidate ? [] : ['candidate-amd64.json']),
          readFileSync: file => JSON.stringify(evidence.find(item => file.includes(item.arch))),
          writeFileSync: (file, data) => { assert.equal(file, 'release-evidence.json'); records.push(JSON.parse(data)) },
          appendFileSync() {}
        }
        if (name === 'node:child_process') return { execFileSync(command, args) {
          commands.push([command, ...args])
          if (command === 'git' && args[0] === 'rev-parse') return wrapper
          if (command === 'git' && args[0] === 'ls-remote') return current + '\trefs/heads/main'
          if (command === 'docker' && args[2] === 'create') return ''
          if (command === 'docker' && args[2] === 'inspect') return mismatchedTag && args[3].endsWith(':latest') ? 'sha256:' + 'f'.repeat(64) : digest
          throw new Error('Unexpected command: ' + [command, ...args].join(' '))
        } }
        throw new Error('Unexpected import: ' + name)
      }
    })
  } catch (caught) { if (caught !== stopped) error = caught }
  return { commands, records, error }
}
const stableWrites = result => result.commands.filter(command => command.includes('create') && command.some(argument => /:(main|latest|nightly)$/.test(argument)))

test('disabled promotion records the exact tested publication without writing stable tags', () => {
  const result = publish()
  assert.equal(result.error, undefined)
  assert.equal(result.records.length, 1)
  const record = result.records[0]
  assert.equal(record.image, `ghcr.io/example/hermes-web@${digest}`)
  assert.equal(record.wrapperRevision, wrapper)
  assert.equal(record.rendererRevision, renderer)
  assert.equal(record.workflowRun, 'https://github.com/example/hermes-web/actions/runs/123')
  assert.equal(record.runAttempt, 2)
  policy.assertCandidateEvidence(record.architectures, wrapper, renderer)
  assert.deepEqual(record.promotion, { status: 'disabled', verifiedTags: [] })
  assert.deepEqual(stableWrites(result), [])
})

test('release evidence declares promotion only after every stable tag is verified', () => {
  const passed = publish({ enabled: true })
  assert.equal(passed.error, undefined)
  assert.equal(passed.records[0].promotion.status, 'not-completed')
  assert.deepEqual(passed.records.at(-1).promotion, { status: 'completed', verifiedTags: ['main', 'latest'] })
  const failed = publish({ enabled: true, mismatchedTag: true })
  assert.match(failed.error.message, /Published latest does not identify the tested digest/)
  assert.deepEqual(failed.records.at(-1).promotion, { status: 'not-completed', verifiedTags: [] })
})

test('stale publication retains immutable evidence and missing amd64 candidate produces none', () => {
  const stale = publish({ enabled: true, current: 'f'.repeat(40) })
  assert.match(stale.error.message, /Stale release/)
  assert.equal(stale.records[0].promotion.status, 'not-completed')
  assert.deepEqual(stableWrites(stale), [])
  const missing = publish({ missingCandidate: true })
  assert.match(missing.error.message, /Missing tested amd64/)
  assert.deepEqual(missing.records, [])
  assert.deepEqual(missing.commands.filter(command => command[0] === 'docker'), [])
})
