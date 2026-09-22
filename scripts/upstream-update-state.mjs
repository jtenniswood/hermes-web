export const requiredUpdateChecks = ['compatibility', 'renderer-update-policy']

/** Missing, skipped, or unknown required checks must never count as success. */
export function updateCheckState(checks = []) {
  const name = check => check.name || check.context
  const result = check => check.conclusion || check.state
  const pending = check => check.status ? check.status !== 'COMPLETED' : ['PENDING', 'EXPECTED'].includes(check.state)
  if (!checks.length || checks.some(pending) || requiredUpdateChecks.some(context => !checks.some(check => name(check) === context))) return 'pending'
  if (checks.some(check => ['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(result(check)))) return 'failed'
  if (requiredUpdateChecks.some(context => checks.filter(check => name(check) === context).some(check => result(check) !== 'SUCCESS'))) return 'blocked'
  return 'passed'
}

export function proposalAction(proposal, candidate) {
  if (proposal.isDraft) return { action: 'hold', reason: 'Draft proposal requires maintainer review.' }
  if (proposal.mergeStateStatus === 'DIRTY') return { action: 'hold', reason: 'Merge conflict requires a reviewed repair.' }
  if (!proposal.mergeStateStatus || proposal.mergeStateStatus === 'UNKNOWN') return { action: 'wait', reason: 'GitHub has not computed mergeability yet.' }
  if (proposal.mergeStateStatus === 'BEHIND') return { action: 'refresh', reason: 'Merge current main into the proposal and rerun checks.' }
  const state = updateCheckState(proposal.statusCheckRollup)
  if (state === 'pending') return { action: 'wait', reason: 'Waiting for all required checks on the current proposal.' }
  if (state === 'blocked') return { action: 'hold', reason: 'A required check was skipped or has an unrecognized result.' }
  if (state === 'failed') return proposal.renderer === candidate
    ? { action: 'hold', reason: 'Latest renderer failed verification. Review the compatibility artifact and failed job.' }
    : { action: 'replace', reason: 'A newer renderer can supersede this failed proposal.' }
  return { action: 'auto-merge', reason: 'Required checks passed; retain the proposal and enable protected auto-merge.' }
}

export function automationReadiness({ repository, variables, secrets, rules }) {
  const checks = rules.filter(rule => rule.type === 'required_status_checks' && rule.parameters?.strict_required_status_checks_policy)
    .flatMap(rule => rule.parameters.required_status_checks)
  return [
    { name: 'Repository auto-merge', ready: repository.allow_auto_merge === true },
    { name: 'Merge commits enabled', ready: repository.allow_merge_commit === true },
    { name: 'Updater App ID', ready: /^\d+$/.test(variables.HERMES_UPDATER_APP_ID || '') },
    { name: 'Updater bot login', ready: /^[\w-]+\[bot\]$/.test(variables.HERMES_UPDATER_LOGIN || '') },
    { name: 'Updater private-key secret', ready: secrets.includes('HERMES_UPDATER_PRIVATE_KEY') },
    ...requiredUpdateChecks.map(context => ({ name: `Strict Actions check: ${context}`, ready: checks.some(check => check.context === context && check.integration_id === 15368) })),
    { name: 'Scheduled renderer proposals', ready: variables.HERMES_RENDERER_UPDATES_ENABLED === 'true' },
    { name: 'Tested image promotion', ready: variables.HERMES_PROMOTION_ENABLED === 'true' }
  ]
}


/** Manual validation uses the real updater without enabling recurring triggers. */
export function rendererUpdateRequest({ eventName, ref, enabled, revision = '' }) {
  if (!['workflow_dispatch', 'schedule', 'push'].includes(eventName) || ref !== 'refs/heads/main') {
    throw new Error('Renderer updates must run from main through a supported workflow event')
  }
  if (typeof revision !== 'string') throw new Error('Renderer revision must be an exact commit string')
  const requested = revision.trim()
  if (requested && (eventName !== 'workflow_dispatch' || !/^[a-f0-9]{40}$/.test(requested))) {
    throw new Error('An exact 40-character renderer revision is allowed only for manual validation')
  }
  return { allowed: eventName === 'workflow_dispatch' || enabled === 'true', revision: requested || null }
}
