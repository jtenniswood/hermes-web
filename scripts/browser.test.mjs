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
const { browserPlugin, scopeBrowserStorage } = load('src/upstream/browser-plugin.ts')
test('browser omits generic activity toasts while preserving unread tracking and incoming messages', () => {
  const { filterBrowserActivityToasts, browserActivityNotificationsPlugin } = load('src/upstream/browser-plugin.ts')
  const filename = path.join(root, '../desktop/src/plugins/hermes-bots/roster-actions.ts')
  const source = readFileSync(filename, 'utf8')
  const output = filterBrowserActivityToasts(source)
  const { transformRenderer } = load('src/upstream/transforms.ts')
  const compatible = transformRenderer(source, filename).code
  assert.equal(browserActivityNotificationsPlugin().transform(compatible, filename).code, filterBrowserActivityToasts(compatible))
  assert.throws(() => filterBrowserActivityToasts(source.replace('host.notify({', 'host.changed({')), /notification target changed/)
  const notifications = [], unread = []
  const mocks = {
    atom: value => ({ get: () => value, set: next => { value = next } }),
    host: { notify: notice => notifications.push(notice) },
    markSessionUnreadFinished: id => unread.push(id),
    $selectedBot: { get: () => null },
    rosterWatermarks: new Map(),
    botSelectionKey: bot => bot.name,
    botActivitySession: bot => bot.activity,
    botCanonicalSessionId: bot => bot.id,
    $botMeta: { get: () => ({}) },
    botRosterMeta: () => undefined,
    displayName: bot => bot.name
  }
  const context = vm.createContext({ exports: {}, require: () => mocks })
  vm.runInContext(ts.transpileModule(output, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context)
  const { $activityToasts, trackInboundActivity } = context.exports
  $activityToasts.set(true)
  const poll = (last_active, preview) => trackInboundActivity([{ id: 'bot-chat', name: 'Hermes', activity: { last_active, preview } }])
  poll(1, '') // Seed the watermark without announcing old activity.
  poll(2, '')
  poll(3, 'Background task completed')
  assert.equal(notifications.length, 0)
  assert.deepEqual(unread, ['bot-chat', 'bot-chat'])
  poll(4, 'Message from Alice: hello')
  assert.equal(notifications.length, 1)
  assert.equal(notifications[0].message, 'Message from Alice: hello')
  assert.equal(unread.length, 3)
})

test('browser owns the Bots toolbar instead of rewriting upstream toolbar JSX', () => {
  const { browserActivityNotificationsPlugin } = load('src/upstream/browser-plugin.ts')
  const filename = path.join(root, '../desktop/src/plugins/hermes-bots/roster-pane-toolbar.tsx')
  const source = readFileSync(filename, 'utf8')
  const plugin = browserActivityNotificationsPlugin()
  assert.equal(plugin.transform(source, filename), null)
  const wrapper = readFileSync(path.join(root, 'src/experience/browser-bots-toolbar.tsx'), 'utf8')
  assert.match(wrapper, /<DropdownMenuSubTrigger>Show<\/DropdownMenuSubTrigger>/)
  assert.match(wrapper, /<DropdownMenuSubTrigger>Filter by time<\/DropdownMenuSubTrigger>/)
  assert.match(wrapper, /Show hidden bots/)
  assert.match(wrapper, /<Codicon name="add" size="0\.75rem" \/>/)
  assert.match(wrapper, /<Codicon name="list-filter" size="0\.75rem" \/>/)
})

test('browser sidebar hides the new-session keyboard shortcut hint', () => {
  const { browserPlugin, removeBrowserNewSessionShortcut } = load('src/upstream/browser-plugin.ts')
  const filename = path.join(root, '../desktop/src/app/chat/sidebar/index.tsx')
  const source = readFileSync(filename, 'utf8')
  const output = removeBrowserNewSessionShortcut(source)
  assert.doesNotMatch(output, /KbdGroup/)
  assert.equal(removeBrowserNewSessionShortcut(output), output)
  assert.equal(browserPlugin(root).transform(source, filename).code.includes('KbdGroup'), false)
  assert.throws(() => removeBrowserNewSessionShortcut(source.replace('<KbdGroup', '<KbdHint')), /target changed/)
})

test('browser moves hidden Bots into the normal roster when the filter option is enabled', () => {
  const { browserPlugin, showHiddenBotsInBrowserRoster } = load('src/upstream/browser-plugin.ts')
  const filename = path.join(root, '../desktop/src/plugins/hermes-bots/roster-pane-derivation.ts')
  const source = readFileSync(filename, 'utf8')
  const output = showHiddenBotsInBrowserRoster(source)
  assert.match(output, /const showHiddenBots = \$showHiddenBots\.get\(\)/)
  assert.match(output, /const hiddenBots: RosterRow\[\] = \[\]/)
  assert.match(output, /const visibleRoster = showHiddenBots \? roster : roster\.filter/)
  assert.equal(showHiddenBotsInBrowserRoster(output), output)
  assert.equal(browserPlugin(root).transform(source, filename).code, output)
  assert.throws(() => showHiddenBotsInBrowserRoster(source.replace('const visibleRoster', 'const visibleBots')), /target changed/)
})

test('browser bot menus omit the new-chat shortcut', () => {
  const { browserPlugin, removeBrowserNewBotChatAction, removeBrowserOpenBotChatAction } = load('src/upstream/browser-plugin.ts')
  const filename = path.join(root, '../desktop/src/plugins/hermes-bots/bot-row.tsx')
  const source = readFileSync(filename, 'utf8')
  const output = removeBrowserNewBotChatAction(source)
  assert.doesNotMatch(output, /newBotChat\(bot\)|b\.bot\.newChatWith/)
  assert.doesNotMatch(output, /saveSelectedRosterBot|setBotsWorkspaceOwner|botWorkspaceOwnerKey/)
  assert.match(output, /import \{ botRosterMeta \} from '\.\/routing'/)
  assert.equal(removeBrowserNewBotChatAction(output), output)
  assert.equal(browserPlugin(root).transform(source, filename).code, removeBrowserNewBotChatAction(removeBrowserOpenBotChatAction(source)))
  assert.throws(() => removeBrowserNewBotChatAction(source.replace('newBotChat(bot)', 'newChat(bot)')), /target changed/)
})

test('browser bot menus omit the open-chat shortcut', () => {
  const { browserPlugin, removeBrowserNewBotChatAction, removeBrowserOpenBotChatAction } = load('src/upstream/browser-plugin.ts')
  const filename = path.join(root, '../desktop/src/plugins/hermes-bots/bot-row.tsx')
  const source = readFileSync(filename, 'utf8')
  const output = removeBrowserOpenBotChatAction(source)
  assert.doesNotMatch(output, /b\.bot\.openBotChat/)
  assert.doesNotMatch(output, /onSelect=\{\(\) => void openRosterBot\(bot\)\}/)
  assert.equal(removeBrowserOpenBotChatAction(output), output)
  assert.equal(browserPlugin(root).transform(source, filename).code, removeBrowserNewBotChatAction(output))
  assert.throws(() => removeBrowserOpenBotChatAction(source.replace('<ContextMenuItem onSelect={() => void openRosterBot(bot)}>', '<ContextMenuItem onSelect={() => void openRosterBot(otherBot)}>')), /target changed/)
})

test('browser approval modes have distinct menu and toolbar icons', () => {
  const { browserPlugin } = load('src/upstream/browser-plugin.ts')
  const filename = path.join(root, '../desktop/src/app/shell/approval-mode-menu.tsx')
  const source = readFileSync(filename, 'utf8')
  assert.equal(browserPlugin(root).transform(source, filename), null)
  const output = readFileSync(path.join(root, 'src/experience/browser-approval-mode-menu.tsx'), 'utf8')
  assert.match(output, /Brain.*Power.*ShieldLock.*from ''..\/upstream\/browser-api''/)
  assert.match(output, /<ApprovalModeIcon mode=\{mode\} \/>/)
  assert.match(output, /smart: 'Ask when needed'/)
  assert.doesNotMatch(output, /DropdownMenuSeparator/)
})

test('browser microphone capture distinguishes insecure origins and lets getUserMedia own permission', async () => {
  const { useBrowserMicrophoneCapture } = load('src/upstream/browser-plugin.ts')
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

test('browser shell contracts reject missing or changed upstream modules', t => {
  browserPlugin(root).buildStart()
  const fixture = mkdtempSync(path.join(tmpdir(), 'browser-contract-'))
  t.after(() => rmSync(fixture, { recursive: true, force: true }))
  mkdirSync(path.join(fixture, 'desktop/src/app'), { recursive: true })
  const plugin = browserPlugin(path.join(fixture, 'web-desktop'))
  assert.throws(() => plugin.buildStart(), /ENOENT/)
  writeFileSync(path.join(fixture, 'desktop/src/app/index.tsx'), 'changed')
  assert.throws(() => plugin.buildStart(), /Browser integration changed: app\/index.tsx/)
})
test('browser layout storage is isolated, deterministic and checked without moving shared drafts', () => {
  const filename = '../desktop/src/lib/storage.ts'
  const source = readFileSync(path.join(root, filename), 'utf8')
  const output = scopeBrowserStorage(source)
  assert.equal(scopeBrowserStorage(output), output)
  assert.throws(() => scopeBrowserStorage(source + '\n// upstream change'), /no longer matches/)
  assert.throws(() => scopeBrowserStorage(output.replace("key = 'hermes-web.browser.' + key", "key = 'bad'")), /no longer matches/)
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
  const experience = load('src/experience/browser-experience.ts', globals)
  experience.initializeBrowserExperience()
  assert.equal(globals.document.documentElement.dataset.experience, 'browser')
})

test('browser shell does not register chat tab creation actions', () => {
  const { disableBrowserSessionTabs } = load('src/upstream/browser-plugin.ts')
  const source = readFileSync(path.join(root, '../desktop/src/app/contrib/wiring.tsx'), 'utf8')
  const output = disableBrowserSessionTabs(source)
  assert.doesNotMatch(output, /\n    openNewSessionTab,\n/)
  assert.match(output, /\$newSessionTabAction\.set\(null\)/)
  assert.equal(disableBrowserSessionTabs(output), output)
})

test('browser startup keeps shared controller registration without rendering desktop UI', () => {
  const initializer = readFileSync(path.join(root, 'src/upstream/browser-initialize.ts'), 'utf8')
  const browserRoot = readFileSync(path.join(root, 'src/upstream/browser-root.tsx'), 'utf8')
  assert.match(initializer, /import ['"]\.\.\/\.\.\/\.\.\/desktop\/src\/app\/contrib\/controller['"];?/)
  assert.match(browserRoot, /import ['"]\.\/browser-initialize['"];?/)
  assert.doesNotMatch(browserRoot, /ContribController/)
})

test('browser build has an explicit root and no desktop-root fallback', () => {
  const browserRoot = readFileSync(path.join(root, 'src/upstream/browser-root.tsx'), 'utf8')
  assert.match(browserRoot, /return <BrowserShell \/>/)
  assert.doesNotMatch(browserRoot, /ContribController/)
  assert.doesNotMatch(readFileSync(path.join(root, 'src/upstream/browser-plugin.ts'), 'utf8'), /comparison-root|comparison-plugin/)
})

test('browser settings remove desktop-only keybind rows', () => {
  const { filterBrowserKeybinds } = load('src/upstream/browser-plugin.ts')
  const source = readFileSync(path.join(root, '../desktop/src/app/settings/keybind-settings.tsx'), 'utf8')
  const output = filterBrowserKeybinds(source)
  assert.match(output, /BROWSER_UNSUPPORTED_KEYBINDS/)
  assert.match(output, /allKeybindActions\(contributions\)\.filter/)
  assert.match(output, /browserReadonly\.filter/)
  assert.equal(filterBrowserKeybinds(output), output)
  assert.throws(() => filterBrowserKeybinds(source.replace("const [query, setQuery] = useState('')", "const [query, setQuery] = useState('changed')")), /keybind contract changed/)
})

test('browser session rows resume chats instead of opening tabs or windows', () => {
  const { disableBrowserSessionRowTabs } = load('src/upstream/browser-plugin.ts')
  const source = readFileSync(path.join(root, '../desktop/src/app/chat/sidebar/session-row.tsx'), 'utf8')
  const output = disableBrowserSessionRowTabs(source)
  assert.doesNotMatch(output, /openSession\(session\.id, \(\) => undefined, '(?:tab|window)'\)/)
  assert.equal((output.match(/onResume\(\)/g) || []).length, (source.match(/onResume\(\)/g) || []).length + 3)
})

test('browser session menus omit tab and window actions', () => {
  const { disableBrowserSessionOpenActions } = load('src/upstream/browser-plugin.ts')
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
  const { filterBrowserNarrowNavigation } = load('src/upstream/browser-plugin.ts')
  const source = readFileSync(path.join(root, '../desktop/src/components/pane-shell/tree/renderer/narrow-overlays.tsx'), 'utf8')
  const output = filterBrowserNarrowNavigation(source)
  assert.equal(filterBrowserNarrowNavigation(output), output)
  assert.throws(() => filterBrowserNarrowNavigation(source + '\n// drift'), /contract changed/)
  assert.match(output, /Close \$\{revealed.title \?\? revealed.id\} panel/)
  assert.throws(() => filterBrowserNarrowNavigation(output.replace('closeTabPane(revealed.id)', 'closeTabPane("files")')), /contract changed/)
})

test('empty workspace panels retain a working close action', () => {
  const { closeBrowserWorkspacePanels } = load('src/upstream/browser-plugin.ts')
  const source = readFileSync(path.join(root, '../desktop/src/components/pane-shell/tree/store.ts'), 'utf8')
  const output = closeBrowserWorkspacePanels(source)
  assert.equal(closeBrowserWorkspacePanels(output), output)
  assert.throws(() => closeBrowserWorkspacePanels(source + '\n// drift'), /close contract changed/)
  assert.match(output, /\['files', 'review'\].includes\(paneId\)/)
  assert.throws(() => closeBrowserWorkspacePanels(output.replace('setTreePaneHidden(paneId, true)', 'setTreePaneHidden(paneId, false)')), /close contract changed/)
})

test('browser status chrome reuses the checked upstream item renderer', () => {
  const { exportBrowserStatusbarItem } = load('src/upstream/browser-plugin.ts')
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
