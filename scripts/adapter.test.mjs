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
const aliasOptions = JSON.parse(readFileSync(path.join(root, 'tsconfig.aliases.json'), 'utf8')).compilerOptions

const transformValidationOptions = {
  target: ts.ScriptTarget.ES2023,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.ReactJSX,
  strict: true,
  skipLibCheck: true,
  noEmit: true,
  ignoreDeprecations: '6.0',
  baseUrl: root,
  paths: aliasOptions.paths,
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
  __HERMES_WEB_FLUSH_DRAFTS__?: () => Promise<void>
}
declare module '*.css' { const value: string; export default value }
`
const transformDiagnostic = diagnostic => `${diagnostic.code}:${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`
const transformedRendererSources = new Map()
for (const fixture of compatibilityTransforms) {
  const filename = path.join(repositoryRoot, 'apps/desktop/src', fixture.module)
  const source = readFileSync(filename, 'utf8')
  transformedRendererSources.set(path.resolve(filename), transformRenderer(source, filename).code)
}
const transformedRendererDiagnostics = new Map([...transformedRendererSources.keys()].map(filename => [filename, []]))
{
  const virtualSources = new Map([
    ...transformedRendererSources,
    [transformValidationAmbientFile, transformValidationAmbient]
  ])
  const host = ts.createCompilerHost(transformValidationOptions)
  const read = host.readFile.bind(host)
  const exists = host.fileExists.bind(host)
  host.readFile = name => virtualSources.get(path.resolve(name)) ?? read(name)
  host.fileExists = name => virtualSources.has(path.resolve(name)) || exists(name)
  host.resolveModuleNames = (names, containing) => names.map(name => ts.resolveModuleName(name, containing, transformValidationOptions, host).resolvedModule)
  const program = ts.createProgram([...transformedRendererSources.keys(), transformValidationAmbientFile], transformValidationOptions, host)
  for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
    const filename = diagnostic.file && path.resolve(diagnostic.file.fileName)
    if (filename && transformedRendererDiagnostics.has(filename)) transformedRendererDiagnostics.get(filename).push(transformDiagnostic(diagnostic))
  }
}
const transformDiagnostics = (filename, code) => {
  const virtualSources = new Map([
    ...transformedRendererSources,
    [transformValidationAmbientFile, transformValidationAmbient]
  ])
  virtualSources.set(path.resolve(filename), code)
  const host = ts.createCompilerHost(transformValidationOptions)
  const read = host.readFile.bind(host)
  const exists = host.fileExists.bind(host)
  host.readFile = name => virtualSources.get(path.resolve(name)) ?? read(name)
  host.fileExists = name => virtualSources.has(path.resolve(name)) || exists(name)
  host.resolveModuleNames = (names, containing) => names.map(name => ts.resolveModuleName(name, containing, transformValidationOptions, host).resolvedModule)
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

    const bindingDiagnostics = transformedRendererDiagnostics.get(path.resolve(filename)).filter(diagnostic => {
      const code = Number(diagnostic.slice(0, diagnostic.indexOf(':')))
      return transformBindingDiagnostics.has(code)
    })
    assert.deepEqual(bindingDiagnostics, [], `${fixture.name} introduced a missing import or binding`)
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

test('Vite resolves compatibility aliases to one React runtime and the raw tour asset', async t => {
  const { compatibilityAliases, compatibilitySingletons } = await import('./aliases.mjs')
  const declared = compatibilityAliases(root)
  const aliases = [...declared.filter(alias => alias.find === '@/debug/dev-only'), ...rendererAliases(), ...declared.filter(alias => alias.find !== '@/debug/dev-only')]
  const server = await createServer({ configFile: false, root, logLevel: 'silent', resolve: { alias: aliases, dedupe: compatibilitySingletons(root), preserveSymlinks: true }, optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true } })
  t.after(() => server.close())
  const resolver = server.environments.client.pluginContainer
  for (const specifier of ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom']) {
    const wrapper = await resolver.resolveId(specifier, path.join(root, 'src/entry.ts'))
    const renderer = await resolver.resolveId(specifier, path.join(root, '../desktop/src/sdk/index.ts'))
    assert.ok(wrapper?.id)
    assert.equal(wrapper.id, renderer.id, `${specifier} must use the same runtime`)
  }
  const tour = await resolver.resolveId('driver.js/dist/driver.js.iife.js?raw', path.join(root, '../desktop/src/sdk/index.ts'))
  assert.equal(tour.id, path.resolve(root, '../../node_modules/driver.js/dist/driver.js.iife.js') + '?raw')
  assert.ok(readFileSync(tour.id.split('?')[0], 'utf8').length > 0)
  const debug = await resolver.resolveId('@/debug/dev-only', path.join(root, 'src/entry.ts'))
  assert.equal(debug.id, path.resolve(root, '../desktop/src/debug/dev-only.noop.ts'))
  assert.equal(compatibilityAliases(root, { VITE_PERF_PROBE: '1' }).find(alias => alias.find === '@/debug/dev-only').replacement, path.resolve(root, '../desktop/src/debug/dev-only.ts'))
})

const browserBoundaryAliases = rendererAliases()
const withinDirectory = (filename, directory) => {
  const relative = path.relative(directory, filename)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}
function assertBrowserModelBoundary(source, filename) {
  const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true)
  const walk = node => {
    const module = ts.isImportDeclaration(node) || ts.isExportDeclaration(node) ? node.moduleSpecifier
      : ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) ? node.moduleReference.expression
      : ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) ? node.argument.literal
      : ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === 'require') ? node.arguments[0] : null
    if (module) {
      assert.ok(ts.isStringLiteralLike(module), `${filename}: module imports must be statically inspectable`)
      const specifier = module.text.split('?')[0]
      const alias = browserBoundaryAliases.find(entry => entry.find.test(specifier))
      const resolved = alias ? specifier.replace(alias.find, alias.replacement)
        : specifier.startsWith('.') || path.isAbsolute(specifier) ? path.resolve(path.dirname(filename), specifier) : null
      if (resolved) {
        for (const directory of ['desktop', 'shared']) {
          assert.ok(!withinDirectory(resolved, path.join(repositoryRoot, 'apps', directory)), `${filename}: renderer imports must go through browser adapters`)
        }
      }
      if (resolved && withinDirectory(resolved, path.join(root, 'src/upstream'))) {
        const bindings = ts.isImportDeclaration(node) ? node.importClause?.namedBindings
          : ts.isExportDeclaration(node) ? node.exportClause : null
        assert.ok(bindings && (ts.isNamedImports(bindings) || ts.isNamedExports(bindings)), `${filename}: use explicit browser model imports`)
        for (const binding of bindings.elements) assert.ok(!(binding.propertyName || binding.name).text.startsWith('$'), `${filename}: raw upstream store import`)
      }
    }
    ts.forEachChild(node, walk)
  }
  walk(tree)
}

test('browser features cannot acquire raw upstream stores through aliases or namespaces', () => {
  const filename = path.join(root, 'src/experience/feature.ts')
  for (const source of [
    "import { $sessions as rows } from '../upstream/browser-api'",
    "import * as runtime from '../upstream/browser-api'",
    "export { $sessions as rows } from '../upstream/browser-api'",
    "export * from '../upstream/browser-api'",
    "const runtime = await import('../upstream/browser-api')",
    "import { $sessions as rows } from '@/store/session'",
    "import * as store from '@/store/session'",
    "import '@/store/session'",
    "export { $sessions as rows } from '../../../desktop/src/store/session'",
    "const store = await import(`@/plugins/hermes-bots/shared`)",
    "const store = require('@/store/session')",
    "import store = require('@/store/session')",
    "type Store = typeof import('@/store/session')",
    "import { openSession } from '@hermes/plugin-sdk'",
    "import type { Profile } from '@hermes/shared'",
    "export * from '../upstream/../upstream/browser-api'",
    "const store = await import('@/store/' + name)"
  ]) assert.throws(() => assertBrowserModelBoundary(source, filename), source)
  for (const source of [
    "import { useBrowserConversation as useConversation } from '../upstream/conversation'",
    "import type { ConversationIdentity } from './contracts/conversation'",
    "import { ToolbarButton } from './ui/toolbar-button'",
    "import React from 'react'"
  ]) assertBrowserModelBoundary(source, filename)
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(filename)
      else if (/\.tsx?$/.test(filename)) assertBrowserModelBoundary(readFileSync(filename, 'utf8'), filename)
    }
  }
  for (const directory of ['experience', 'overrides']) visit(path.join(root, 'src', directory))
  const barrel = ts.createSourceFile('browser-api.tsx', readFileSync(path.join(root, 'src/upstream/browser-api.tsx'), 'utf8'), ts.ScriptTarget.Latest, true)
  for (const statement of barrel.statements) {
    if (!ts.isExportDeclaration(statement)) continue
    assert.ok(statement.exportClause && ts.isNamedExports(statement.exportClause), 'UI compatibility exports must be explicit')
    for (const entry of statement.exportClause.elements) assert.ok(!(entry.propertyName || entry.name).text.startsWith('$'), 'UI compatibility barrel must not expose raw stores')
  }
})
