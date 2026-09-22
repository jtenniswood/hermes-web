import { createHash } from 'node:crypto'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { rendererLock, repositoryRoot } from './renderer.mjs'
import { loadRegistry, registryContracts, sourceRoots, coverageReport, checkGeneratedRegistryFiles } from './compatibility-registry.mjs'

export function inspectContracts(contracts, readSource, { deferDependencies = false } = {}) {
  return contracts.map(contract => {
    if (!/^[\w./-]+$/.test(contract.module) || contract.module.split('/').includes('..') || contract.module.startsWith('/') || !/^[a-f0-9]{64}$/.test(contract.sourceHash)) throw new Error('Invalid compatibility contract')
    let actualHash = null
    try { actualHash = createHash('sha256').update(readSource(contract.module, contract)).digest('hex') }
    catch (error) { if (error.code !== 'ENOENT') throw error }
    return { ...contract, actualHash, status: actualHash === null ? (deferDependencies && contract.sourceRoot === 'dependency' ? 'pending-install' : 'missing') : actualHash === contract.sourceHash ? 'unchanged' : 'changed' }
  })
}

export function compatibilityReport(root = repositoryRoot, wrapper = 'unknown') {
  const registry = loadRegistry(root)
  checkGeneratedRegistryFiles(registry, root)
  const results = inspectContracts(registryContracts(registry), (module, contract) => readFileSync(path.join(root, sourceRoots[contract.sourceRoot], module)), { deferDependencies: true })
  return {
    version: 1, wrapper, renderer: rendererLock(root).rev,
    dependencyLockHash: createHash('sha256').update(readFileSync(path.join(root, 'pnpm-lock.yaml'))).digest('hex'),
    status: results.every(result => ['unchanged', 'pending-install'].includes(result.status)) ? 'unchanged' : 'review-required', results, coverage: coverageReport(registry)
  }
}

export function reportMarkdown(report) {
  const changed = report.results.filter(result => !['unchanged', 'pending-install'].includes(result.status))
  const pending = report.results.filter(result => result.status === 'pending-install')
  return [
    '## Renderer compatibility preflight', '',
    `Wrapper: \`${report.wrapper}\`. Renderer: \`${report.renderer}\`.`, '',
    `Checked ${report.results.length - pending.length} fingerprint contracts; ${changed.length} require review; ${pending.length} dependency contracts await installation.`, '',
    ...(report.coverage ? [`Registry: ${report.coverage.registered} owned entries; ${report.coverage.withBehavioralVerification} declare behavioral verification. See compatibility-coverage.json for owners, test paths, order, and removal conditions. This is declared verification coverage, not test execution evidence.`, ''] : []),
    'This is a source-contract preflight. Transform execution, dependencies, typechecking, gateway routing, and browser behavior must still pass the compatibility job.', '',
    ...(changed.length ? [
      '| Contract | Result | Reason |', '| --- | --- | --- |',
      ...changed.map(result => `| ${result.sourceRoot === 'dependency' ? result.module : `[${result.module}](https://github.com/NousResearch/hermes-agent/blob/${report.renderer}/apps/${result.sourceRoot === 'shared' ? 'shared' : 'desktop'}/src/${result.module})`} | ${result.status} | ${result.reason}${result.interventions ? ' Entries: ' + result.interventions.map(entry => entry.name + ' (' + entry.owner + ')').join(', ') : ''} |`), '',
      'Next: inspect the upstream diff and the named contracts in renderer-compatibility.json. Repair adapters in a separate manual-review PR, with behavioral regression coverage. Never regenerate fingerprints just to make this check pass.', ''
    ] : ['No fingerprint changes found. Continue with full verification.', '']),
    ...(pending.length ? ['Dependency fingerprints will be required by the build after installation: ' + pending.map(item => item.module).join(', '), ''] : []),
    'See docs/upstream-updates.md for triage, retries, enablement, and rollback.', ''
  ].join('\n')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = compatibilityReport(repositoryRoot, process.env.GITHUB_SHA || process.env.HERMES_WRAPPER_REV || 'unknown')
  const directory = path.resolve(process.argv[2] || 'test-results/upstream')
  mkdirSync(directory, { recursive: true })
  const markdown = reportMarkdown(report)
  writeFileSync(path.join(directory, 'compatibility-coverage.json'), JSON.stringify(report.coverage, null, 2) + '\n')
  writeFileSync(path.join(directory, 'renderer-compatibility.json'), JSON.stringify(report, null, 2) + '\n')
  writeFileSync(path.join(directory, 'renderer-compatibility.md'), markdown)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown)
  console.log(markdown)
  if (report.status !== 'unchanged') process.exitCode = 1
}
