import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'
const root = path.resolve('apps/web-desktop')
function load(file, globals = {}) {
  const filename = path.join(root, file)
  const context = vm.createContext({ exports: {}, require: createRequire(filename), ...globals })
  vm.runInContext(ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, context)
  return context.exports
}
const { comparisonPlugin, scopeComparisonStorage } = load('src/upstream/comparison-plugin.ts')
test('browser microphone capture distinguishes insecure origins and lets getUserMedia own permission', async () => {
  const { useBrowserMicrophoneCapture } = load('src/upstream/comparison-plugin.ts')
  const source = readFileSync(path.join(root, '../desktop/src/app/chat/composer/hooks/use-mic-recorder.ts'), 'utf8')
  const output = useBrowserMicrophoneCapture(source)
  assert.doesNotMatch(output, /requestMicrophoneAccess/)
  assert.throws(() => useBrowserMicrophoneCapture(source.replace('navigator.mediaDevices?.getUserMedia', 'navigator.getUserMedia')), /capture target changed/)
  const context = vm.createContext({
    exports: {}, DOMException,
    window: { isSecureContext: false }, navigator: {},
    require: () => ({ useState: value => [value, () => {}], useRef: current => ({ current }), useEffect: () => {} })
  })
  vm.runInContext(ts.transpileModule(output, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context)
  const copy = { microphoneUnsupported: 'Unsupported', microphoneAccessDenied: 'Access denied', microphonePermissionDenied: 'Permission denied', noMicrophone: 'No microphone' }
  const { handle } = context.exports.useMicRecorder(copy)
  await assert.rejects(handle.start(), /HTTPS or localhost/)
  context.window.isSecureContext = true
  await assert.rejects(handle.start(), /Unsupported/)
  context.MediaRecorder = class {}
  context.navigator.mediaDevices = { getUserMedia: async () => { throw new DOMException('Blocked', 'NotAllowedError') } }
  await assert.rejects(handle.start(), /browser settings/)
  context.navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Missing', 'NotFoundError') }
  await assert.rejects(handle.start(), /No microphone/)
})

test('comparison shell contracts reject missing or changed upstream modules', t => {
  comparisonPlugin(root).buildStart()
  const fixture = mkdtempSync(path.join(tmpdir(), 'comparison-contract-'))
  t.after(() => rmSync(fixture, { recursive: true, force: true }))
  mkdirSync(path.join(fixture, 'desktop/src/app'), { recursive: true })
  const plugin = comparisonPlugin(path.join(fixture, 'web-desktop'))
  assert.throws(() => plugin.buildStart(), /ENOENT/)
  writeFileSync(path.join(fixture, 'desktop/src/app/index.tsx'), 'changed')
  assert.throws(() => plugin.buildStart(), /Comparison integration changed: app\/index.tsx/)
})
test('browser layout storage is isolated, deterministic and checked without moving shared drafts', () => {
  const filename = '../desktop/src/lib/storage.ts'
  const source = readFileSync(path.join(root, filename), 'utf8')
  const output = scopeComparisonStorage(source)
  assert.equal(scopeComparisonStorage(output), output)
  assert.throws(() => scopeComparisonStorage(source + '\n// upstream change'), /no longer matches/)
  assert.throws(() => scopeComparisonStorage(output.replace("key = 'hermes-web.browser.' + key", "key = 'bad'")), /no longer matches/)
  const store = new Map()
  const context = vm.createContext({ exports: {}, require: createRequire(path.join(root, filename)), document: { documentElement: { dataset: { experience: 'browser' } } }, localStorage: { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: key => store.delete(key) } })
  context.window = { localStorage: context.localStorage }
  vm.runInContext(ts.transpileModule(output, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context)
  const { readKey, writeKey } = context.exports
  writeKey('hermes.desktop.layout.tree', 'browser-layout')
  writeKey('hermes.desktop.composerDrafts', 'shared-draft')
  writeKey('hermes.desktop.theme', 'dark')
  assert.equal(store.get('hermes-web.browser.hermes.desktop.layout.tree'), 'browser-layout')
  assert.equal(store.get('hermes.desktop.composerDrafts'), 'shared-draft')
  assert.equal(store.get('hermes.desktop.theme'), 'dark')
  context.document.documentElement.dataset.experience = 'desktop'
  assert.equal(readKey('hermes.desktop.layout.tree'), 'browser-layout')
  writeKey('hermes.desktop.layout.tree', 'desktop-layout')
  context.document.documentElement.dataset.experience = 'browser'
  assert.equal(readKey('hermes.desktop.layout.tree'), 'desktop-layout')
})
test('browser selection always initializes the browser-focused shell', () => {
  const globals = { document: { documentElement: { dataset: {} } } }
  const selection = load('src/experience/selection.ts', globals)
  selection.initializeComparison()
  assert.equal(globals.document.documentElement.dataset.experience, 'browser')
})

test('browser shell does not register chat tab creation actions', () => {
  const { disableBrowserSessionTabs } = load('src/upstream/comparison-plugin.ts')
  const source = readFileSync(path.join(root, '../desktop/src/app/contrib/wiring.tsx'), 'utf8')
  const output = disableBrowserSessionTabs(source)
  assert.doesNotMatch(output, /\n    openNewSessionTab,\n/)
  assert.match(output, /\$newSessionTabAction\.set\(null\)/)
  assert.equal(disableBrowserSessionTabs(output), output)
})

test('browser startup keeps shared controller registration without rendering desktop UI', () => {
  const initializer = readFileSync(path.join(root, 'src/upstream/comparison-initialize.ts'), 'utf8')
  const browserRoot = readFileSync(path.join(root, 'src/upstream/comparison-root.tsx'), 'utf8')
  assert.match(initializer, /import ['"]\.\.\/\.\.\/\.\.\/desktop\/src\/app\/contrib\/controller['"];?/)
  assert.match(browserRoot, /import ['"]\.\/comparison-initialize['"];?/)
  assert.doesNotMatch(browserRoot, /ContribController/)
})

test('browser settings remove desktop-only keybind rows', () => {
  const { filterBrowserKeybinds } = load('src/upstream/comparison-plugin.ts')
  const source = readFileSync(path.join(root, '../desktop/src/app/settings/keybind-settings.tsx'), 'utf8')
  const output = filterBrowserKeybinds(source)
  assert.match(output, /BROWSER_UNSUPPORTED_KEYBINDS/)
  assert.match(output, /allKeybindActions\(contributions\)\.filter/)
  assert.match(output, /browserReadonly\.filter/)
  assert.equal(filterBrowserKeybinds(output), output)
  assert.throws(() => filterBrowserKeybinds(source.replace("const [query, setQuery] = useState('')", "const [query, setQuery] = useState('changed')")), /keybind contract changed/)
})

test('browser session rows resume chats instead of opening tabs or windows', () => {
  const { disableBrowserSessionRowTabs } = load('src/upstream/comparison-plugin.ts')
  const source = readFileSync(path.join(root, '../desktop/src/app/chat/sidebar/session-row.tsx'), 'utf8')
  const output = disableBrowserSessionRowTabs(source)
  assert.doesNotMatch(output, /openSession\(session\.id, \(\) => undefined, '(?:tab|window)'\)/)
  assert.equal((output.match(/onResume\(\)/g) || []).length, (source.match(/onResume\(\)/g) || []).length + 3)
})

test('browser session menus omit tab and window actions', () => {
  const { disableBrowserSessionOpenActions } = load('src/upstream/comparison-plugin.ts')
  const source = readFileSync(path.join(root, '../desktop/src/app/chat/sidebar/session-actions-menu.tsx'), 'utf8')
  const output = disableBrowserSessionOpenActions(source)
  assert.doesNotMatch(output, /surface === 'row' && !alreadyTabbed/)
  assert.doesNotMatch(output, /canOpenSessionWindow\(\)/)
  assert.match(output, /canOpenSessionInTerminal\(\)/)
})

test('browser workspace removes chat tabs while retaining tool groups', () => {
  const { browserWorkspaceTree } = load('src/upstream/workspace-tree.ts')
  const tree = { type: 'split', id: 'root', orientation: 'row', weights: [1, 3, 1], children: [
    { type: 'group', id: 'navigation', panes: ['sessions', 'hermes-bots:pane'], active: 'sessions' },
    { type: 'group', id: 'main', panes: ['workspace', 'session-tile:one', 'route-tile:settings'], active: 'session-tile:one' },
    { type: 'group', id: 'tools', panes: ['terminal', 'preview-tile:file', 'plugin:tool'], active: 'terminal' }
  ] }
  const result = browserWorkspaceTree(tree)
  assert.equal(result.children.length, 2)
  assert.equal(result.children[0].active, 'session-tile:one')
  assert.equal(result.children[1].active, 'preview-tile:file')
  assert.deepEqual(Array.from(result.weights), [3, 1])
  assert.deepEqual(Array.from(result.children[1].panes), ['preview-tile:file', 'plugin:tool'])
  assert.equal(tree.children[2].active, 'terminal', 'Projection must leave upstream layout state untouched')
  const withPanels = browserWorkspaceTree(tree, new Set(['plugin:tool']))
  assert.equal(withPanels.children[1].tabStrip, 'always', 'Contributed panels must retain a close handle')
  assert.equal(withPanels.children[0].tabStrip, 'never', 'The browser chat group must not expose tabs')
  assert.equal(tree.children[2].tabStrip, undefined, 'Close handles must not rewrite the saved layout')
})
test('narrow tool overlays retain upstream behavior without duplicating browser navigation', () => {
  const { filterBrowserNarrowNavigation } = load('src/upstream/comparison-plugin.ts')
  const source = readFileSync(path.join(root, '../desktop/src/components/pane-shell/tree/renderer/narrow-overlays.tsx'), 'utf8')
  const output = filterBrowserNarrowNavigation(source)
  assert.equal(filterBrowserNarrowNavigation(output), output)
  assert.throws(() => filterBrowserNarrowNavigation(source + '\n// drift'), /contract changed/)
  assert.match(output, /Close \$\{revealed.title \?\? revealed.id\} panel/)
  assert.throws(() => filterBrowserNarrowNavigation(output.replace('closeTabPane(revealed.id)', 'closeTabPane("files")')), /contract changed/)
})

test('empty workspace panels retain a working close action', () => {
  const { closeBrowserWorkspacePanels } = load('src/upstream/comparison-plugin.ts')
  const source = readFileSync(path.join(root, '../desktop/src/components/pane-shell/tree/store.ts'), 'utf8')
  const output = closeBrowserWorkspacePanels(source)
  assert.equal(closeBrowserWorkspacePanels(output), output)
  assert.throws(() => closeBrowserWorkspacePanels(source + '\n// drift'), /close contract changed/)
  assert.match(output, /\['files', 'review'\].includes\(paneId\)/)
  assert.throws(() => closeBrowserWorkspacePanels(output.replace('setTreePaneHidden(paneId, true)', 'setTreePaneHidden(paneId, false)')), /close contract changed/)
})

test('browser status chrome reuses the checked upstream item renderer', () => {
  const { exportBrowserStatusbarItem } = load('src/upstream/comparison-plugin.ts')
  const source = readFileSync(path.join(root, '../desktop/src/app/shell/statusbar-controls.tsx'), 'utf8')
  const output = exportBrowserStatusbarItem(source)
  assert.equal(exportBrowserStatusbarItem(output), output)
  assert.throws(() => exportBrowserStatusbarItem(source + '\n// drift'), /statusbar item contract changed/)
  assert.equal(output.replace('export const StatusbarItemView', 'const StatusbarItemView'), source)
})

test('startup recovery retries a module-load failure once and never loops with blocked storage', () => {
  const store = new Map(); let reloads = 0
  const sessionStorage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: key => store.delete(key) }
  const recovery = load('src/platform/startup-recovery.ts', { Error, sessionStorage, window: { location: { reload: () => reloads++ } } })
  const interrupted = new Error('Failed to fetch dynamically imported module: /assets/entry.js')
  assert.equal(recovery.recoverStartupChunk(new Error('Invalid configuration'), 'build'), false)
  assert.equal(recovery.recoverStartupChunk(interrupted, 'build'), true)
  assert.equal(recovery.recoverStartupChunk(interrupted, 'build'), false)
  assert.equal(reloads, 1)
  recovery.completeStartup()
  assert.equal(recovery.recoverStartupChunk(interrupted, 'build'), true)
  sessionStorage.getItem = () => { throw new Error('Blocked') }
  assert.equal(recovery.recoverStartupChunk(interrupted, 'other-build'), false)
  assert.equal(reloads, 2)
})
