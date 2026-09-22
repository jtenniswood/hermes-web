import { createHash } from 'node:crypto'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { rendererLock, repositoryRoot } from './renderer.mjs'

export function inspectContracts(contracts, readSource) {
  return contracts.map(contract => {
    if (!/^[\w./-]+$/.test(contract.module) || contract.module.split('/').includes('..') || contract.module.startsWith('/') || !/^[a-f0-9]{64}$/.test(contract.sourceHash)) throw new Error('Invalid compatibility contract')
    let actualHash = null
    try { actualHash = createHash('sha256').update(readSource(contract.module)).digest('hex') }
    catch (error) { if (error.code !== 'ENOENT') throw error }
    return { ...contract, actualHash, status: actualHash === null ? 'missing' : actualHash === contract.sourceHash ? 'unchanged' : 'changed' }
  })
}

export function compatibilityReport(root = repositoryRoot, wrapper = 'unknown') {
  const adapter = path.join(root, 'apps/web-desktop/src/upstream')
  const contracts = ['transform-fixtures.json', 'browser-contracts.json'].flatMap(manifest =>
    JSON.parse(readFileSync(path.join(adapter, manifest), 'utf8')).map(contract => ({
      module: contract.module, name: contract.name || contract.module,
      reason: contract.reason || 'Browser composition relies on this upstream module.',
      sourceHash: contract.sourceHash, manifest
    })))
  const results = inspectContracts(contracts, module => readFileSync(path.join(root, 'apps/desktop/src', module)))
  return {
    version: 1, wrapper, renderer: rendererLock(root).rev,
    dependencyLockHash: createHash('sha256').update(readFileSync(path.join(root, 'pnpm-lock.yaml'))).digest('hex'),
    status: results.every(result => result.status === 'unchanged') ? 'unchanged' : 'review-required', results
  }
}

export function reportMarkdown(report) {
  const changed = report.results.filter(result => result.status !== 'unchanged')
  return [
    '## Renderer compatibility preflight', '',
    `Wrapper: \`${report.wrapper}\`. Renderer: \`${report.renderer}\`.`, '',
    `Checked ${report.results.length} fingerprint contracts; ${changed.length} require review.`, '',
    'This is a source-contract preflight. Transform execution, dependencies, typechecking, gateway routing, and browser behavior must still pass the compatibility job.', '',
    ...(changed.length ? [
      '| Contract | Result | Reason |', '| --- | --- | --- |',
      ...changed.map(result => `| [${result.module}](https://github.com/NousResearch/hermes-agent/blob/${report.renderer}/apps/desktop/src/${result.module}) | ${result.status} | ${result.reason} |`), '',
      'Next: inspect the upstream diff and the named contracts in renderer-compatibility.json. Repair adapters in a separate manual-review PR, with behavioral regression coverage. Never regenerate fingerprints just to make this check pass.', ''
    ] : ['No fingerprint changes found. Continue with full verification.', '']),
    'See docs/upstream-updates.md for triage, retries, enablement, and rollback.', ''
  ].join('\n')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = compatibilityReport(repositoryRoot, process.env.GITHUB_SHA || process.env.HERMES_WRAPPER_REV || 'unknown')
  const directory = path.resolve(process.argv[2] || 'test-results/upstream')
  mkdirSync(directory, { recursive: true })
  const markdown = reportMarkdown(report)
  writeFileSync(path.join(directory, 'renderer-compatibility.json'), JSON.stringify(report, null, 2) + '\n')
  writeFileSync(path.join(directory, 'renderer-compatibility.md'), markdown)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown)
  console.log(markdown)
  if (report.status !== 'unchanged') process.exitCode = 1
}
