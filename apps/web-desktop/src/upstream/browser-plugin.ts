import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import type { Plugin } from 'vite'
import registry from './compatibility-registry.json'
const contracts = registry.filter(entry => entry.sourceRoot === 'renderer' && entry.module && entry.sourceHash)
const storageScope = `\n  if (/^hermes\\.desktop\\.(?:layout|pane|sidebar|fileBrowser|rightRail|profileRail|terminal|statusbar|hiddenStrip|dismissedPanes|userPlaced)/.test(key)) key = 'hermes-web.browser.' + key\n`
const browserRootPath = (root: string): string => path.join(root, 'src/upstream/browser-root.tsx')

function assertBrowserRoot(root: string): void {
  const rootFile = browserRootPath(root)
  if (!existsSync(rootFile)) throw new Error(`Browser root is missing: ${rootFile}`)
  const source = readFileSync(rootFile, 'utf8')
  if (!source.includes('return <BrowserShell />') || source.includes('ContribController')) {
    throw new Error('Browser build root is not the browser-only shell')
  }
}
export function useBrowserPinWrites(source: string, root: string): string {
  const start = source.indexOf('function writePin(')
  const end = source.indexOf('\n/**', start)
  if (start < 0 || end < 0) throw new Error('Browser pin write owner changed')
  const imports = JSON.stringify(path.join(root, 'src/upstream/browser-pin-writes'))
  const write = `let browserPreviousPinOrder: readonly string[] = []

function writePin(id: string, pinned: boolean, profile?: null | string): void {
  const restoreIndex = browserPreviousPinOrder.indexOf(id)
  const confirmed = unconfirmed.get(id)?.value ?? loadedRowFor(id)?.pinned ?? !pinned
  unconfirmed.set(id, { at: Date.now(), value: pinned })
  queueBrowserPinWrite(id, pinned, profile, confirmed, (value, failed) => {
    // Keep the confirmed value ahead of session pages issued before this write.
    unconfirmed.set(id, { at: Date.now(), value })
    if (failed) {
      pending.delete(id)
      if (value) mirrored.add(id)
      else mirrored.delete(id)
      // Mirror bookkeeping is settled before notifying the reconciliation owner.
      if (value) pinSession(id, restoreIndex < 0 ? undefined : restoreIndex)
      else unpinSession(id)
    }
    publishUnconfirmed()
  })
}
`
  const replacements = [
    ["import { setSessionPinnedRemote } from '@/hermes'", `import { hasBrowserPinWrite, queueBrowserPinWrite, resetBrowserPinWrites } from ${imports}`],
    [source.slice(start, end), write],
    ['    if (guard && guardKey) {', '    if (hasBrowserPinWrite(pinId) || hasBrowserPinWrite(row.id)) continue\n\n    if (guard && guardKey) {'],
    ['void writePin(id, false, profileFor(id)).catch(() => {})', 'writePin(id, false, profileFor(id))'],
    [`void writePin(id, true, row.profile).catch(() => {
      // Let a later reconcile retry the mirror.
      mirrored.delete(id)
      pending.add(id)
    })`, 'writePin(id, true, row.profile)'],
    ['$pinnedSessionIds.listen(reconcile)', `$pinnedSessionIds.listen((_ids, previous) => {
    // Capture the removed pin's position before reconciliation queues its unpin.
    browserPreviousPinOrder = previous
    reconcile()
  })`],
    ['export function resetSessionPinMirror(): void {', 'export function resetSessionPinMirror(): void {\n  browserPreviousPinOrder = []\n  resetBrowserPinWrites()']
  ]
  let output = source
  for (const [before, after] of replacements) {
    if (output.split(before).length !== 2) throw new Error('Browser pin reconciliation contract changed')
    output = output.replace(before, after)
  }
  return output
}

