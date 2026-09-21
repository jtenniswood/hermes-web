import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { createServer } from 'vite'
import { repositoryRoot } from './renderer.mjs'
import { rendererAliases } from './aliases.mjs'

const root = path.join(repositoryRoot, 'apps/web-desktop')
const transformPath = path.join(root, 'src/upstream/transforms.ts')
const context = vm.createContext({ exports: {}, require: createRequire(transformPath) })
vm.runInContext(ts.transpileModule(readFileSync(transformPath, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, context)
const { compatibilityTransforms, transformRenderer } = context.exports

const transformValidationOptions = {
  target: ts.ScriptTarget.ES2023,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.ReactJSX,
  strict: true,
  skipLibCheck: true,
  noEmit: true,
  noResolve: true,
  ignoreDeprecations: '6.0',
  lib: ['lib.dom.d.ts', 'lib.es2023.d.ts']
}
const transformValidationAmbientFile = path.join(root, 'src/.browser-transform-validation.d.ts')
const transformValidationAmbient = `
declare interface ImportMeta { env: Record<string, string | undefined>; hot?: unknown }
declare interface Window {
  __HERMES_WEB_BRIDGE__?: unknown
  __HERMES_WEB_ACTIVE_PROFILE__?: string
  __HERMES_WEB_DRAFT_SNAPSHOT__?: unknown
  __HERMES_WEB_DRAFT_BLOCKED__?: boolean
}
declare module '*.css' { const value: string; export default value }
`
const transformDiagnostic = diagnostic => `${diagnostic.code}:${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`
const transformDiagnostics = (filename, code) => {
  const virtualSources = new Map([
    [path.resolve(filename), code],
    [transformValidationAmbientFile, transformValidationAmbient]
  ])
  const host = ts.createCompilerHost(transformValidationOptions)
  const read = host.readFile.bind(host)
  const exists = host.fileExists.bind(host)
  host.readFile = name => virtualSources.get(path.resolve(name)) ?? read(name)
  host.fileExists = name => virtualSources.has(path.resolve(name)) || exists(name)
  return ts.getPreEmitDiagnostics(ts.createProgram([filename, transformValidationAmbientFile], transformValidationOptions, host)).map(transformDiagnostic)
}
const transformBindingDiagnostics = new Set([2304, 2305, 2307, 2308, 2309, 2314, 2552, 2688])

for (const fixture of compatibilityTransforms) {
  test(`compatibility: ${fixture.name}`, () => {
    const filename = path.join(repositoryRoot, 'apps/desktop/src', fixture.module)
    const source = readFileSync(filename, 'utf8')
    const result = transformRenderer(source, filename)
    assert.notEqual(result.code, source)
    assert.equal(transformRenderer(result.code, filename).code, result.code)
    assert.throws(() => transformRenderer(source + '\n// upstream change', filename), /compatibility changed/)
    assert.throws(() => transformRenderer(result.code + '\n// modified', filename), /Modified compatibility/)
    assert.equal(ts.createSourceFile(filename, result.code, ts.ScriptTarget.Latest, true).parseDiagnostics.length, 0)

    const before = transformDiagnostics(filename, source)
    const after = transformDiagnostics(filename, result.code)
    const newBindingDiagnostics = after.filter(diagnostic => {
      const code = Number(diagnostic.slice(0, diagnostic.indexOf(':')))
      return transformBindingDiagnostics.has(code) && !before.includes(diagnostic)
    })
    assert.deepEqual(newBindingDiagnostics, [], `${fixture.name} introduced a missing import or binding`)
  })
}

test('composed transform validation detects missing imports and undefined bindings', () => {
  const filename = path.join(root, 'src/.browser-transform-validation-probe.ts')
  const diagnostics = transformDiagnostics(filename, "import { missing } from './missing-module'\nconst value = undefinedBinding\n")
  assert.ok(diagnostics.some(diagnostic => diagnostic.startsWith('2307:')), 'missing imports must fail validation')
  assert.ok(diagnostics.some(diagnostic => diagnostic.startsWith('2304:')), 'undefined bindings must fail validation')
})

test('renderer aliases preserve explicit mappings before wildcards', () => {
  const aliases = rendererAliases()
  function resolve(specifier) {
    for (const alias of aliases) {
      if (typeof alias.find === 'string' && alias.find === specifier) return alias.replacement
      if (alias.find instanceof RegExp && alias.find.test(specifier)) return specifier.replace(alias.find, alias.replacement)
    }
  }
  assert.equal(resolve('@hermes/shared/billing'), path.join(root, '../shared/src/billing-types.ts'))
  assert.equal(resolve('@hermes/shared/i18n'), path.join(root, '../shared/src/i18n'))
  assert.equal(resolve('@/store/titlebar-app-actions'), path.join(root, 'src/overrides/titlebar-app-actions.ts'))
})

test('renderer imports stay within the upstream adapter', () => {
  const visit = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const filename = path.join(dir, entry.name)
      if (entry.isDirectory()) { if (entry.name !== 'upstream') visit(filename); continue }
      if (!/\.tsx?$/.test(entry.name)) continue
      const source = ts.createSourceFile(filename, readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true)
      const walk = node => {
        const module = ts.isImportDeclaration(node) || ts.isExportDeclaration(node) ? node.moduleSpecifier
          : ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword ? node.arguments[0] : null
        if (module && ts.isStringLiteral(module)) assert.ok(!/^(@\/|@hermes\/)|(?:^|\/)desktop\/|(?:^|\/)shared\//.test(module.text), `${filename}: ${module.text}`)
        ts.forEachChild(node, walk)
      }
      walk(source)
    }
  }
  visit(path.join(root, 'src'))
})


test('Vite resolves shared subpaths and wildcard-to-single-file aliases', async t => {
  const server = await createServer({ configFile: false, root, logLevel: 'silent', resolve: { alias: rendererAliases(), preserveSymlinks: true }, server: { middlewareMode: true } })
  t.after(() => server.close())
  const resolver = server.environments.client.pluginContainer
  for (const [specifier, expected] of [
    ['@hermes/shared/translucency', '../shared/src/translucency.ts'],
    ['@hermes/shared/i18n', '../shared/src/i18n.ts'],
    ['@/debug/right-pane-events', 'src/debug-dev-only.ts']
  ]) {
    const resolved = await resolver.resolveId(specifier, path.join(root, 'src/entry.ts'))
    assert.equal(resolved.id, path.resolve(root, expected))
  }
})
