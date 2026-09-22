import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import { test } from 'node:test'
import ts from 'typescript'
import { loadRegistry, validateRegistry, registryContracts, checkGeneratedRegistryFiles, generatedRegistryFiles, coverageReport } from './compatibility-registry.mjs'
import { inspectContracts } from './renderer-compatibility-report.mjs'

const root = path.resolve('apps/web-desktop')
const registry = loadRegistry()
function load(name) {
  const filename = path.join(root, 'src/upstream', name)
  const context = vm.createContext({ exports: {}, require: createRequire(filename) })
  vm.runInContext(ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, context)
  return context.exports
}
const { browserPlugin, browserActivityNotificationsPlugin } = load('browser-plugin.ts')
const { transformRenderer } = load('transforms.ts')
const { rendererOverrides } = load('overrides.ts')

test('registry rejects missing ownership, verification, fingerprints, and invalid application order', () => {
  for (const change of [
    rows => { rows[0].owner = 'missing-owner.ts' },
    rows => { rows[0].tests = [] },
    rows => { rows[0].tests[0].scenario = 'a nonexistent behavioral scenario' },
    rows => { rows[0].removal = '' },
    rows => { rows[0].sourceHash = 'unreviewed' },
    rows => { rows[0].outputHash = 'unreviewed' },
    rows => { rows[0].order = 999 },
    rows => { rows.push(rows[0]) },
    rows => { rows.find(entry => entry.name === 'browser-activity-notifications').after = ['missing-entry'] }
  ]) {
    const invalid = structuredClone(registry)
    change(invalid)
    assert.throws(() => validateRegistry(invalid))
  }
})

test('registry generates its inventory and aliases without accepting changed upstream fingerprints', () => {
  const snapshot = structuredClone(registry)
  checkGeneratedRegistryFiles(registry)
  const contracts = registryContracts(registry)
  const report = inspectContracts(contracts, () => 'changed upstream content')
  assert.ok(report.every(entry => entry.status === 'changed'))
  const generated = generatedRegistryFiles(registry)
  assert.ok(generated['docs/browser-transform-inventory.md'].includes(registry[0].name))
  assert.deepEqual(registry, snapshot)
  assert.equal(coverageReport(registry).withBehavioralVerification, registry.length)
})

test('early preflight distinguishes uninstalled dependencies from missing renderer sources', () => {
  const contracts = registryContracts(registry)
  const results = inspectContracts(contracts, () => { throw Object.assign(new Error('Not installed'), { code: 'ENOENT' }) }, { deferDependencies: true })
  assert.ok(results.filter(entry => entry.sourceRoot === 'dependency').every(entry => entry.status === 'pending-install'))
  assert.ok(results.filter(entry => entry.sourceRoot !== 'dependency').every(entry => entry.status === 'missing'))
  assert.ok(inspectContracts(contracts, () => { throw Object.assign(new Error('Missing'), { code: 'ENOENT' }) }).every(entry => entry.status === 'missing'))
})

for (const entry of registry.filter(entry => entry.kind === 'browser-transform')) {
  test(`registered browser pipeline: ${entry.name}`, () => {
    const filename = path.join(root, '../desktop/src', entry.module)
    let input = readFileSync(filename, 'utf8')
    if (entry.after?.includes('bot-roster-opening')) input = transformRenderer(input, filename).code
    const plugin = entry.order === 40 ? browserActivityNotificationsPlugin() : browserPlugin(root)
    const output = plugin.transform(input, filename).code
    assert.notEqual(output, input)
    assert.equal(plugin.transform(output, filename).code, output)
    assert.throws(() => plugin.transform(input + '\n// upstream changed', filename), /compatibility changed/)
    assert.throws(() => plugin.transform(output + '\n// partially edited', filename), /compatibility changed/)
    assert.deepEqual(ts.createSourceFile(filename, output, ts.ScriptTarget.Latest, true).parseDiagnostics, [])
  })
}

for (const entry of registry.filter(entry => entry.kind === 'replacement')) {
  test(`registered module replacement: ${entry.name}`, async () => {
    const plugin = entry.owner.endsWith('/overrides.ts') ? rendererOverrides(root) : browserPlugin(root)
    const context = { resolve: async () => ({ id: path.join(root, '../desktop/src', entry.module) }) }
    const target = await plugin.resolveId.call(context, '@/' + entry.module, path.join(root, '../desktop/src/app/consumer.tsx'))
    assert.equal(target, path.join(root, entry.replacement))
    for (const importer of entry.bypassImporters || []) assert.equal(await plugin.resolveId.call(context, '@/' + entry.module, root + '/src' + importer), null)
  })
}

test('unread replacement resolves relative, aliased, and explicit TypeScript imports to one module', async () => {
  const plugin = browserPlugin(root)
  const context = { resolve: async () => ({ id: path.join(root, '../desktop/src/store/session-unread-remote.ts') }) }
  for (const source of ['./session-unread-remote', '@/store/session-unread-remote', '@/store/session-unread-remote.ts']) {
    assert.equal(await plugin.resolveId.call(context, source, path.join(root, '../desktop/src/store/session.ts')), path.join(root, 'src/upstream/browser-unread.ts'))
  }
})