export function useBrowserOpenSessionOwner(source: string, root: string): string {
  const target = 'export function openSession('
  if (source.split(target).length !== 2) throw new Error('Browser session entry point changed')
  const owner = JSON.stringify(path.join(root, 'src/upstream/selection-owner'))
  return `import { runBrowserSessionSelection } from ${owner}\n` + source.replace(target, 'function openEngineSession(') + `
export function openSession(
  storedSessionId: string,
  navigate: OpenSessionNavigate,
  intent: OpenSessionIntent = 'in-place',
  workspaceScope: OpenSessionWorkspaceScope = { workspaceMode: 'sessions' }
): void {
  if (!storedSessionId) return
  const bot = workspaceScope.workspaceMode === 'bots'
  // Browser navigation has one conversation surface, including palette/refs.
  const browserIntent = !bot && ['stack', 'tab', 'window'].includes(intent) ? 'in-place' : intent
  const select = () => openEngineSession(storedSessionId, navigate, browserIntent, workspaceScope)
  // Bot activation owns its existing generation and must not cancel itself.
  if (bot) select()
  else runBrowserSessionSelection(select)
}
`
}

export function useBrowserFreshSessionOwner(source: string, root: string): string {
  const start = '    (options: boolean | FreshSessionDraftOptions = false) => {'
  const end = '      setFreshDraftReady(true)\n    },'
  if (source.split(start).length !== 2 || source.split(end).length !== 2) throw new Error('Browser fresh-session owner changed')
  const owner = JSON.stringify(path.join(root, 'src/upstream/selection-owner'))
  return `import { runBrowserSessionSelection } from ${owner}\n` + source
    .replace(start, start.replace('=> {', '=> runBrowserSessionSelection(() => {'))
    .replace(end, end.replace('    },', '    }),'))
}

export function useBrowserDirectResumeOwner(source: string): string {
  const target = '    resumeStoredSession: resumeSession,'
  if (source.split(target).length !== 2) throw new Error('Browser direct resume owner changed')
  // Navigate first, so the route-resume owner cannot restore the previous route
  // while a typed /resume command loads its chosen conversation.
  return source.replace(target, '    resumeStoredSession: id => openSession(id, navigate),')
}

