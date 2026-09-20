import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, appendFileSync } from 'node:fs'
import { assertCandidateEvidence, assertRendererOnlyChange, promotionTags } from './release-policy.mjs'
import { rendererLock } from './renderer.mjs'
const run = (command, args) => execFileSync(command, args, { encoding: 'utf8' }).trim()
const repository = process.env.GITHUB_REPOSITORY
const image = `ghcr.io/${repository.toLowerCase()}`
const wrapper = run('git', ['rev-parse', 'HEAD']), renderer = rendererLock().rev
const evidence = readdirSync('candidate-evidence').filter(file => file.endsWith('.json')).map(file => JSON.parse(readFileSync(`candidate-evidence/${file}`, 'utf8')))
assertCandidateEvidence(evidence, wrapper, renderer)
const candidate = `${image}:candidate-${wrapper}-${renderer}-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`
run('docker', ['buildx', 'imagetools', 'create', '--tag', candidate, ...evidence.map(item => `${image}@${item.digest}`)])
const digest = run('docker', ['buildx', 'imagetools', 'inspect', candidate, '--format', '{{.Manifest.Digest}}'])
if (!/^sha256:[a-f0-9]{64}$/.test(digest)) throw new Error('Cannot identify the tested multi-architecture candidate')
appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Tested candidate: \`${image}@${digest}\`\n\nWrapper: \`${wrapper}\`; renderer: \`${renderer}\`.\n`)
if (process.env.HERMES_PROMOTION_ENABLED !== 'true') {
  console.log('Candidate verified. Stable promotion remains disabled pending rollout gates.'); process.exit(0)
}
// Publication is serialized by the workflow. Read main immediately before tag writes.
const currentMain = run('git', ['ls-remote', 'origin', 'refs/heads/main']).split(/\s/)[0]
let nightly = false
if (process.env.GITHUB_REF === 'refs/heads/main' && process.env.HERMES_UPDATER_LOGIN) {
  const pulls = JSON.parse(run('gh', ['api', `repos/${repository}/commits/${wrapper}/pulls`]))
  for (const pr of pulls) {
    if (!pr.merged_at || pr.merge_commit_sha !== wrapper || pr.user.login !== process.env.HERMES_UPDATER_LOGIN || !pr.head.ref.startsWith('codex/renderer-update-')) continue
    const files = JSON.parse(run('gh', ['api', `repos/${repository}/pulls/${pr.number}/files`])).map(item => item.filename)
    const previous = JSON.parse(run('git', ['show', `${wrapper}^1:flake.lock`]))
    assertRendererOnlyChange(previous, JSON.parse(readFileSync('flake.lock', 'utf8')), files)
    nightly = true
  }
}
const tags = promotionTags({ sourceRevision: wrapper, currentMain, ref: process.env.GITHUB_REF, nightly })
run('docker', ['buildx', 'imagetools', 'create', ...tags.flatMap(tag => ['--tag', `${image}:${tag}`]), `${image}@${digest}`])
for (const tag of tags) {
  if (run('docker', ['buildx', 'imagetools', 'inspect', `${image}:${tag}`, '--format', '{{.Manifest.Digest}}']) !== digest) throw new Error(`Published ${tag} does not identify the tested digest`)
}
appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\nPromoted this digest to: ${tags.map(tag => `\`${tag}\``).join(', ')}. No deployment was restarted.\n`)
