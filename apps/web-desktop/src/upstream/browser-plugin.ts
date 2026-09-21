import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import type { Plugin } from 'vite'
import contracts from './browser-contracts.json'
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
  const contract = contracts.find(item => item.module.endsWith('/narrow-overlays.tsx'))!
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

export function removeBrowserActivityToastButton(source: string): string {
  const start = "          <Tip\n            label={activityToasts ? 'Activity toasts on — click to silence' : 'Activity toasts off — click to enable'}"
  if (source.split(start).length !== 2) throw new Error('Browser activity toast button target changed')
  const offset = source.indexOf(start)
  const end = source.indexOf('          </Tip>', offset)
  if (end < 0) throw new Error('Browser activity toast button closing target changed')
  return source.slice(0, offset) + source.slice(end + '          </Tip>\n'.length)
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

export function layoutBrowserRosterToolbar(source: string): string {
  if (source.includes('$showHiddenBots.set')) return source

  const filterStart = '          {showRosterFilters ? (\n'
  const filterEnd = '          ) : null}\n        </div>\n      ) : null}'
  const addMenu = '          <DropdownMenu>\n            <Tip label="New…">'
  const searchRow = '      {showRosterTools ? ('
  for (const target of [filterStart, filterEnd, addMenu, searchRow]) {
    if (source.split(target).length !== 2) throw new Error('Browser roster toolbar layout target changed')
  }
  const start = source.indexOf(filterStart), end = source.indexOf(filterEnd, start)
  if (end < start) throw new Error('Browser roster filter boundary changed')
  const filter = source.slice(start + filterStart.length, end)
  const filterContent = '              <DropdownMenuContent align="end">\n'
  if (filter.split(filterContent).length !== 2) throw new Error('Browser roster filter content target changed')
  const filterContentEnd = '              </DropdownMenuContent>\n'
  if (filter.split(filterContentEnd).length !== 2) throw new Error('Browser roster filter content end target changed')
  const kindStartMarker = "                {(\n                  [\n                    ['all', b.roster.botsAndGroups],"
  const kindEndMarker = '                <DropdownMenuSeparator />\n'
  const activityStartMarker = "                {(\n                  [\n                    ['all', b.roster.anyActivity],"
  const activityEndMarker = '                {gatewayOptions.length > 1 ? <DropdownMenuSeparator /> : null}\n'
  const kindStart = filter.indexOf(kindStartMarker)
  const kindEnd = filter.indexOf(kindEndMarker, kindStart)
  const activityStart = filter.indexOf(activityStartMarker)
  const activityEnd = filter.indexOf(activityEndMarker, activityStart)
  if (kindStart < 0 || kindEnd < 0 || activityStart < 0 || activityEnd < 0) throw new Error('Browser roster filter grouping target changed')
  const kindBlock = filter.slice(kindStart, kindEnd)
  const activityBlock = filter.slice(activityStart, activityEnd)
  const addIconTarget = '<Codicon name="add" />'
  const filterIconTarget = '<Codicon name="list-filter" />'
  const filterSizeTarget = "'size-7 shrink-0 rounded-md text-(--ui-text-tertiary) hover:text-foreground'"
  for (const target of [addIconTarget, filterIconTarget, filterSizeTarget]) {
    if (source.split(target).length !== 2) throw new Error('Browser roster toolbar icon target changed')
  }
  const hiddenBotsOption = `              <DropdownMenuItem onSelect={() => $showHiddenBots.set(!$showHiddenBots.get())}>
                <span className="min-w-0 flex-1">Show hidden bots</span>
                {$showHiddenBots.get() ? <Codicon name="check" /> : null}
              </DropdownMenuItem>
`
  const showSubmenu = [
    '              <DropdownMenuSub>',
    '                <DropdownMenuSubTrigger>Show</DropdownMenuSubTrigger>',
    '                <DropdownMenuSubContent>',
    kindBlock,
    '                </DropdownMenuSubContent>',
    '              </DropdownMenuSub>',
    '              <DropdownMenuSeparator />'
  ].join('\n')
  const timeSubmenu = [
    '              <DropdownMenuSub>',
    '                <DropdownMenuSubTrigger>Filter by time</DropdownMenuSubTrigger>',
    '                <DropdownMenuSubContent>',
    activityBlock,
    '                </DropdownMenuSubContent>',
    '              </DropdownMenuSub>'
  ].join('\n')
  const browserFilter = filter
    .replace(kindBlock + kindEndMarker, showSubmenu + '\n')
    .replace(activityBlock + activityEndMarker, timeSubmenu + '\n' + activityEndMarker)
    .replace(filterContentEnd, `              <DropdownMenuSeparator />\n${hiddenBotsOption}${filterContentEnd}`)
  // Keep the original filter menu and callbacks, always available beside New.
  // Only search needs a second row; a filter-only row should reserve no space.
  const output = (source.slice(0, start) + source.slice(end + '          ) : null}\n'.length))
    .replace(addMenu, browserFilter + addMenu)
    .replace(searchRow, '      {showRosterSearch ? (')
    .replace(addIconTarget, '<Codicon name="add" size="0.75rem" />')
    .replace(filterIconTarget, '<Codicon name="list-filter" size="0.75rem" />')
    .replace(filterSizeTarget, "'size-6 shrink-0 rounded-md text-(--ui-text-tertiary) hover:text-foreground'")
  return "import { DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from '@/components/ui/dropdown-menu'\nimport { $showHiddenBots } from './hidden-bots'\n" + output
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

export function addBrowserApprovalModeIcons(source: string): string {
  if (source.includes('ApprovalModeIcon')) return source

  const importTarget = "import { Zap, ZapFilled } from '@/lib/icons'\n"
  const separatorImportTarget = '  DropdownMenuSeparator\n'
  const toolbarIconTarget = "    icon: mode === 'off' ? <ZapFilled className=\"size-3.5\" /> : <Zap className=\"size-3.5 opacity-70\" />,"
  const menuLabelTarget = '              <span className="flex min-w-0 flex-col gap-0.5">\n'
  const smartDescriptionTarget = '      smart: copy.smartDescription,\n'
  const menuSeparatorTarget = '        <DropdownMenuSeparator />\n'
  for (const target of [importTarget, separatorImportTarget, toolbarIconTarget, menuLabelTarget, smartDescriptionTarget, menuSeparatorTarget]) {
    if (source.split(target).length !== 2) throw new Error('Browser approval mode icon target changed')
  }

  const iconImport = "import { Brain, Power, ShieldLock } from '@/lib/icons'\n"
  const iconComponent = `
function ApprovalModeIcon({ mode }: { mode: ApprovalMode }) {
  if (mode === 'manual') return <ShieldLock className="size-3.5" />
  if (mode === 'smart') return <Brain className="size-3.5" />
  return <Power className="size-3.5" />
}
`
  const menuIcon = `              {value === 'manual' ? <ShieldLock className="mt-0.5 size-3.5 shrink-0 text-(--ui-text-tertiary)" /> : value === 'smart' ? <Brain className="mt-0.5 size-3.5 shrink-0 text-(--ui-text-tertiary)" /> : <Power className="mt-0.5 size-3.5 shrink-0 text-(--ui-text-tertiary)" />}\n`
  return source
    .replace(importTarget, iconImport)
    .replace(separatorImportTarget, '')
    .replace('import { useI18n } from \'@/i18n\'\n', 'import { useI18n } from \'@/i18n\'\n' + iconComponent)
    .replace(smartDescriptionTarget, "      smart: 'Ask when needed',\n")
    .replace(menuSeparatorTarget, '')
    .replace(toolbarIconTarget, '    icon: <ApprovalModeIcon mode={mode} />,')
    .replace(menuLabelTarget, menuIcon + menuLabelTarget)
}

// Run after renderer compatibility has validated and transformed this module.
export function browserActivityNotificationsPlugin(): Plugin {
  return {
    name: 'hermes:browser-activity-notifications', enforce: 'pre',
    transform(code, id) {
      if (id.replaceAll('\\', '/').endsWith('/desktop/src/plugins/hermes-bots/roster-pane-toolbar.tsx')) {
        return { code: layoutBrowserRosterToolbar(removeBrowserActivityToastButton(code)), map: null }
      }
      if (id.replaceAll('\\', '/').endsWith('/desktop/src/plugins/hermes-bots/roster-actions.ts')) {
        return { code: filterBrowserActivityToasts(code), map: null }
      }
      return null
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
        const source = readFileSync(path.join(sourceRoot, contract.module), 'utf8')
        if (createHash('sha256').update(source).digest('hex') !== contract.sourceHash) throw new Error(`Browser integration changed: ${contract.module}. Review the shell contract.`)
      }
      assertBrowserRoot(root)
    },
    async resolveId(source, importer) {
      if (source === 'hermes:statusbar-item') return path.join(sourceRoot, 'app/shell/statusbar-controls.tsx')
      if (/\/upstream\/browser-(?:titlebar|statusbar)\.tsx$/.test(importer?.replaceAll('\\', '/') || '')) return null
      if (!/(?:^|\/)(?:app(?:\/index)?|titlebar-controls|statusbar-controls)(?:\.tsx)?$/.test(source)) return null
      const resolved = await this.resolve(source, importer, { skipSelf: true })
      const id = resolved?.id.replaceAll('\\', '/')
      if (id?.endsWith('/desktop/src/app/index.tsx')) return browserRootPath(root)
      if (id?.endsWith('/desktop/src/app/shell/titlebar-controls.tsx')) return path.join(root, 'src/upstream/browser-titlebar.tsx')
      if (id?.endsWith('/desktop/src/app/shell/statusbar-controls.tsx')) return path.join(root, 'src/upstream/browser-statusbar.tsx')
      return null
    },
    transform(code, id) {
      if (id.replaceAll('\\', '/').endsWith('/desktop/src/store/layout.ts')) {
        return { code: enableBrowserUngroupedSessions(code, 'store'), map: null }
      }
      if (id.replaceAll('\\', '/').endsWith('/desktop/src/app/chat/sidebar/filter-menu.tsx')) {
        return { code: enableBrowserUngroupedSessions(filterBrowserSessionMenu(code), 'menu'), map: null }
      }
      if (id.replaceAll('\\', '/').endsWith('/desktop/src/plugins/hermes-bots/roster-pane-derivation.ts')) {
        return { code: showHiddenBotsInBrowserRoster(code), map: null }
      }
      if (id.replaceAll('\\', '/').endsWith('/desktop/src/app/chat/composer/hooks/use-mic-recorder.ts')) {
        return { code: useBrowserMicrophoneCapture(code), map: null }
      }
      if (id.replaceAll('\\', '/').endsWith('/desktop/src/app/chat/composer/hooks/use-composer-metrics.ts')) {
        return { code: useBrowserComposerLayoutWidth(code), map: null }
      }
      if (id.replaceAll('\\', '/').endsWith('/desktop/src/components/ui/tooltip.tsx')) {
        return { code: fixBrowserTooltipBoundary(code), map: null }
      }
      if (id.replaceAll('\\', '/').endsWith('/desktop/src/app/chat/sidebar/index.tsx')) {
        return { code: removeBrowserNewSessionShortcut(enableBrowserUngroupedSessions(useBrowserSearchLabel(code, root), 'sidebar')), map: null }
      }
      if (id.replaceAll('\\', '/').endsWith('/desktop/src/app/contrib/wiring.tsx')) {
        return { code: disableBrowserSessionTabs(code), map: null }
      }
      if (id.replaceAll('\\', '/').endsWith('/desktop/src/app/contrib/controller.tsx')) {
        return { code: disableBrowserSessionTileMirrors(code), map: null }
      }
      if (id.replaceAll('\\', '/').endsWith('/desktop/src/app/chat/sidebar/session-row.tsx')) {
        return { code: disableBrowserSessionRowTabs(code), map: null }
      }
      if (id.replaceAll('\\', '/').endsWith('/desktop/src/app/chat/sidebar/session-actions-menu.tsx')) {
        return { code: disableBrowserSessionOpenActions(code), map: null }
      }
      if (id.replaceAll('\\', '/').endsWith('/desktop/src/plugins/hermes-bots/bot-row.tsx')) {
        return { code: removeBrowserNewBotChatAction(removeBrowserOpenBotChatAction(code)), map: null }
      }
      if (id.replaceAll('\\', '/').endsWith('/desktop/src/app/shell/approval-mode-menu.tsx')) {
        return { code: addBrowserApprovalModeIcons(code), map: null }
      }
      if (id.replaceAll('\\', '/').endsWith('/desktop/src/app/settings/keybind-settings.tsx')) {
        return { code: filterBrowserKeybinds(code), map: null }
      }
      if (id.replaceAll('\\', '/').endsWith('/desktop/src/app/shell/statusbar-controls.tsx')) return { code: exportBrowserStatusbarItem(code), map: null }
      if (id.replaceAll('\\', '/').endsWith('/desktop/src/components/pane-shell/tree/store.ts')) return { code: closeBrowserWorkspacePanels(code), map: null }
      if (id.replaceAll('\\', '/').endsWith('/desktop/src/components/pane-shell/tree/renderer/narrow-overlays.tsx')) return { code: filterBrowserNarrowNavigation(code), map: null }
      if (!id.replaceAll('\\', '/').endsWith('/desktop/src/lib/storage.ts')) return null
      return { code: scopeBrowserStorage(code), map: null }
    }
  }
}