export function scopeBrowserStorage(source: string): string {
  const original = source.split(storageScope).join('')
  const contract = contracts.find(item => item.module === 'lib/storage.ts')!
  if (createHash('sha256').update(original).digest('hex') !== contract.sourceHash) throw new Error('Browser storage scope no longer matches upstream')
  const targets = ['export function readKey(key: string): null | string {', 'export function writeKey(key: string, value: null | string) {']
  let output = original
  for (const target of targets) {
    if (output.split(target).length !== 2) throw new Error('Browser storage scope no longer matches upstream')
    output = output.replace(target, target + storageScope)
  }
  if (source !== original && source !== output) throw new Error('Browser storage scope was partially modified')
  return output
}
export function filterBrowserNarrowNavigation(source: string): string {
  const before = 'panes.filter(p => paneChrome(p).collapsible && inTree.has(p.id)'
  const after = "panes.filter(p => !['sessions', 'hermes-bots:pane', 'terminal'].includes(p.id) && paneChrome(p).collapsible && inTree.has(p.id)"
  const headerTarget = '          {/* Zone-mates share the overlay'
  const closeHeader = `          <div className="browser-overlay-title">
            <span>{revealed.title ?? revealed.id}</span>
            <button aria-label={\`Close \${revealed.title ?? revealed.id} panel\`} onClick={() => { setReveal(null); closeTabPane(revealed.id) }}>×</button>
          </div>
`
  const replacements = [
    [before, after],
    ['import { $hiddenTreePanes, $layoutTree, $narrowViewport }', 'import { $hiddenTreePanes, $layoutTree, $narrowViewport, closeTabPane }'],
    [headerTarget, closeHeader + headerTarget]
  ]
  let original = source
  for (const [target, replacement] of replacements) original = original.replace(replacement, target)
  const contract = contracts.find(item => item.module?.endsWith('/narrow-overlays.tsx'))!
  if (createHash('sha256').update(original).digest('hex') !== contract.sourceHash) throw new Error('Browser narrow tool overlay contract changed')
  let output = original
  for (const [target, replacement] of replacements) {
    if (output.split(target).length !== 2) throw new Error('Browser narrow tool overlay target changed')
    output = output.replace(target, replacement)
  }
  if (source !== original && source !== output) throw new Error('Browser narrow tool overlay was partially modified')
  return output
}
export function closeBrowserWorkspacePanels(source: string): string {
  // Without a selected project the visibility binding already reads false,
  // so calling the owner's closer cannot emit another false notification.
  // Explicit browser Close must also hide a manually revealed empty panel.
  const before = 'export function closeTreePane(paneId: string) {\n  const closer = paneClosers[paneId]\n\n  if (closer) {\n    closer()'
  const after = before + "\n    if (['files', 'review'].includes(paneId)) setTreePaneHidden(paneId, true)"
  const original = source.replace(after, before)
  const contract = contracts.find(item => item.module === 'components/pane-shell/tree/store.ts')!
  if (createHash('sha256').update(original).digest('hex') !== contract.sourceHash || original.split(before).length !== 2) throw new Error('Browser empty-panel close contract changed')
  return original.replace(before, after)
}
export function exportBrowserStatusbarItem(source: string): string {
  const before = 'const StatusbarItemView = memo(function StatusbarItemView('
  const after = 'export ' + before
  const original = source.replace(after, before)
  const contract = contracts.find(item => item.module === 'app/shell/statusbar-controls.tsx')!
  if (createHash('sha256').update(original).digest('hex') !== contract.sourceHash || original.split(before).length !== 2) throw new Error('Browser statusbar item contract changed')
  return original.replace(before, after)
}

export function filterBrowserActivityToasts(source: string): string {
  const target = '      host.notify({'
  if (source.split(target).length !== 2 || !source.includes('`${label} has new activity`')) {
    throw new Error('Browser activity notification target changed')
  }
  // Keep unread tracking and explicit incoming-message alerts, but omit the
  // generic roster activity toast that adds no information to the browser UI.
  return source.replace(target, '      if (inbound) host.notify({')
}

export function removeBrowserNewSessionShortcut(source: string): string {
  const importTarget = "import { KbdGroup } from '@/components/ui/kbd'\n"
  const shortcut = [
    '                    {isNewSession && (',
    '                      <KbdGroup',
    "                        className={cn('ml-auto opacity-55', newSessionKbdFlash && 'opacity-100!')}",
    '                        keys={newSessionKbd}',
    '                        size="sm"',
    '                      />',
    '                    )}'
  ].join('\n') + '\n'
  if (!source.includes('KbdGroup') && !source.includes(importTarget)) return source
  if (source.split(importTarget).length !== 2 || source.split(shortcut).length !== 2) {
    throw new Error('Browser new-session shortcut target changed')
  }
  return source.replace(importTarget, '').replace(shortcut, '')
}

export function removeBrowserNewBotChatAction(source: string): string {
  const imports = [
    "  saveSelectedRosterBot\n",
    "  newBotChat,\n",
    "import { botRosterMeta, botWorkspaceOwnerKey, setBotsWorkspaceOwner } from './routing'\n"
  ]
  const action = `        <ContextMenuItem
          onSelect={() => {
            saveSelectedRosterBot(bot)
            setBotsWorkspaceOwner(botWorkspaceOwnerKey(bot), bot)
            newBotChat(bot)
          }}
        >
          {b.bot.newChatWith}
        </ContextMenuItem>
        <ContextMenuSeparator />
`
  const hasAction = source.includes(action)
  const hasPartialAction = source.includes('b.bot.newChatWith') || imports.some(target => source.includes(target))
  if (!hasAction && !hasPartialAction) return source
  if (!hasAction || source.split(action).length !== 2 || imports.some(target => source.split(target).length !== 2)) {
    throw new Error('Browser new-bot-chat action target changed')
  }
  let output = source.replace(action, '')
  output = output.replace(imports[0], '').replace(imports[1], '').replace(imports[2], "import { botRosterMeta } from './routing'\n")
  return output
}

