import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { assertRendererOnlyChange } from './release-policy.mjs'

const run = (command, args) => execFileSync(command, args, { encoding: 'utf8' }).trim()
const gh = (...args) => run('gh', args)
const repository = process.env.GITHUB_REPOSITORY
const actor = process.env.HERMES_UPDATER_LOGIN
if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '') || !/^[\w-]+\[bot\]$/.test(actor || '')) throw new Error('Configure the repository-scoped updater App first')
const rules = JSON.parse(execFileSync('gh', ['api', `repos/${repository}/rules/branches/main`], { encoding: 'utf8', env: { ...process.env, GH_TOKEN: process.env.HERMES_STATUS_TOKEN } }))
const required = rules.filter(rule => rule.type === 'required_status_checks' && rule.parameters.strict_required_status_checks_policy).flatMap(rule => rule.parameters.required_status_checks)
for (const context of ['compatibility', 'renderer-update-policy']) {
  if (!required.some(check => check.context === context && check.integration_id === 15368)) throw new Error(`Enable the required GitHub Actions check before scheduling: ${context}`)
}
const revision = run('git', ['ls-remote', 'https://github.com/NousResearch/hermes-agent.git', 'refs/heads/main']).split(/\s/)[0]
if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('Cannot resolve upstream main')
const before = JSON.parse(readFileSync('flake.lock', 'utf8'))
if (before.nodes.hermes.locked.rev === revision) { console.log('Renderer is current.'); process.exit(0) }
const open = JSON.parse(gh('api', `repos/${repository}/pulls?state=open&base=main&per_page=100`)).filter(pr => pr.user.login === actor && pr.head.ref.startsWith('codex/renderer-update-'))
for (const pr of open) {
  const checks = JSON.parse(execFileSync('gh', ['pr', 'view', String(pr.number), '--json', 'statusCheckRollup'], { encoding: 'utf8', env: { ...process.env, GH_TOKEN: process.env.HERMES_STATUS_TOKEN } })).statusCheckRollup
  const pending = !checks.length || checks.some(check => check.status && check.status !== 'COMPLETED')
  const failed = checks.some(check => ['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED'].includes(check.conclusion || check.state))
  // Leave a pending or passing proposal alone, including one waiting on a merge.
  if (pending || !failed || pr.head.ref.includes(revision.slice(0, 12))) { console.log(`Existing proposal #${pr.number} remains open.`); process.exit(0) }
}
const metadata = JSON.parse(run('nix', ['--extra-experimental-features', 'nix-command flakes', 'flake', 'metadata', '--json', '--no-write-lock-file', `github:NousResearch/hermes-agent/${revision}`]))
const after = structuredClone(before)
for (const key of ['rev', 'narHash', 'lastModified']) after.nodes.hermes.locked[key] = metadata.locked[key]
if (after.nodes.hermes.locked.rev !== revision) throw new Error('Resolved metadata does not match the candidate')
assertRendererOnlyChange(before, after)
const suffix = process.env.GITHUB_RUN_ID
if (!/^\d+$/.test(suffix || '')) throw new Error('A workflow run identity is required')
const branch = `codex/renderer-update-${revision.slice(0, 12)}-${suffix}`
run('git', ['switch', '-c', branch])
writeFileSync('flake.lock', JSON.stringify(after, null, 2) + '\n')
run('git', ['add', 'flake.lock'])
run('git', ['-c', `user.name=${actor}`, '-c', `user.email=${actor}@users.noreply.github.com`, 'commit', '-m', `Update Hermes renderer to ${revision.slice(0, 12)}`])
run('git', ['push', 'origin', branch])
// Superseded failed proposals remain in history, never rebased or force-pushed.
for (const pr of open) gh('pr', 'close', String(pr.number))
const body = `Update only the authoritative renderer lock metadata to ${revision}.\n\nRequired compatibility, production-image browser checks and renderer-update policy must pass before auto-merge. Adapter, dependency and diagnostic-baseline changes require human review. This does not restart a deployment.\n`
writeFileSync('/tmp/hermes-renderer-update-body.md', body)
const url = gh('pr', 'create', '--base', 'main', '--head', branch, '--title', `Update Hermes renderer to ${revision.slice(0, 12)}`, '--body-file', '/tmp/hermes-renderer-update-body.md')
const head = run('git', ['rev-parse', 'HEAD'])
gh('pr', 'merge', url, '--auto', '--merge', '--match-head-commit', head)
console.log(url)
