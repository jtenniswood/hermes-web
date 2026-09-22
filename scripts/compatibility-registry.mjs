import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { repositoryRoot } from './renderer.mjs'

export const registryPath = 'apps/web-desktop/src/upstream/compatibility-registry.json'
export const sourceRoots = { renderer: 'apps/desktop/src', shared: 'apps/shared/src', dependency: 'node_modules' }
const kinds = new Set(['renderer-transform', 'browser-transform', 'replacement', 'source-contract', 'dependency-transform', 'alias', 'dedupe', 'virtual-module', 'asset-adapter'])
const relativeFile = value => typeof value === 'string' && /^[\w./-]+$/.test(value) && !value.startsWith('/') && !value.split('/').includes('..')
const fingerprint = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)

export function loadRegistry(root = repositoryRoot) {
  const registry = JSON.parse(readFileSync(path.join(root, registryPath), 'utf8'))
  validateRegistry(registry, root)
  return registry
}
export function validateRegistry(registry, root = repositoryRoot) {
  if (!Array.isArray(registry) || !registry.length) throw new Error('Compatibility registry is empty')
  const names = new Map()
  const inputs = new Map()
  for (const entry of registry) {
    if (!entry.name || names.has(entry.name) || !kinds.has(entry.kind) || !Number.isSafeInteger(entry.order)) throw new Error(`Invalid compatibility identity/order: ${entry.name}`)
    const orders = { 'renderer-transform': [30], 'browser-transform': [20, 40], replacement: [10, 20], 'source-contract': [0], 'dependency-transform': [5], alias: [-1, 0, 1], dedupe: [1], 'virtual-module': [20], 'asset-adapter': [1] }
    if (!orders[entry.kind].includes(entry.order)) throw new Error(`Unsupported compatibility stage: ${entry.name}`)
    names.set(entry.name, entry)
    if (!entry.reason?.trim() || !entry.removal?.trim() || !relativeFile(entry.owner) || !existsSync(path.join(root, entry.owner))) throw new Error(`Missing compatibility ownership/purpose/removal: ${entry.name}`)
    if (!entry.tests?.length) throw new Error(`No behavioral verification: ${entry.name}`)
    for (const test of entry.tests) {
      if (!relativeFile(test.file) || !test.scenario?.trim() || !existsSync(path.join(root, test.file)) || !readFileSync(path.join(root, test.file), 'utf8').includes(test.scenario)) throw new Error(`Missing behavioral verification: ${entry.name}: ${test.file} / ${test.scenario}`)
    }
    if (['renderer-transform', 'browser-transform', 'replacement', 'source-contract', 'dependency-transform', 'virtual-module'].includes(entry.kind) && !entry.module) throw new Error(`Missing compatibility source: ${entry.name}`)
    if (entry.module) {
      if (!relativeFile(entry.module) || !sourceRoots[entry.sourceRoot] || !fingerprint(entry.sourceHash)) throw new Error(`Invalid reviewed source fingerprint: ${entry.name}`)
      const key = `${entry.sourceRoot}/${entry.module}`
      if (inputs.has(key) && inputs.get(key) !== entry.sourceHash) throw new Error(`Conflicting reviewed fingerprints: ${key}`)
      inputs.set(key, entry.sourceHash)
    } else if (!entry.fingerprintPolicy?.trim()) throw new Error(`Missing fingerprint policy: ${entry.name}`)
    if (['renderer-transform', 'browser-transform'].includes(entry.kind) && !fingerprint(entry.outputHash)) throw new Error(`Missing reviewed output fingerprint: ${entry.name}`)
    if (entry.kind === 'browser-transform' && (!fingerprint(entry.inputHash) || !entry.handlers?.length)) throw new Error(`Missing browser transform sequence: ${entry.name}`)
    if (entry.kind === 'replacement' && (!entry.replacement || !existsSync(path.join(root, 'apps/web-desktop', entry.replacement)))) throw new Error(`Missing replacement: ${entry.name}`)
    if (entry.kind === 'alias' && (!entry.replacement || !(entry.specifier || entry.pattern) || !['renderer', 'vite'].includes(entry.aliasGroup))) throw new Error(`Invalid alias: ${entry.name}`)
  }
  for (const entry of registry) for (const prerequisite of entry.after || []) {
    if (!names.has(prerequisite) || names.get(prerequisite).order >= entry.order) throw new Error(`Invalid compatibility ordering: ${entry.name} after ${prerequisite}`)
  }
  return registry
}

