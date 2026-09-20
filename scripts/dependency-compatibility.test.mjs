import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'
import { build } from 'vite'
const root = path.resolve('apps/web-desktop')
const file = path.join(root, 'src/upstream/dependency-compatibility.ts')
const require = createRequire(file)
const context = vm.createContext({ exports: {}, require })
vm.runInContext(ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, context)
const { preserveBatchEffects, dependencyCompatibilityPlugin } = context.exports

test('batch compatibility checks the locked source and is idempotent', () => {
  const source = readFileSync(path.join(path.dirname(require.resolve('nanostores')), 'atom/index.js'), 'utf8')
  const output = preserveBatchEffects(source)
  assert.equal(preserveBatchEffects(output), output)
  assert.throws(() => preserveBatchEffects(source + '\n// changed'), /compatibility changed/)
  assert.throws(() => preserveBatchEffects(source.replace('export const batch', 'export const unexpected')), /compatibility changed/)
})
test('production bundling preserves state writes inside batch callbacks', async () => {
  async function bundle(patched) {
    const result = await build({ configFile: false, root, logLevel: 'silent', define: { 'process.env.NODE_ENV': JSON.stringify('production') }, plugins: [
      ...(patched ? [dependencyCompatibilityPlugin(root)] : []),
      { name: 'batch-regression', resolveId(id) { if (id === 'batch-regression' || id.endsWith('/batch-regression')) return '\0batch-regression' }, load(id) { if (id === '\0batch-regression') return `import { atom, batch } from ${JSON.stringify(require.resolve('nanostores'))}; const profiles = atom([]); batch(() => profiles.set(['default', 'research'])); globalThis.result = profiles.get();` } }
    ], build: { write: false, minify: true, lib: { entry: 'batch-regression', formats: ['es'] } } })
    const output = (Array.isArray(result) ? result[0] : result).output.find(item => item.type === 'chunk').code
    const runtime = vm.createContext({}); vm.runInContext(output, runtime)
    return Array.from(runtime.result)
  }
  assert.deepEqual(await bundle(false), [], 'Regression must reproduce against the unpatched locked dependency')
  assert.deepEqual(await bundle(true), ['default', 'research'])
})