export function removeBrowserOpenBotChatAction(source: string): string {
  const action = `        <ContextMenuItem onSelect={() => void openRosterBot(bot)}>{b.bot.openBotChat}</ContextMenuItem>
        <ContextMenuSeparator />
`
  if (!source.includes('b.bot.openBotChat')) return source
  if (source.split(action).length !== 2) throw new Error('Browser open-bot-chat action target changed')
  return source.replace(action, '')
}

// Run after renderer compatibility has validated and transformed this module.
export function browserActivityNotificationsPlugin(): Plugin {
  return {
    name: 'hermes:browser-activity-notifications', enforce: 'pre',
    transform(code, id) {
      return applyBrowserTransform(code, id, '', 40)
    }
  }
}

export function fixBrowserTooltipBoundary(source: string): string {
  const target = "    setPane(boundary === 'pane' ? (anchor?.current?.closest('[data-tree-group]') ?? null) : null)"
  if (source.split(target).length !== 2) throw new Error('Browser tooltip boundary target changed')
  return source.replace(
    target,
    `    // Browser composer portals can inherit a hidden desktop pane. A zero-size
    // collision boundary collapses the tooltip width; use the viewport instead.
    const candidate = boundary === 'pane' ? (anchor?.current?.closest('[data-tree-group]') ?? null) : null
    const bounds = candidate?.getBoundingClientRect()
    setPane(bounds && bounds.width > 0 && bounds.height > 0 ? candidate : null)`
  )
}

export function useBrowserMicrophoneCapture(source: string): string {
  const support = "    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {"
  const permission = `    const permitted = await window.hermesDesktop?.requestMicrophoneAccess?.()

    if (permitted === false) {
      throw new Error(copy.microphoneAccessDenied)
    }`
  const denied = '    return new Error(copy.microphonePermissionDenied)'
  for (const target of [support, permission, denied]) {
    if (source.split(target).length !== 2) throw new Error('Browser microphone capture target changed')
  }
  return source
    .replace(support, `    if (!window.isSecureContext) {
      throw new Error('Microphone recording requires HTTPS or localhost. Open this app using its HTTPS address, then allow microphone access.')
    }

${support}`)
    .replace(permission, `    // getUserMedia below requests browser permission and returns the recording
    // stream in one step. The desktop preflight opens and immediately closes
    // another stream, which can prompt twice or race device release.`)
    .replace(denied, `    return new Error(copy.microphoneAccessDenied + ' Allow microphone access for this site in your browser settings, then try again.')`)
}

function useBrowserComposerLayoutWidth(source: string): string {
  const target = '    const { width } = composer.getBoundingClientRect()'
  if (source.split(target).length !== 2) throw new Error('Browser composer width target changed')
  return source.replace(target, `    // Breakpoints use layout pixels; screen coordinates include browser UI zoom.
    const width = composer.offsetWidth`)
}

