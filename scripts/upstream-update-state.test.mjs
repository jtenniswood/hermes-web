import assert from 'node:assert/strict'
import { test } from 'node:test'
import { automationReadiness, proposalAction, requiredUpdateChecks, updateCheckState } from './upstream-update-state.mjs'

const passing = requiredUpdateChecks.map(name => ({ name, status: 'COMPLETED', conclusion: 'SUCCESS' }))
const proposal = { mergeStateStatus: 'CLEAN', renderer: 'candidate', statusCheckRollup: passing }

test('required checks must be present, complete and successful', () => {
  assert.equal(updateCheckState(passing), 'passed')
  assert.equal(updateCheckState([]), 'pending')
  assert.equal(updateCheckState(passing.slice(1)), 'pending')
  for (const conclusion of ['SKIPPED', 'NEUTRAL', 'UNRECOGNIZED', null]) {
    assert.equal(updateCheckState([{ ...passing[0], conclusion }, passing[1]]), 'blocked')
  }
  assert.equal(updateCheckState([{ ...passing[0], status: 'QUEUED' }, passing[1]]), 'pending')
  assert.equal(updateCheckState([...passing, { context: 'external', state: 'PENDING' }]), 'pending')
  assert.equal(updateCheckState([...passing, { context: 'external', state: 'ERROR' }]), 'failed')
  assert.equal(updateCheckState(passing.map(({ name }) => ({ context: name, state: 'SUCCESS' }))), 'passed')
})

test('proposal reconciliation preserves pending work, refreshes main, and retries only newer failures', () => {
  const failed = { ...proposal, statusCheckRollup: [{ ...passing[0], conclusion: 'FAILURE' }, passing[1]] }
  assert.equal(proposalAction(proposal, 'newer').action, 'auto-merge')
  assert.equal(proposalAction({ ...proposal, statusCheckRollup: [] }, 'newer').action, 'wait')
  assert.equal(proposalAction(failed, 'candidate').action, 'hold')
  assert.equal(proposalAction(failed, 'newer').action, 'replace')
  assert.equal(proposalAction({ ...failed, mergeStateStatus: 'BEHIND' }, 'candidate').action, 'refresh')
  for (const mergeStateStatus of ['DIRTY', 'UNKNOWN', undefined]) {
    assert.ok(['hold', 'wait'].includes(proposalAction({ ...proposal, mergeStateStatus }, 'newer').action))
  }
  assert.equal(proposalAction({ ...proposal, isDraft: true, mergeStateStatus: 'BEHIND' }, 'newer').action, 'hold')
})

test('setup audit distinguishes repository protections, credentials and enablement switches', () => {
  const setup = {
    repository: { allow_auto_merge: true, allow_merge_commit: true },
    variables: { HERMES_UPDATER_APP_ID: '123', HERMES_UPDATER_LOGIN: 'updater[bot]', HERMES_RENDERER_UPDATES_ENABLED: 'true', HERMES_PROMOTION_ENABLED: 'true' },
    secrets: ['HERMES_UPDATER_PRIVATE_KEY'],
    rules: [{ type: 'required_status_checks', parameters: { strict_required_status_checks_policy: true, required_status_checks: requiredUpdateChecks.map(context => ({ context, integration_id: 15368 })) } }]
  }
  assert.ok(automationReadiness(setup).every(check => check.ready))
  assert.equal(automationReadiness({ ...setup, secrets: [] }).filter(check => !check.ready).length, 1)
  assert.equal(automationReadiness({ ...setup, rules: [] }).filter(check => !check.ready).length, 2)
  assert.equal(automationReadiness({ ...setup, variables: {} }).filter(check => !check.ready).length, 4)
})
