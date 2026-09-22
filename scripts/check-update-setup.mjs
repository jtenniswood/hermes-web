import { execFileSync } from 'node:child_process'
import { automationReadiness } from './upstream-update-state.mjs'

// Read metadata and secret names only. Never retrieve or print secret values.
const gh = (...args) => JSON.parse(execFileSync('gh', args, { encoding: 'utf8' }))
try {
  const name = process.env.GITHUB_REPOSITORY || gh('repo', 'view', '--json', 'nameWithOwner').nameWithOwner
  if (!/^[\w.-]+\/[\w.-]+$/.test(name)) throw new Error('Invalid repository')
  const repository = gh('api', `repos/${name}`)
  const variables = Object.fromEntries(gh('api', '--paginate', '--slurp', `repos/${name}/actions/variables?per_page=100`).flatMap(page => page.variables).map(item => [item.name, item.value]))
  const secrets = gh('api', '--paginate', '--slurp', `repos/${name}/actions/secrets?per_page=100`).flatMap(page => page.secrets).map(item => item.name)
  const rules = gh('api', '--paginate', '--slurp', `repos/${name}/rules/branches/main?per_page=100`).flat()
  const checks = automationReadiness({ repository, variables, secrets, rules })
  console.log(`Upstream update setup: ${name}`)
  for (const check of checks) console.log(`${check.ready ? 'READY' : 'MISSING'}: ${check.name}`)
  console.log('App installation, private-key validity, and rollout evidence still require the documented verification run. No settings changed.')
  if (checks.some(check => !check.ready)) process.exitCode = 1
} catch (error) {
  console.error(`Could not inspect update setup: ${error.message}`)
  console.error('Use gh auth login with repository settings read access, then retry. Unknown settings are not treated as ready.')
  process.exitCode = 1
}