function useBrowserSearchLabel(source: string, root: string): string {
  const ariaTarget = 'aria-label={s.searchAria}'
  const placeholderTarget = 'placeholder={s.searchPlaceholder}'
  if (source.split(ariaTarget).length !== 2 || source.split(placeholderTarget).length !== 2) {
    throw new Error('Browser sidebar search label target changed')
  }
  const slotTarget = '              value={searchQuery}\n            />'
  if (source.split(slotTarget).length !== 2) throw new Error('Browser sidebar disclosure target changed')
  const extras = JSON.stringify(path.join(root, 'src/experience/sidebar-extras.tsx'))
  // Give the browser visibility preference a stable, label-independent target.
  const pinnedTarget = 'rootClassName="shrink-0 p-0 pb-1"'
  if (source.split(pinnedTarget).length !== 2) throw new Error('Browser pinned section target changed')
  const pinnedSection = '{!trimmedQuery && (\n              <SidebarSessionsSection\n                activeSessionId={activeSidebarSessionId}\n                contentClassName="flex flex-col gap-px rounded-lg pb-2 pt-1"'
  if (source.split(pinnedSection).length !== 2) throw new Error('Browser pinned section visibility target changed')
  return (`import { BrowserSidebarExtras } from ${extras}\n` + source)
    // Use resolved pins, including backend pins, rather than DOM rows: a
    // collapsed populated section must still keep its heading visible.
    .replace(pinnedSection, pinnedSection.replace('!trimmedQuery', '!trimmedQuery && pinnedSessions.length > 0'))
    .replace(pinnedTarget, 'rootClassName="browser-pinned-section shrink-0 p-0 pb-1"')
    .replace(slotTarget, slotTarget + '\n            <BrowserSidebarExtras />')
    .replace(ariaTarget, "aria-label={'Search'}")
    .replace(placeholderTarget, "placeholder={'Search'}")
}

function filterBrowserSessionMenu(source: string): string {
  const target = 'function OptionCheckbox({ checked, onCheck, option }: { checked: boolean; onCheck: () => void; option: Option }) {'
  if (source.split(target).length !== 2) throw new Error('Browser session filter menu target changed')
  return source.replace(target, target + "\n  if (['card-rows', 'profile-rail', 'all-profiles'].includes(option.id)) return null\n")
}

export function showHiddenBotsInBrowserRoster(source: string): string {
  if (source.includes('$showHiddenBots.get()')) return source

  const importTarget = "import { isBotHidden } from './hidden-bots'\n"
  const hiddenTarget = '  const hiddenBots = roster.filter(bot => isBotHidden(bot, allMeta))\n  const visibleRoster = roster.filter(bot => !isBotHidden(bot, allMeta))'
  if (source.split(importTarget).length !== 2 || source.split(hiddenTarget).length !== 2) {
    throw new Error('Browser hidden bot roster target changed')
  }

  return source
    .replace(importTarget, importTarget + "import { $showHiddenBots } from './hidden-bots'\n")
    .replace(hiddenTarget, `  const showHiddenBots = $showHiddenBots.get()
  const hiddenBots: RosterRow[] = []
  const visibleRoster = showHiddenBots ? roster : roster.filter(bot => !isBotHidden(bot, allMeta))`)
}

export function enableBrowserUngroupedSessions(source: string, surface: 'store' | 'menu' | 'sidebar'): string {
  const replacements: Record<typeof surface, [string, string][]> = {
    store: [
      ["export type SidebarGrouping = 'date' | 'profile' | 'project' | 'status'", "export type SidebarGrouping = 'none' | 'date' | 'profile' | 'project' | 'status'"],
      ["oneOf(['date', 'status'], 'date')", "oneOf(['none', 'date', 'status'], 'date')"],
      ["oneOf(['date', 'profile', 'status'], 'date')", "oneOf(['none', 'date', 'profile', 'status'], 'date')"]
    ],
    menu: [["const GROUPINGS: Option<SidebarGrouping>[] = [", "const GROUPINGS: Option<SidebarGrouping>[] = [\n  { icon: 'list-unordered', id: 'none', label: 'None' },"]],
    sidebar: [["grouping={showArchived || rankedGlobally ? 'none'", "grouping={grouping === 'none' || showArchived || rankedGlobally ? 'none'"]]
  }
  let output = source
  for (const [target, replacement] of replacements[surface]) {
    if (output.split(target).length !== 2) throw new Error(`Browser ungrouped sessions ${surface} target changed`)
    output = output.replace(target, replacement)
  }
  return output
}

