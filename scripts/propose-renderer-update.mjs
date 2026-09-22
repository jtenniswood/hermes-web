import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { assertRendererOnlyChange } from './release-policy.mjs'
import { proposalAction, requiredUpdateChecks, rendererUpdateRequest } from './upstream-update-state.mjs'

const run = (command, args) => execFileSync(command, args, { encoding: 'utf8' }).trim()
const gh = (...args) => run('gh', args)
const repository = process.env.GITHUB_REPOSITORY
const actor = process.env.HERMES_UPDATER_LOGIN
const statusGh = (...args) => execFileSync('gh', args, { encoding: 'utf8', env: { ...process.env, GH_TOKEN: process.env.HERMES_STATUS_TOKEN } }).trim()
function summary(message) {
  console.log(message)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, message + '\n\n')
}
function inspectProposal(pr, before) {
  if (pr.base.ref !== 'main' || pr.head.repo?.full_name !== repository || pr.user.login !== actor || !pr.head.ref.startsWith('codex/renderer-update-')) throw new Error('Unexpected renderer proposal source')
  const detail = JSON.parse(statusGh('pr', 'view', String(pr.number), '--repo', repository, '--json', 'headRefOid,isDraft,mergeStateStatus,statusCheckRollup,autoMergeRequest'))
  if (detail.headRefOid !== pr.head.sha || !/^[a-f0-9]{40}$/.test(detail.headRefOid)) throw new Error('Proposal changed during inspection; retry the updater')
  const files = JSON.parse(statusGh('api', '--paginate', '--slurp', `repos/${repository}/pulls/${pr.number}/files?per_page=100`)).flat().map(file => file.filename)
  const content = JSON.parse(statusGh('api', `repos/${repository}/contents/flake.lock?ref=${detail.headRefOid}`))
  const lock = JSON.parse(Buffer.from(content.content, 'base64').toString('utf8'))
  // A human repair or an unexpected lock change must never become an automatic update.
  assertRendererOnlyChange(before, lock, files)
  return { ...detail, renderer: lock.nodes.hermes.locked.rev }
}