export function registryContracts(registry) {
  const contracts = new Map()
  for (const entry of registry.filter(entry => entry.module)) {
    const key = `${entry.sourceRoot}/${entry.module}`
    if (!contracts.has(key)) contracts.set(key, { module: entry.module, sourceRoot: entry.sourceRoot, sourceHash: entry.sourceHash, name: entry.name, reason: entry.reason, manifest: registryPath, interventions: [] })
    contracts.get(key).interventions.push({ name: entry.name, owner: entry.owner, order: entry.order, tests: entry.tests, removal: entry.removal })
  }
  return [...contracts.values()]
}
export function verifyInstalledInputs(registry, root = repositoryRoot) {
  for (const contract of registryContracts(registry)) {
    const source = readFileSync(path.join(root, sourceRoots[contract.sourceRoot], contract.module))
    if (createHash('sha256').update(source).digest('hex') !== contract.sourceHash) throw new Error(`Compatibility source changed: ${contract.sourceRoot}/${contract.module} (${contract.interventions.map(item => item.name).join(', ')})`)
  }
}

export function coverageReport(registry) {
  return {
    scope: 'Declared behavioral verification paths, checked against test sources; not executed test results or measured code coverage.',
    registered: registry.length,
    withBehavioralVerification: registry.filter(entry => entry.tests.length).length,
    kinds: Object.fromEntries([...kinds].map(kind => [kind, registry.filter(entry => entry.kind === kind).length])),
    entries: registry.map(({ name, kind, order, owner, tests, removal }) => ({ name, kind, order, owner, tests, removal }))
  }
}
const cell = value => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ')
export function inventoryMarkdown(registry) {
  return [
    '# Browser compatibility inventory', '',
    'Generated from `apps/web-desktop/src/upstream/compatibility-registry.json` by `node scripts/compatibility-registry.mjs --write`. Edit the registry, then regenerate this document. Generation never accepts or recalculates fingerprints.', '',
    'Order records the configured resolution/transform stage: aliases and source contracts first, dependency fixes at 5, component replacements at 10, browser composition at 20, renderer transforms at 30, and dependent activity filtering at 40. Handler arrays record composition order within one entry. Resolution and transformation are separate Vite phases; these numbers do not imply a global ordering across modules.', '',
    'Each behavioral reference is a declared verification path checked against test source. Passing execution evidence comes from the required compatibility and production-image jobs. The preflight artifact includes `compatibility-coverage.json`; it does not claim measured code coverage.', '',
    '| Entry / kind / order | Target | Purpose / owner | Behavioral verification | Removal condition |',
    '| --- | --- | --- | --- | --- |',
    ...[...registry].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)).map(entry => `| ${cell(entry.name)} / ${entry.kind} / ${entry.order} | ${cell(entry.module || entry.specifier || entry.pattern || entry.packages?.join(', ') || entry.name)} | ${cell(entry.reason)} Owner: [${cell(entry.owner)}](../${entry.owner}) | ${entry.tests.map(test => `[${cell(test.scenario)}](../${test.file})`).join('<br>')} | ${cell(entry.removal)} |`), '',
    'Exact reviewed input/output fingerprints and alias/replacement targets live only in the registry. The build consumes that registry and rejects changed inputs or incomplete transform outputs. Dependencies are checked after installation; the early renderer preflight reports them as pending when they are unavailable.', ''
  ].join('\n')
}
export function generatedRegistryFiles(registry) {
  const paths = Object.fromEntries(registry.filter(entry => entry.kind === 'alias' && entry.aliasGroup === 'renderer').map(entry => [entry.specifier, [entry.replacement]]))
  return {
    'docs/browser-transform-inventory.md': inventoryMarkdown(registry),
    'apps/web-desktop/tsconfig.aliases.json': JSON.stringify({ compilerOptions: { paths } }, null, 2) + '\n'
  }
}
export function checkGeneratedRegistryFiles(registry, root = repositoryRoot) {
  for (const [file, expected] of Object.entries(generatedRegistryFiles(registry))) if (readFileSync(path.join(root, file), 'utf8') !== expected) throw new Error(`Stale compatibility output: ${file}; run node scripts/compatibility-registry.mjs --write`)
}
export function compatibilityRegistryPlugin(root) {
  return {
    name: 'hermes:compatibility-registry', enforce: 'pre',
    buildStart() {
      const registry = loadRegistry(root)
      checkGeneratedRegistryFiles(registry, root)
      verifyInstalledInputs(registry, root)
    }
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const registry = loadRegistry()
  if (process.argv.includes('--write')) {
    for (const [file, content] of Object.entries(generatedRegistryFiles(registry))) writeFileSync(path.join(repositoryRoot, file), content)
  } else {
    checkGeneratedRegistryFiles(registry)
    verifyInstalledInputs(registry)
  }
  console.log(`Compatibility registry: ${registry.length} owned entries with declared behavioral verification`)
}