export function disableBrowserSessionTabs(source: string): string {
  const keybind = '    openNewSessionTab,\n'
  const marker = '    // Browser-focused shell does not register chat tab creation.\n'
  const action = '    $newSessionTabAction.set(openNewSessionTab)'
  const disabledAction = '    $newSessionTabAction.set(null)'
  const original = source.replace(marker, keybind).replace(disabledAction, action)
  const contract = contracts.find(item => item.module === 'app/contrib/wiring.tsx')!
  if (createHash('sha256').update(original).digest('hex') !== contract.sourceHash || original.split(keybind).length !== 2 || original.split(action).length !== 2) {
    throw new Error('Browser chat tab action contract changed')
  }
  return source.replace(keybind, marker).replace(action, disabledAction)
}

export function disableBrowserSessionTileMirrors(source: string): string {
  const target = 'if (!isBrowserWindow() && !isHudWindow()) {'
  const replacement = 'if (false) {'
  const contract = contracts.find(item => item.module === 'app/contrib/controller.tsx')!
  if (createHash('sha256').update(source).digest('hex') !== contract.sourceHash || source.split(target).length !== 2) {
    throw new Error('Browser session tile mirror contract changed')
  }
  // Browser chat navigation is single-view. The desktop-only mirrors create
  // session-tile panes that become chat tabs in the shared layout tree.
  return source.replace(target, replacement)
}

export function useBrowserSessionSelection(source: string, root: string): string {
  const target = `    onResumeSession: (sessionId, session) => {
      const ownerRoute = sessionOwnerRouteFromRow(session)

      if (ownerRoute) {
        requestSessionResume(sessionId, ownerRoute)
      } else {
        forgetSessionOwnerHintsForSession(sessionId)
        requestSessionResume(sessionId)
      }

      openSession(sessionId, navigate)
    },`
  if (source.split(target).length !== 2) throw new Error('Browser session selection target changed')
  const adapter = JSON.stringify(path.join(root, 'src/upstream/selection.ts'))
  return (`import { selectBrowserSession } from ${adapter}\n` + source).replace(target, `    onResumeSession: (sessionId, session) => selectBrowserSession({
      sessionId, connectionId: session?.connection_id, profile: session?.profile
    }, navigate),`)
}

export function useBrowserRosterSelection(source: string, root: string, surface: 'bot' | 'group' | 'created-group'): string {
  const replacements: Record<typeof surface, [string, string][]> = {
    bot: [
      ["import { openRosterBot } from './roster-actions'", ''],
      ['const open = () => void openRosterBot(bot)', 'const open = () => void selectBrowserBot(botSelectionKey(bot))']
    ],
    group: [
      ["import { GroupChatWorkspace, openGroupChat } from './group-chat-view'", "import { GroupChatWorkspace } from './group-chat-view'"],
      ['onOpen={openGroupChat}', 'onOpen={selectBrowserGroup}']
    ],
    'created-group': [
      ["import { disbandGroupChat, openGroupChat } from './group-chat-view'", "import { disbandGroupChat } from './group-chat-view'"],
      ['onCreated={groupName => openGroupChat(groupName)}', 'onCreated={selectBrowserGroup}']
    ]
  }
  let output = source
  for (const [target, replacement] of replacements[surface]) {
    if (output.split(target).length !== 2) throw new Error(`Browser ${surface} selection target changed`)
    output = output.replace(target, replacement)
  }
  const command = surface === 'bot' ? 'selectBrowserBot' : 'selectBrowserGroup'
  return `import { ${command} } from ${JSON.stringify(path.join(root, 'src/upstream/roster-selection.ts'))}\n` + output
}

