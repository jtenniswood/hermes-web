import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'

const root = path.resolve('apps/web-desktop')
function load(file, mocks) {
  const filename = path.join(root, file)
  const context = vm.createContext({ exports: {}, require: mocks || createRequire(filename) })
  vm.runInContext(ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, context)
  return context.exports
}
const source = module => readFileSync(path.join(root, '../desktop/src', module), 'utf8')

test('sidebar preferences migrate known legacy identities without consulting current labels', () => {
  const { readHiddenSections, HIDDEN_SECTIONS_KEY } = load('src/experience/sidebar-section-preferences.ts')
  const storage = new Map()
  const read = () => Array.from(readHiddenSections({ getItem: key => storage.get(key) ?? null }))
  storage.set('hermes-web.browser.pinned-section-hidden', 'true')
  storage.set('hermes-web.browser.cron-section-hidden', 'true')
  assert.deepEqual(read(), ['pinned', 'cron-jobs'])
  storage.set(HIDDEN_SECTIONS_KEY, JSON.stringify(['projects', 'sessions', 'slack', 'imessage', 'api', 42, '__proto__', 'old-project']))
  assert.deepEqual(read(), ['messaging:slack', 'messaging:bluebubbles', 'messaging:api_server', '__proto__', 'old-project'])
  storage.set(HIDDEN_SECTIONS_KEY, JSON.stringify({ version: 2, hidden: ['messaging:slack', 'pinned', 'pinned', null] }))
  assert.deepEqual(read(), ['messaging:slack', 'pinned'])
  storage.set(HIDDEN_SECTIONS_KEY, '[]')
  assert.deepEqual(read(), [], 'An explicit empty preference supersedes the legacy flags')
  storage.set(HIDDEN_SECTIONS_KEY, '{')
  assert.deepEqual(read(), [])
  assert.deepEqual(Array.from(readHiddenSections({ getItem() { throw Error('Blocked') } })), [])
})

test('semantic adapters preserve identity and reject upstream drift', () => {
  const api = load('src/upstream/browser-plugin.ts')
  const sidebar = source('app/chat/sidebar/index.tsx')
  const adapted = api.useBrowserSectionIds(sidebar)
  assert.match(adapted, /browserSectionId="sessions" label=\{sessionsLabel\}/)
  assert.match(adapted, /browserSectionId=\{`messaging:\$\{group.sourceId\}`\}/)
  assert.throws(() => api.useBrowserSectionIds(sidebar.replace('label={sessionsLabel}', 'label={otherLabel}')), /target changed/)
  for (const name of ['sessions', 'cron-jobs']) {
    const output = api.useBrowserSectionIdentity(source(`app/chat/sidebar/${name}-section.tsx`), root)
    assert.match(output, /<SidebarGroup \{\.\.\.browserSection\}/)
    assert.match(output, /useBrowserSidebarSection\([^\n]*label\)/)
  }
  // An upstream icon change cannot alter which notice the browser suppresses.
  const updates = api.omitBrowserDesktopUpdateNotice(source('store/updates.ts').replace("icon: 'gift'", "icon: 'bell'"))
  assert.match(updates, /export function maybeNotifyUpdateAvailable[^\n]+\{\}/)
  assert.doesNotMatch(updates, /icon: 'bell'/)
  for (const module of ['components/desktop-install-overlay.tsx', 'components/first-run-remote-form.tsx']) {
    const output = api.useBrowserSetupHooks(source(module))
    const count = module.includes('desktop-install') ? 3 : 1
    assert.equal(output.split('data-browser-overlay="setup"').length - 1, count)
    assert.equal(output.split('data-browser-overlay-card="setup"').length - 1, count)
  }

  const registry = JSON.parse(readFileSync(path.join(root, 'src/upstream/compatibility-registry.json')))
  const plugin = api.browserPlugin(root)
  for (const entry of registry.filter(entry => entry.kind === 'browser-transform' && entry.tests.some(t => t.file === 'scripts/sidebar-contracts.test.mjs'))) {
    const selectedPlugin = entry.order === 40 ? api.browserActivityNotificationsPlugin(root) : plugin
    const input = entry.order === 40
      ? load('src/upstream/transforms.ts').transformRenderer(source(entry.module), `/desktop/src/${entry.module}`).code
      : source(entry.module)
    const output = selectedPlugin.transform(input, `/desktop/src/${entry.module}`).code
    const parsed = ts.createSourceFile(entry.module, output, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    assert.equal(parsed.parseDiagnostics.length, 0, entry.module)
    assert.equal(selectedPlugin.transform(output, `/desktop/src/${entry.module}`).code, output)
  }
})