function main() {
  const request = rendererUpdateRequest({ eventName: process.env.GITHUB_EVENT_NAME, ref: process.env.GITHUB_REF, enabled: process.env.HERMES_RENDERER_UPDATES_ENABLED, revision: process.env.HERMES_RENDERER_REVISION })
  if (!request.allowed) { summary('Recurring renderer proposals are disabled. No proposal was changed.'); return }
  if (process.env.GITHUB_EVENT_NAME === 'workflow_dispatch') summary('One-off renderer validation. Scheduling and stable-promotion settings are unchanged.')
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '') || !/^[\w-]+\[bot\]$/.test(actor || '')) throw new Error('Configure the repository-scoped updater App first')
  if (!process.env.HERMES_STATUS_TOKEN) throw new Error('A read-only status token is required')
  const settings = JSON.parse(statusGh('api', `repos/${repository}`))
  if (!settings.allow_auto_merge || !settings.allow_merge_commit) throw new Error('Enable repository auto-merge and merge commits first')
  const rules = JSON.parse(statusGh('api', '--paginate', '--slurp', `repos/${repository}/rules/branches/main?per_page=100`)).flat()
  const required = rules.filter(rule => rule.type === 'required_status_checks' && rule.parameters.strict_required_status_checks_policy).flatMap(rule => rule.parameters.required_status_checks)
  for (const context of requiredUpdateChecks) {
    if (!required.some(check => check.context === context && check.integration_id === 15368)) throw new Error(`Enable the required GitHub Actions check before scheduling: ${context}`)
  }
  const revision = request.revision || run('git', ['ls-remote', 'https://github.com/NousResearch/hermes-agent.git', 'refs/heads/main']).split(/\s/)[0]
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('Cannot resolve upstream main')
  const before = JSON.parse(readFileSync('flake.lock', 'utf8'))
  if (before.nodes.hermes.locked.rev === revision) { summary(`Renderer is current: ${revision}.`); return }
  summary(`Candidate renderer: ${revision}. [Upstream changes](https://github.com/NousResearch/hermes-agent/compare/${before.nodes.hermes.locked.rev}...${revision}).`)
  const open = JSON.parse(statusGh('api', '--paginate', '--slurp', `repos/${repository}/pulls?state=open&base=main&per_page=100`)).flat().filter(pr => pr.user.login === actor && pr.head.ref.startsWith('codex/renderer-update-'))
  if (open.length > 1) throw new Error('Multiple updater proposals are open; retain one after reviewing their evidence')
  for (const pr of open) {
    const detail = inspectProposal(pr, before)
    const decision = proposalAction(detail, revision)
    if (request.revision && detail.renderer !== revision && decision.action !== 'replace') {
      summary(`Requested ${revision}, but [proposal #${pr.number}](${pr.html_url}) targets ${detail.renderer}. Finish or retire that proposal before validating another exact revision. No proposal was changed.`)
      return
    }
    summary(`[Proposal #${pr.number}](${pr.html_url}): ${decision.reason}`)
    if (decision.action === 'refresh') {
      // GitHub merges main into the branch; expected_head_sha protects concurrent edits.
      gh('api', '--method', 'PUT', `repos/${repository}/pulls/${pr.number}/update-branch`, '-f', `expected_head_sha=${detail.headRefOid}`)
      summary('Requested a history-preserving branch refresh. New checks must pass before auto-merge.')
      return
    }
    if (decision.action === 'auto-merge') {
      if (!detail.autoMergeRequest) gh('pr', 'merge', String(pr.number), '--repo', repository, '--auto', '--merge', '--match-head-commit', detail.headRefOid)
      return
    }
    if (decision.action !== 'replace') return
  }
  const metadata = JSON.parse(run('nix', ['--extra-experimental-features', 'nix-command flakes', 'flake', 'metadata', '--json', '--no-write-lock-file', `github:NousResearch/hermes-agent/${revision}`]))
  const after = structuredClone(before)
  for (const key of ['rev', 'narHash', 'lastModified']) after.nodes.hermes.locked[key] = metadata.locked[key]
  if (after.nodes.hermes.locked.rev !== revision) throw new Error('Resolved metadata does not match the candidate')
  assertRendererOnlyChange(before, after)
  const suffix = process.env.GITHUB_RUN_ID, attempt = process.env.GITHUB_RUN_ATTEMPT
  if (!/^\d+$/.test(suffix || '') || !/^\d+$/.test(attempt || '')) throw new Error('A workflow run and attempt identity are required')
  const branch = `codex/renderer-update-${revision.slice(0, 12)}-${suffix}-${attempt}`
  run('git', ['switch', '-c', branch])
  writeFileSync('flake.lock', JSON.stringify(after, null, 2) + '\n')
  run('git', ['add', 'flake.lock'])
  run('git', ['-c', `user.name=${actor}`, '-c', `user.email=${actor}@users.noreply.github.com`, 'commit', '-m', `Update Hermes renderer to ${revision.slice(0, 12)}`])
  run('git', ['push', 'origin', branch])
  const body = `Update the pinned Hermes renderer from ${before.nodes.hermes.locked.rev} to ${revision}.\n\n[Review upstream changes](https://github.com/NousResearch/hermes-agent/compare/${before.nodes.hermes.locked.rev}...${revision}). Only the three renderer lock metadata fields change.\n\nCompatibility and renderer-update-policy must pass before protected auto-merge. The compatibility run publishes an upstream-compatibility artifact and summary listing changed or missing fingerprint contracts, then checks types, transforms, routing, and production-image browser behavior.\n\nIf blocked, follow docs/upstream-updates.md: repair adapters or dependencies in a separate manual-review PR; never automatically accept new fingerprints or diagnostic baselines. Failed proposals remain visible until a newer candidate is successfully proposed. Publishing a tested image does not restart a deployment.\n`
  writeFileSync('/tmp/hermes-renderer-update-body.md', body)
  const url = gh('pr', 'create', '--repo', repository, '--base', 'main', '--head', branch, '--title', `Update Hermes renderer to ${revision.slice(0, 12)}`, '--body-file', '/tmp/hermes-renderer-update-body.md')
  // Create the replacement before closing any old failure. Recheck for human edits.
  for (const previous of open) {
    const current = JSON.parse(statusGh('api', `repos/${repository}/pulls/${previous.number}`))
    if (current.state !== 'open' || current.head.sha !== previous.head.sha || proposalAction(inspectProposal(current, before), revision).action !== 'replace') {
      throw new Error('Previous proposal changed; review the open proposals before enabling auto-merge')
    }
    gh('pr', 'close', String(previous.number), '--repo', repository)
  }
  const head = run('git', ['rev-parse', 'HEAD'])
  gh('pr', 'merge', url, '--repo', repository, '--auto', '--merge', '--match-head-commit', head)
  summary(`Created [renderer proposal](${url}). Protected auto-merge is enabled for ${head}.`)
}

try { main() } catch (error) {
  summary(`Updater stopped: ${error.message}`)
  summary('No compatibility guards were relaxed. Follow docs/upstream-updates.md and rerun after resolving the reported blocker.')
  process.exitCode = 1
}