export function disableBrowserSessionRowTabs(source: string): string {
  const tabAction = "openSession(session.id, () => undefined, 'tab')"
  const windowAction = "openSession(session.id, () => undefined, 'window')"
  const contract = contracts.find(item => item.module === 'app/chat/sidebar/session-row.tsx')!
  if (createHash('sha256').update(source).digest('hex') !== contract.sourceHash || source.split(tabAction).length !== 3 || source.split(windowAction).length !== 2) {
    throw new Error('Browser session row tab gesture contract changed')
  }
  return source.replaceAll(tabAction, 'onResume()').replace(windowAction, 'onResume()')
}

export function disableBrowserSessionOpenActions(source: string): string {
  const tabCondition = "...(surface === 'row' && !alreadyTabbed"
  const windowCondition = '...(canOpenSessionWindow()'
  const contract = contracts.find(item => item.module === 'app/chat/sidebar/session-actions-menu.tsx')!
  if (createHash('sha256').update(source).digest('hex') !== contract.sourceHash || source.split(tabCondition).length !== 2 || source.split(windowCondition).length !== 2) {
    throw new Error('Browser session open-action contract changed')
  }
  // Browser chat is single-view. Keep the session action menu for rename,
  // pinning, export and other actions, but remove the desktop tab/window hops.
  return source.replace(tabCondition, '...(false').replace(windowCondition, '...(false')
}

export function filterBrowserKeybinds(source: string): string {
  const importMarker = "import { SettingsContent } from './primitives'\n"
  const browserSet = `${importMarker}\nconst BROWSER_UNSUPPORTED_KEYBINDS = new Set([\n  'session.newTab', 'session.newWindow', 'session.next', 'session.prev',\n  'view.showBrowser', 'view.toggleHud', 'view.showTerminal', 'view.newTerminal',\n  'view.nextTerminal', 'view.prevTerminal', 'view.closeTerminal',\n  'view.terminalCopy', 'view.terminalPaste', 'hud.snapToPointer'\n])\n`
  const actionTarget = '  const actionList = allKeybindActions(contributions)'
  const readonlyTarget = '  const [query, setQuery] = useState(\'\')'
  if (source.includes('BROWSER_UNSUPPORTED_KEYBINDS')) return source
  if (source.split(actionTarget).length !== 2 || source.split(readonlyTarget).length !== 2 || source.split(importMarker).length !== 2) {
    throw new Error('Browser keybind contract changed')
  }
  const output = source.replace(importMarker, browserSet)
    .replace(actionTarget, '  const actionList = allKeybindActions(contributions).filter(action => !BROWSER_UNSUPPORTED_KEYBINDS.has(action.id))')
    .replace(readonlyTarget, "  const browserReadonly = KEYBIND_READONLY.filter(shortcut => !BROWSER_UNSUPPORTED_KEYBINDS.has(shortcut.id))\n" + readonlyTarget)
    .replaceAll('return KEYBIND_READONLY.filter', 'return browserReadonly.filter')
    .replaceAll('const readonly = KEYBIND_READONLY.filter', 'const readonly = browserReadonly.filter')
  if (!output.includes('BROWSER_UNSUPPORTED_KEYBINDS') || output.includes('return KEYBIND_READONLY.filter')) throw new Error('Browser keybind transform was partially modified')
  return output
}

