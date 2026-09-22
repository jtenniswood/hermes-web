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

function scenario({ merge = 'CLEAN', conclusion = 'FAILURE', renderer = previous, changedHead = false, createFails = false, files = ['flake.lock'], env = {}, openProposal = true, metadataRevision } = {}) {
  const commands = [], messages = [], writes = []
  const pr = { number: 12, state: 'open', html_url: 'https://github.com/example/hermes-web/pull/12', user: { login: actor }, base: { ref: 'main' }, head: { ref: 'codex/renderer-update-old', sha: head, repo: { full_name: repository } } }
  const detail = { headRefOid: head, mergeStateStatus: merge, statusCheckRollup: state.requiredUpdateChecks.map(name => ({ name, status: 'COMPLETED', conclusion: name === 'compatibility' ? conclusion : 'SUCCESS' })) }
  const lock = structuredClone(before)
  lock.nodes.hermes.locked.rev = renderer
  const environment = { GITHUB_REPOSITORY: repository, HERMES_UPDATER_LOGIN: actor, HERMES_STATUS_TOKEN: 'fixture', GITHUB_RUN_ID: '10', GITHUB_RUN_ATTEMPT: '2', GITHUB_EVENT_NAME: 'schedule', GITHUB_REF: 'refs/heads/main', HERMES_RENDERER_UPDATES_ENABLED: 'true', ...env }
  const process = { env: environment }
  const json = JSON.stringify
  const execFileSync = (command, args) => {
    commands.push([command, ...args])
    if (command === 'git') {
      if (args[0] === 'ls-remote') return candidate + '\trefs/heads/main'
      if (args[0] === 'rev-parse') return 'd'.repeat(40)
      return ''
    }
    if (command === 'nix') return json({ locked: { ...before.nodes.hermes.locked, rev: metadataRevision || environment.HERMES_RENDERER_REVISION?.trim() || candidate } })
    if (command !== 'gh') throw new Error(`Unexpected command: ${command}`)
    if (args[0] === 'api') {
      const endpoint = args.find(arg => arg.startsWith('repos/'))
      if (endpoint === `repos/${repository}`) return json({ allow_auto_merge: true, allow_merge_commit: true })
      if (endpoint.includes('/rules/')) return json([[{ type: 'required_status_checks', parameters: { strict_required_status_checks_policy: true, required_status_checks: state.requiredUpdateChecks.map(context => ({ context, integration_id: 15368 })) } }]])
      if (endpoint.includes('/pulls?')) return json([openProposal ? [pr] : []])
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
      if (name === 'node:fs') return { readFileSync: () => json(before), writeFileSync: (file, data) => writes.push({ file, data }), appendFileSync: () => {} }
      if (name === './release-policy.mjs') return policy
      if (name === './upstream-update-state.mjs') return state
      throw new Error(`Unexpected import: ${name}`)
    }
  })
  return { commands, messages, writes, exitCode: process.exitCode || 0 }
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


test('manual exact-revision validation creates a guarded proposal while recurring updates are disabled', () => {
  const requested = 'f'.repeat(40)
  const result = scenario({ openProposal: false, env: { GITHUB_EVENT_NAME: 'workflow_dispatch', HERMES_RENDERER_UPDATES_ENABLED: 'false', HERMES_RENDERER_REVISION: requested } })
  assert.equal(result.exitCode, 0)
  assert.equal(result.commands.some(command => command.includes('ls-remote')), false)
  assert.ok(result.commands.some(command => command[0] === 'nix' && command.includes(`github:NousResearch/hermes-agent/${requested}`)))
  assert.equal(JSON.parse(result.writes.find(write => write.file === 'flake.lock').data).nodes.hermes.locked.rev, requested)
  assert.deepEqual(prCommands(result).map(command => command[2]), ['create', 'merge'])
  assert.ok(prCommands(result).at(-1).includes('--match-head-commit'))
  assert.ok(result.messages.some(message => message.includes('Scheduling and stable-promotion settings are unchanged')))
  assert.equal(result.commands.some(command => command.includes('variable') || command.includes('secret')), false)
})

test('manual validation without a revision resolves upstream once without enabling recurring updates', () => {
  const result = scenario({ openProposal: false, env: { GITHUB_EVENT_NAME: 'workflow_dispatch', HERMES_RENDERER_UPDATES_ENABLED: '' } })
  assert.equal(result.exitCode, 0)
  assert.equal(result.commands.filter(command => command.includes('ls-remote')).length, 1)
  assert.equal(JSON.parse(result.writes.find(write => write.file === 'flake.lock').data).nodes.hermes.locked.rev, candidate)
})

test('disabled recurring runs do not inspect or mutate proposals', () => {
  for (const event of ['push', 'schedule']) {
    const result = scenario({ env: { GITHUB_EVENT_NAME: event, HERMES_RENDERER_UPDATES_ENABLED: 'false' } })
    assert.equal(result.exitCode, 0)
    assert.deepEqual(result.commands, [])
    assert.deepEqual(result.writes, [])
  }
})

test('revision overrides and untrusted workflow refs fail before any external operation', () => {
  for (const env of [
    { GITHUB_EVENT_NAME: 'push', HERMES_RENDERER_REVISION: candidate },
    { GITHUB_EVENT_NAME: 'schedule', HERMES_RENDERER_REVISION: candidate },
    { GITHUB_EVENT_NAME: 'workflow_dispatch', HERMES_RENDERER_REVISION: 'main' },
    { GITHUB_EVENT_NAME: 'workflow_dispatch', HERMES_RENDERER_REVISION: 'a'.repeat(39) },
    { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/feature' },
    { GITHUB_EVENT_NAME: 'pull_request' }
  ]) {
    const result = scenario({ env })
    assert.equal(result.exitCode, 1)
    assert.deepEqual(result.commands, [])
    assert.deepEqual(result.writes, [])
  }
})

test('manual exact validation retains an unrelated passing proposal and refuses mismatched fetched metadata', () => {
  const requested = 'f'.repeat(40)
  const env = { GITHUB_EVENT_NAME: 'workflow_dispatch', HERMES_RENDERER_REVISION: requested }
  const unrelated = scenario({ env, conclusion: 'SUCCESS' })
  assert.equal(unrelated.exitCode, 0)
  assert.deepEqual(prCommands(unrelated), [])
  assert.deepEqual(unrelated.writes, [])
  assert.ok(unrelated.messages.some(message => message.includes('No proposal was changed')))
  const mismatched = scenario({ env, openProposal: false, metadataRevision: candidate })
  assert.equal(mismatched.exitCode, 1)
  assert.deepEqual(prCommands(mismatched), [])
  assert.deepEqual(mismatched.writes, [])
})


test('manual validation still requires the configured App and retains a failed requested candidate', () => {
  const missingApp = scenario({ env: { GITHUB_EVENT_NAME: 'workflow_dispatch', HERMES_UPDATER_LOGIN: '' } })
  assert.equal(missingApp.exitCode, 1)
  assert.deepEqual(missingApp.commands, [])
  assert.ok(missingApp.messages.some(message => message.includes('Configure the repository-scoped updater App first')))
  const failed = scenario({ renderer: candidate, env: { GITHUB_EVENT_NAME: 'workflow_dispatch', HERMES_RENDERER_REVISION: candidate } })
  assert.equal(failed.exitCode, 0)
  assert.deepEqual(prCommands(failed), [])
  assert.deepEqual(failed.writes, [])
  assert.ok(failed.messages.some(message => message.includes('Latest renderer failed verification')))
})
