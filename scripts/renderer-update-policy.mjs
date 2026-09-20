import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { assertRendererOnlyChange } from './release-policy.mjs'

const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
const pr = event.pull_request
if (!pr) { console.log('Not a pull request.'); process.exit(0) }
if (pr.user.login !== process.env.HERMES_UPDATER_LOGIN) {
  console.log('Manual-review pull request; renderer auto-merge is not eligible.')
  process.exit(0)
}
if (pr.base.ref !== 'main' || !pr.head.ref.startsWith('codex/renderer-update-') || pr.head.repo.full_name !== pr.base.repo.full_name) throw new Error('Unexpected renderer update source')
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
const base = pr.base.sha, head = pr.head.sha
if (![base, head].every(sha => /^[a-f0-9]{40}$/.test(sha))) throw new Error('Invalid commit identity')
const files = git('diff', '--name-only', `${base}...${head}`).split('\n')
assertRendererOnlyChange(JSON.parse(git('show', `${base}:flake.lock`)), JSON.parse(git('show', `${head}:flake.lock`)), files)
console.log('Exact renderer-only update verified.')