export function browserPlugin(root: string): Plugin {
  const sourceRoot = path.resolve(root, '../desktop/src')
  return {
    name: 'hermes:browser-shell', enforce: 'pre',
    buildStart() {
      for (const contract of contracts) {
        const source = readFileSync(path.join(sourceRoot, contract.module!), 'utf8')
        if (createHash('sha256').update(source).digest('hex') !== contract.sourceHash) throw new Error(`Browser integration changed: ${contract.module}. Review the shell contract.`)
      }
      assertBrowserRoot(root)
    },
    async resolveId(source, importer) {
      const virtual = registry.find(entry => entry.kind === 'virtual-module' && entry.specifier === source)
      if (virtual) return path.join(sourceRoot, virtual.module!)
      const replacements = registry.filter(entry => entry.kind === 'replacement' && entry.owner.endsWith('/browser-plugin.ts'))
      if (replacements.some(entry => entry.bypassImporters?.some(suffix => importer?.replaceAll('\\', '/').endsWith(suffix)))) return null
      const stem = source.replace(/\.tsx?$/, '')
      if (!replacements.some(entry => {
        const parts = entry.module!.replace(/\.tsx?$/, '').split('/')
        const names = parts.at(-1) === 'index' ? [parts.at(-2)!, parts.slice(-2).join('/')] : [parts.at(-1)!]
        return names.some(name => stem === name || stem.endsWith('/' + name))
      })) return null
      const resolved = await this.resolve(source, importer, { skipSelf: true })
      const id = resolved?.id.replaceAll('\\', '/')
      const replacement = registry.find(entry => entry.kind === 'replacement' && entry.owner.endsWith('/browser-plugin.ts') && id?.endsWith('/desktop/src/' + entry.module))
      if (replacement) return path.join(root, replacement.replacement!)
      return null
    },
    transform(code, id) {
      return applyBrowserTransform(code, id, root, 20)
    }
  }
}

function applyBrowserTransform(code: string, id: string, root: string, order: number): { code: string; map: null } | null {
  const normalized = id.replaceAll('\\', '/').split('?')[0]
  const entry = registry.find(item => item.kind === 'browser-transform' && item.order === order && normalized.endsWith('/desktop/src/' + item.module))
  if (!entry) return null
  const digest = (value: string) => createHash('sha256').update(root ? value.replaceAll(root, '<web-root>') : value).digest('hex')
  if (digest(code) === entry.outputHash) return { code, map: null }
  if (digest(code) !== entry.inputHash) throw new Error(`Browser compatibility changed: ${entry.name} (${entry.module}). Review this registry entry.`)
  const handlers: Record<string, (source: string) => string> = {
    useBrowserPinWrites: source => useBrowserPinWrites(source, root),
    useBrowserOpenSessionOwner: source => useBrowserOpenSessionOwner(source, root),
    useBrowserFreshSessionOwner: source => useBrowserFreshSessionOwner(source, root),
    useBrowserDirectResumeOwner: source => useBrowserDirectResumeOwner(source),
    scopeBrowserStorage, filterBrowserNarrowNavigation, closeBrowserWorkspacePanels,
    exportBrowserStatusbarItem, filterBrowserActivityToasts, removeBrowserNewSessionShortcut,
    removeBrowserNewBotChatAction, removeBrowserOpenBotChatAction, fixBrowserTooltipBoundary,
    useBrowserMicrophoneCapture, useBrowserComposerLayoutWidth, filterBrowserSessionMenu,
    showHiddenBotsInBrowserRoster, disableBrowserSessionTabs, disableBrowserSessionTileMirrors,
    disableBrowserSessionRowTabs, disableBrowserSessionOpenActions, filterBrowserKeybinds,
    useBrowserSessionSelection: source => useBrowserSessionSelection(source, root),
    useBrowserBotSelection: source => useBrowserRosterSelection(source, root, 'bot'),
    useBrowserGroupSelection: source => useBrowserRosterSelection(source, root, 'group'),
    useBrowserCreatedGroupSelection: source => useBrowserRosterSelection(source, root, 'created-group'),
    useBrowserSearchLabel: source => useBrowserSearchLabel(source, root),
    ungroupedStore: source => enableBrowserUngroupedSessions(source, 'store'),
    ungroupedMenu: source => enableBrowserUngroupedSessions(source, 'menu'),
    ungroupedSidebar: source => enableBrowserUngroupedSessions(source, 'sidebar')
  }
  let output = code
  for (const handler of entry.handlers || []) {
    if (!handlers[handler]) throw new Error(`Unknown browser compatibility handler: ${handler}`)
    output = handlers[handler](output)
  }
  if (output === code || digest(output) !== entry.outputHash) throw new Error(`Incomplete browser compatibility transform: ${entry.name}`)
  return { code: output, map: null }
}
