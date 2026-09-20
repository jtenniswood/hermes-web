import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Creates or strengthens only our dedicated ruleset. Other protection stays intact.
const repository = process.env.GITHUB_REPOSITORY || 'jtenniswood/hermes-web'
if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('Invalid repository')
const automatic = process.argv.includes('--automation')
const desired = ['compatibility', ...(automatic ? ['renderer-update-policy'] : [])]
const payload = {
  name: 'Hermes tested releases', target: 'branch', enforcement: 'active',
  bypass_actors: [], conditions: { ref_name: { include: ['refs/heads/main'], exclude: [] } },
  rules: [
    { type: 'deletion' }, { type: 'non_fast_forward' },
    { type: 'required_status_checks', parameters: { strict_required_status_checks_policy: true, do_not_enforce_on_create: false, required_status_checks: desired.map(context => ({ context, integration_id: 15368 })) } }
  ]
}
if (!process.argv.includes('--apply')) {
  console.log(JSON.stringify({ repository, allow_auto_merge: true, ruleset: payload }, null, 2))
  process.exit(0)
}
const gh = args => execFileSync('gh', args, { encoding: 'utf8' }).trim()
const existing = JSON.parse(gh(['api', `repos/${repository}/rulesets?per_page=100`])).find(rule => rule.name === payload.name)
if (existing) {
  const current = JSON.parse(gh(['api', `repos/${repository}/rulesets/${existing.id}`]))
  if (current.bypass_actors?.length || current.conditions?.ref_name?.include?.join() !== 'refs/heads/main' || current.conditions?.ref_name?.exclude?.length) throw new Error('The dedicated ruleset was customized; review it before changing its scope')
  const checks = current.rules.find(rule => rule.type === 'required_status_checks')?.parameters.required_status_checks || []
  const destination = payload.rules.find(rule => rule.type === 'required_status_checks').parameters.required_status_checks
  for (const check of checks) if (!destination.some(item => item.context === check.context)) destination.push(check)
  for (const rule of current.rules) if (!payload.rules.some(item => item.type === rule.type)) payload.rules.push(rule)
}
const file = path.join(os.tmpdir(), `hermes-ruleset-${process.pid}.json`)
writeFileSync(file, JSON.stringify(payload))
gh(['api', '--method', existing ? 'PUT' : 'POST', `repos/${repository}/rulesets${existing ? `/${existing.id}` : ''}`, '--input', file])
gh(['api', '--method', 'PATCH', `repos/${repository}`, '-F', 'allow_auto_merge=true'])
console.log(`Enabled repository auto-merge and required ${desired.join(', ')}. Other rulesets and branch protection were preserved. Scheduling and promotion flags were not changed.`)
