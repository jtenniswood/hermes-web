import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import * as policy from './release-policy.mjs'
import * as state from './upstream-update-state.mjs'

const before = JSON.parse(readFileSync(new URL('../flake.lock', import.meta.url), 'utf8'))
const candidate = 'a'.repeat(40), previous = 'b'.repeat(40), head = 'c'.repeat(40)
const repository = 'example/hermes-web', actor = 'updater[bot]'
const source = ts.transpileModule(readFileSync(new URL('./propose-renderer-update.mjs', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText

function scenario({ merge = 'CLEAN', conclusion = 'FAILURE', renderer = previous, changedHead = false, createFails = false, files = ['flake.lock'] } = {}) {
  const commands = [], messages = []
  const pr = { number: 12, state: 'open', html_url: 'https://github.com/example/hermes-web/pull/12', user: { login: actor }, base: { ref: 'main' }, head: { ref: 'codex/renderer-update-old', sha: head, repo: { full_name: repository } } }
  const detail = { headRefOid: head, mergeStateStatus: merge, statusCheckRollup: state.requiredUpdateChecks.map(name => ({ name, status: 'COMPLETED', conclusion: name === 'compatibility' ? conclusion : 'SUCCESS' })) }
  const lock = structuredClone(before)
  lock.nodes.hermes.locked.rev = renderer
  const environment = { GITHUB_REPOSITORY: repository, HERMES_UPDATER_LOGIN: actor, HERMES_STATUS_TOKEN: 'fixture', GITHUB_RUN_ID: '10', GITHUB_RUN_ATTEMPT: '2' }
  const process = { env: environment }
  const json = JSON.stringify
  const execFileSync = (command, args) => {
    commands.push([command, ...args])
    if (command === 'git') {
      if (args[0] === 'ls-remote') return candidate + '\trefs/heads/main'
      if (args[0] === 'rev-parse') return 'd'.repeat(40)
      return ''
    }
    if (command === 'nix') return json({ locked: { ...before.nodes.hermes.locked, rev: candidate } })
    if (command !== 'gh') throw new Error(`Unexpected command: ${command}`)
    if (args[0] === 'api') {
      const endpoint = args.find(arg => arg.startsWith('repos/'))
      if (endpoint === `repos/${repository}`) return json({ allow_auto_merge: true, allow_merge_commit: true })
      if (endpoint.includes('/rules/')) return json([[{ type: 'required_status_checks', parameters: { strict_required_status_checks_policy: true, required_status_checks: state.requiredUpdateChecks.map(context => ({ context, integration_id: 15368 })) } }]])
      if (endpoint.includes('/pulls?')) return json([[pr]])
      if (endpoint.includes('/files?')) return json([files.map(filename => ({ filename }))])
      if (endpoint.includes('/contents/')) return json({ content: Buffer.from(json(lock)).toString('base64') })
      if (endpoint.endsWith('/update-branch')) return '{}'
      if (endpoint.endsWith('/pulls/12')) return json(changedHead ? { ...pr, head: { ...pr.head, sha: 'e'.repeat(40) } } : pr)
    }
    if (args[0] === 'pr') {
      if (args[1] === 'view') return json(detail)
      if (args[1] === 'create') {
        if (createFails) throw new Error('Creation failed')
        return 'https://github.com/example/hermes-web/pull/13'
      }
      if (['close', 'merge'].includes(args[1])) return ''
    }
    throw new Error(`Unexpected gh call: ${args.join(' ')}`)
  }
  vm.runInNewContext(source, {
    exports: {}, Buffer, structuredClone, process, console: { log: message => messages.push(message) },
    require: name => {
      if (name === 'node:child_process') return { execFileSync }
      if (name === 'node:fs') return { readFileSync: () => json(before), writeFileSync: () => {}, appendFileSync: () => {} }
      if (name === './release-policy.mjs') return policy
      if (name === './upstream-update-state.mjs') return state
      throw new Error(`Unexpected import: ${name}`)
    }
  })
  return { commands, messages, exitCode: process.exitCode || 0 }
}

const prCommands = result => result.commands.filter(command => command[0] === 'gh' && command[1] === 'pr' && command[2] !== 'view')
test('behind proposal refresh uses the inspected SHA without creating or merging a PR', () => {
  const result = scenario({ merge: 'BEHIND' })
  assert.equal(result.exitCode, 0)
  const refresh = result.commands.find(command => command.some(arg => arg.endsWith('/update-branch')))
  assert.ok(refresh.includes(`expected_head_sha=${head}`))
  assert.deepEqual(prCommands(result), [])
})
test('new candidate is created before closing a failed predecessor and enables protected auto-merge', () => {
  const result = scenario()
  assert.equal(result.exitCode, 0)
  assert.deepEqual(prCommands(result).map(command => command[2]), ['create', 'close', 'merge'])
  const merge = prCommands(result).at(-1)
  assert.ok(merge.includes('--auto'))
  assert.ok(merge.includes('--match-head-commit'))
  assert.ok(merge.includes('d'.repeat(40)))
  assert.ok(result.commands.some(command => command.includes(`codex/renderer-update-${candidate.slice(0, 12)}-10-2`)))
})
test('failed replacement creation and concurrent edits never close the prior proposal', () => {
  for (const options of [{ createFails: true }, { changedHead: true }]) {
    const result = scenario(options)
    assert.equal(result.exitCode, 1)
    assert.deepEqual(prCommands(result).map(command => command[2]), ['create'])
  }
})
test('human-modified, skipped, conflicting and latest-failed proposals never auto-merge', () => {
  for (const options of [{ files: ['flake.lock', 'adapter.ts'] }, { conclusion: 'SKIPPED' }, { merge: 'DIRTY' }, { renderer: candidate }]) {
    assert.deepEqual(prCommands(scenario(options)), [])
  }
})
test('passing existing proposal can recover a missing auto-merge request with a head guard', () => {
  const result = scenario({ conclusion: 'SUCCESS' })
  assert.equal(result.exitCode, 0)
  const commands = prCommands(result)
  assert.equal(commands.length, 1)
  assert.equal(commands[0][2], 'merge')
  assert.ok(commands[0].includes(head))
})
