import { useStore } from '@nanostores/react'
import { useEffect, useRef, useState, type ComponentPropsWithRef, type CSSProperties, type DragEvent as ReactDragEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { BrowserSidebarNavigation } from './sidebar-extras'
import { BrowserSessionsPane } from './sidebar-sections'
import { Codicon, ContribWiring, WiredPane, SidebarProvider, ContribRender, ContribBoundary, useContributions, APP_ROUTES, navigateToWorkspacePage, $selectedStoredSessionId, $sessions, $selectedBot, $gatewayState, SessionTileCloseConfirm, BrowserWorkspace, BrowserPanelButton, removeTreePane, revealTreePane, $profileOrder, $profiles, $activeGatewayProfile, $showAllProfiles, ALL_PROFILES, selectProfile, setProfileOrder, setShowAllProfiles, sortByProfileOrder, $layoutTree, $pinnedSessionIds, $sidebarPinsOpen, setSidebarPinsOpen, OverlayView, $botMeta, $lastRoster, botRosterMeta, botSelectionKey, displayName, avatarColor, botAppearance, BotFace, $activeConnectionId, useGatewayRequest, useStatusSnapshot, GatewayMenuPanel, Tip, ActionsMenu, Dialog, DialogContent, DialogTitle, SessionActionsMenu, pinSession, unpinSession, deleteSession, setSessionArchived, markSessionUnread, sessionPinId, setSessions } from '../upstream/browser-api'
import { currentPwaUpdate, subscribePwaUpdate, type PwaUpdateNotice } from '../pwa/register'
import { ApprovalToolbarTarget, BrowserActivityToastsItem } from '../upstream/browser-api'

const TOOL_ROUTE_META: Record<string, { label: string; icon: string }> = {
  'command-center': { label: 'Command center', icon: 'symbol-misc' },
  skills: { label: 'Capabilities', icon: 'symbol-misc' },
  messaging: { label: 'Messaging', icon: 'comment' },
  webhooks: { label: 'Webhooks', icon: 'globe' },
  artifacts: { label: 'Artifacts', icon: 'files' },
  cron: { label: 'Scheduled jobs', icon: 'watch' },
  profiles: { label: 'Profiles', icon: 'account' },
  agents: { label: 'Agents', icon: 'hubot' }
}

function toolRouteIcon(id: string) {
  return TOOL_ROUTE_META[id]?.icon || 'folder'
}

function sentenceCase(label: string) {
  const value = label.replaceAll('-', ' ').trim()
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value
}

function toolRouteLabel(id: string) {
  return sentenceCase(TOOL_ROUTE_META[id]?.label || id)
}

const WORKSPACE_ROUTE_IDS = new Set(['command-center', 'webhooks', 'profiles', 'agents'])
// Settings and Command Center are owned by the upstream ContribWiring overlay
// router. Only the full-page workspace routes need the browser modal shell.
const BROWSER_MODAL_ROUTES = new Set(['/skills', '/messaging', '/artifacts'])
const NAVIGATION_TABS = ['sessions', 'bots'] as const
type NavigationTab = typeof NAVIGATION_TABS[number]
const NAVIGATION_TAB_LABELS: Record<NavigationTab, string> = {
  sessions: 'Sessions',
  bots: 'Bots'
}
const DEFAULT_NAVIGATION_WIDTH = 304
const MIN_NAVIGATION_WIDTH = 224
const MAX_NAVIGATION_WIDTH = 560
const HIDDEN_PROFILES_STORAGE_KEY = 'hermes-web.browser.hidden-profiles'

function clampNavigationWidth(width: number) {
  return Math.min(MAX_NAVIGATION_WIDTH, Math.max(MIN_NAVIGATION_WIDTH, width))
}

function readVisibleNavigationTabs(): NavigationTab[] {
  try {
    const saved = JSON.parse(localStorage.getItem('hermes-web.browser.navigation-tabs') || 'null')
    if (Array.isArray(saved)) {
      const visible = NAVIGATION_TABS.filter(value => saved.includes(value))
      if (visible.length) return visible
    }
  } catch { /* Optional preference. */ }
  return [...NAVIGATION_TABS]
}

function readHiddenProfiles(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(HIDDEN_PROFILES_STORAGE_KEY) || 'null')
    return Array.isArray(saved) ? saved.filter((value): value is string => typeof value === 'string') : []
  } catch { return [] }
}

function sessionTileIds(node: unknown): string[] {
  const ids: string[] = []
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return
    const record = value as { children?: unknown; panes?: unknown }
    if (Array.isArray(record.panes)) {
      for (const pane of record.panes) if (typeof pane === 'string' && pane.startsWith('session-tile:')) ids.push(pane)
    }
    if (Array.isArray(record.children)) for (const child of record.children) visit(child)
  }
  visit(node)
  return ids
}

function selectedSessionTitle(sessions: unknown, selected: string | null) {
  if (!selected || !Array.isArray(sessions)) return ''
  const session = sessions.find(value => value && typeof value === 'object' && String((value as { id?: unknown }).id) === selected) as { title?: unknown } | undefined
  return typeof session?.title === 'string' ? session.title.trim() : ''
}

function BrowserToolbarButton({ tooltip, ...props }: ComponentPropsWithRef<'button'> & { tooltip: string }) {
  return <Tip label={tooltip} placement="toolbar" boundary="viewport"><button {...props} /></Tip>
}

export function BrowserShell() {
  return <SidebarProvider className="browser-provider" style={{ '--sidebar-width': '100%' } as CSSProperties}>
    <ContribWiring><BrowserLayout /><SessionTileCloseConfirm /></ContribWiring>
  </SidebarProvider>
}
function BrowserLayout() {
  const [approvalTarget, setApprovalTarget] = useState<HTMLSpanElement | null>(null)
  const navigate = useNavigate(), location = useLocation()
  const selected = useStore($selectedStoredSessionId), sessions = useStore($sessions), bot = useStore($selectedBot)
  const gatewayState = useStore($gatewayState)
  const activeConnectionId = useStore($activeConnectionId), activeGatewayProfile = useStore($activeGatewayProfile)
  const { requestGateway } = useGatewayRequest()
  const { inferenceStatus, statusSnapshot } = useStatusSnapshot(gatewayState, requestGateway, `${activeConnectionId ?? ''}\0${activeGatewayProfile}`)
  const pinnedSessionIds = useStore($pinnedSessionIds), pinsOpen = useStore($sidebarPinsOpen)
  const profiles = useStore($profiles), profileOrder = useStore($profileOrder), profile = useStore($activeGatewayProfile), showAllProfiles = useStore($showAllProfiles)
  const roster = useStore($lastRoster), botMeta = useStore($botMeta)
  const sessionTitle = selectedSessionTitle(sessions, selected)
  const selectedBotRow = sessionTitle === 'Bot Chat' ? roster.find(candidate => botSelectionKey(candidate) === bot) : undefined
  const chatTitle = selectedBotRow ? displayName(selectedBotRow, botRosterMeta(selectedBotRow, botMeta)) : sessionTitle
  const tree = useStore($layoutTree)
  const panes = useContributions('panes')
  const main = useRef<HTMLElement>(null), menu = useRef<HTMLButtonElement>(null), drawer = useRef<HTMLElement>(null), navigationTabsMenu = useRef<HTMLDivElement>(null), profileContextMenu = useRef<HTMLDivElement>(null)
  const requestedProfile = useRef<string | null>(null)
  const draggedProfile = useRef<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [compactNavigation, setCompactNavigation] = useState(() => window.matchMedia('(max-width:47.999rem)').matches)
  const [navigationCollapsed, setNavigationCollapsed] = useState(false)
  const navigationOpen = compactNavigation ? drawerOpen : !navigationCollapsed
  const [navigationTabsMenuPosition, setNavigationTabsMenuPosition] = useState<{ x: number; y: number } | null>(null)
  const [gatewayDialogOpen, setGatewayDialogOpen] = useState(false)
  const settingsTrigger = useRef<HTMLButtonElement>(null)
  const gatewayHeading = useRef<HTMLHeadingElement>(null)
  const [draggingProfile, setDraggingProfile] = useState<string | null>(null)
  const [dropTargetProfile, setDropTargetProfile] = useState<{ key: string; after: boolean } | null>(null)
  const [hiddenProfiles, setHiddenProfiles] = useState<string[]>(readHiddenProfiles)
  const [profileContextMenuPosition, setProfileContextMenuPosition] = useState<{ x: number; y: number; profile: string | null } | null>(null)
  const [updateNotice, setUpdateNotice] = useState<PwaUpdateNotice | null>(() => currentPwaUpdate())
  const [updateDismissed, setUpdateDismissed] = useState(false)
  const [navigationWidth, setNavigationWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem('hermes-web.browser.navigation-width'))
      return Number.isFinite(saved) ? clampNavigationWidth(saved) : DEFAULT_NAVIGATION_WIDTH
    } catch { return DEFAULT_NAVIGATION_WIDTH }
  })
  const navigationResize = useRef<{ startX: number; startWidth: number } | null>(null)
  const [tab, setTab] = useState<'sessions' | 'bots'>(() => {
    try { return localStorage.getItem('hermes-web.browser.navigation') === 'bots' ? 'bots' : 'sessions' } catch { return 'sessions' }
  })
  const [visibleNavigationTabs, setVisibleNavigationTabs] = useState<NavigationTab[]>(readVisibleNavigationTabs)
  const browserModalReturnPath = useRef('/')
  const browserModalRoute = BROWSER_MODAL_ROUTES.has(location.pathname)
  const bots = panes.find(pane => pane.id === 'hermes-bots:pane')
  const selectedSession = selected ? sessions.find(session => String(session.id) === selected) : undefined
  const selectedSessionProfile = selectedSession?.profile || activeGatewayProfile
  const selectedSessionPinId = selectedSession ? sessionPinId(selectedSession) : selected
  const selectedSessionPinned = Boolean(selectedSessionPinId && pinnedSessionIds.includes(selectedSessionPinId))
  const toggleSelectedPin = () => {
    if (!selectedSessionPinId) return
    if (selectedSessionPinned) unpinSession(selectedSessionPinId)
    else pinSession(selectedSessionPinId)
  }
  const toggleSelectedUnread = () => {
    if (!selected || !selectedSession) return
    void markSessionUnread(selected, selectedSession.unread !== true).catch(() => undefined)
  }
  const archiveSelectedSession = () => {
    if (!selected) return
    void setSessionArchived(selected, true, selectedSessionProfile).then(() => {
      setSessions(rows => rows.filter(row => row.id !== selected))
      navigate('/')
    }).catch(() => undefined)
  }
  const deleteSelectedSession = () => {
    if (!selected) return
    void deleteSession(selected, selectedSessionProfile).then(() => {
      setSessions(rows => rows.filter(row => row.id !== selected))
      navigate('/')
    }).catch(() => undefined)
  }
  const previous = useRef({ selected, bot, path: location.pathname })
  useEffect(() => {
    const media = window.matchMedia('(max-width:47.999rem)')
    const update = () => {
      setCompactNavigation(media.matches)
      setDrawerOpen(false)
    }
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  // Selection closes the mobile drawer without changing desktop visibility.
  useEffect(() => {
    if (previous.current.selected !== selected || previous.current.bot !== bot || previous.current.path !== location.pathname) {
      setDrawerOpen(false); revealTreePane('workspace')
      if (drawerOpen) requestAnimationFrame(() => main.current?.focus())
    }
    previous.current = { selected, bot, path: location.pathname }
  }, [selected, bot, location.pathname])
  useEffect(() => {
    // Clear session-tile panes restored from a desktop layout. Browser chat
    // navigation is single-view, so these stale panes must not become tabs.
    for (const paneId of sessionTileIds(tree)) removeTreePane(paneId)
  }, [tree])
  useEffect(() => { try { localStorage.setItem('hermes-web.browser.navigation', tab) } catch { /* Optional preference. */ } }, [tab])
  useEffect(() => { try { localStorage.setItem('hermes-web.browser.navigation-tabs', JSON.stringify(visibleNavigationTabs)) } catch { /* Optional preference. */ } }, [visibleNavigationTabs])
  useEffect(() => {
    if (!visibleNavigationTabs.includes(tab)) setTab(visibleNavigationTabs[0])
  }, [tab, visibleNavigationTabs])
  useEffect(() => { try { localStorage.setItem('hermes-web.browser.navigation-width', String(navigationWidth)) } catch { /* Optional preference. */ } }, [navigationWidth])
  useEffect(() => { try { localStorage.setItem(HIDDEN_PROFILES_STORAGE_KEY, JSON.stringify(hiddenProfiles)) } catch { /* Optional preference. */ } }, [hiddenProfiles])
  useEffect(() => {
    if (pinnedSessionIds.length === 0 && pinsOpen) setSidebarPinsOpen(false)
  }, [pinnedSessionIds, pinsOpen])
  useEffect(() => subscribePwaUpdate(notice => {
    setUpdateNotice(notice)
    if (notice) setUpdateDismissed(false)
  }), [])
  useEffect(() => {
    // A Bot activation can finish after a profile pick and restore the
    // upstream all-profiles flag. Keep an explicit browser selection in force.
    if (requestedProfile.current === profile && showAllProfiles) setShowAllProfiles(false)
  }, [profile, showAllProfiles])
  useEffect(() => {
    if (!drawerOpen) return
    drawer.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const keydown = (event: KeyboardEvent) => {
      // Portaled menus own Escape and focus until dismissed; closing one must
      // not also close its mobile navigation drawer.
      if (event.defaultPrevented || (event.target instanceof Element && event.target.closest('[role="menu"]'))) return
      if (event.key === 'Escape') { setDrawerOpen(false); menu.current?.focus() }
      if (event.key !== 'Tab') return
      const items = [menu.current, ...Array.from(drawer.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input,select,[tabindex="0"]') || [])].filter((el): el is HTMLElement => Boolean(el?.getClientRects().length))
      const first = items[0], last = items.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', keydown)
    return () => document.removeEventListener('keydown', keydown)
  }, [drawerOpen])
  useEffect(() => {
    if (!navigationTabsMenuPosition) return
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!navigationTabsMenu.current?.contains(event.target as Node)) setNavigationTabsMenuPosition(null)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setNavigationTabsMenuPosition(null)
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape)
    requestAnimationFrame(() => navigationTabsMenu.current?.querySelector<HTMLButtonElement>('button')?.focus())
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [navigationTabsMenuPosition])
  useEffect(() => {
    if (!profileContextMenuPosition) return
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!profileContextMenu.current?.contains(event.target as Node)) setProfileContextMenuPosition(null)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setProfileContextMenuPosition(null)
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape)
    requestAnimationFrame(() => profileContextMenu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus())
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [profileContextMenuPosition])
  const surface = (pane: typeof bots) => pane?.render ? <ContribBoundary id={pane.id}><ContribRender render={pane.render} /></ContribBoundary> : null
  const openRoute = (path: string) => {
    if (BROWSER_MODAL_ROUTES.has(path.split('?')[0]) && !browserModalRoute) browserModalReturnPath.current = location.pathname || '/'
    navigateToWorkspacePage(navigate, path)
    setDrawerOpen(false)
  }
  const closeBrowserModal = () => {
    const returnPath = browserModalReturnPath.current || '/'
    browserModalReturnPath.current = '/'
    navigateToWorkspacePage(navigate, returnPath)
  }
  const profileValue = showAllProfiles ? ALL_PROFILES : profile
  const defaultProfile = profiles.find(item => item.is_default)
  const profileSortOrder = defaultProfile && !profileOrder.includes(defaultProfile.name)
    ? [defaultProfile.name, ...profileOrder]
    : profileOrder
  const orderedProfiles = sortByProfileOrder(profiles, profileSortOrder)
  const profileAvatars = orderedProfiles.map(item => {
    const bot = roster.find(row => row.name === item.name || row.targetProfile === item.name || row.route?.targetProfile === item.name)
    const appearance = botAppearance(item.name, bot ? botRosterMeta(bot, botMeta) : undefined)
    return { appearance, botName: bot?.name || item.name, is_default: Boolean(item.is_default), key: item.name, label: sentenceCase(item.display_name || item.name) }
  })
  const visibleProfileAvatars = profileAvatars.filter(item => !hiddenProfiles.includes(item.key))
  const panelPanes = panes.filter(pane => !['workspace', 'sessions', 'hermes-bots:pane', 'terminal'].includes(pane.id))
  const chooseProfile = (value: string) => {
    if (value === ALL_PROFILES) {
      requestedProfile.current = null
      // The session-list adapter uses this marker to route concrete profile
      // refreshes through the shared browser connection. Clear it explicitly
      // so the upstream ALL_PROFILES scope can request the combined view.
      window.__HERMES_WEB_ACTIVE_PROFILE__ = null
      setShowAllProfiles(true)
      return
    }
    requestedProfile.current = value
    selectProfile(value)
  }
  const openProfileContextMenu = (event: React.MouseEvent, profileName: string | null = null) => {
    event.preventDefault()
    event.stopPropagation()
    const uiScale = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--web-ui-scale')) || 1
    const viewportWidth = window.innerWidth / uiScale
    const viewportHeight = window.innerHeight / uiScale
    // Keep the small menu reachable when the rail is close to a viewport edge.
    setProfileContextMenuPosition({
      x: Math.max(4, Math.min(event.clientX / uiScale, viewportWidth - 180)),
      y: Math.max(4, Math.min(event.clientY / uiScale, viewportHeight - 96)),
      profile: profileName
    })
  }
  const hideProfile = (profileName: string) => {
    setHiddenProfiles(current => current.includes(profileName) ? current : [...current, profileName])
    if (profile === profileName) chooseProfile(ALL_PROFILES)
    setProfileContextMenuPosition(null)
  }
  const showHiddenProfiles = () => {
    setHiddenProfiles([])
    setProfileContextMenuPosition(null)
  }
  const beginProfileDrag = (event: ReactDragEvent<HTMLButtonElement>, name: string) => {
    draggedProfile.current = name
    setDraggingProfile(name)
    setDropTargetProfile(null)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', name)
  }
  const finishProfileDrag = () => {
    draggedProfile.current = null
    setDraggingProfile(null)
    setDropTargetProfile(null)
  }
  const profileDropTarget = (event: ReactDragEvent<HTMLDivElement>) => {
    // Resolve one insertion point across avatars, gaps and trailing space.
    // Markers are positioned out of flow so preview and drop use the same bounds.
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-profile-key]'))
    for (const button of buttons) {
      const bounds = button.getBoundingClientRect()
      if (event.clientX < bounds.left + bounds.width / 2) return { key: button.dataset.profileKey!, after: false }
    }
    const last = buttons.at(-1)
    return last ? { key: last.dataset.profileKey!, after: true } : null
  }
  const hoverProfileDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!draggedProfile.current) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    const target = profileDropTarget(event)
    setDropTargetProfile(target?.key === draggedProfile.current ? null : target)
  }
  const reorderProfiles = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!draggedProfile.current) return
    event.preventDefault()
    event.stopPropagation()
    const target = profileDropTarget(event)
    const source = draggedProfile.current
    const named = orderedProfiles.map(item => item.name)
    if (target && source !== target.key && named.includes(source) && named.includes(target.key)) {
      const next = named.filter(name => name !== source)
      const insertionIndex = next.indexOf(target.key) + (target.after ? 1 : 0)
      next.splice(insertionIndex, 0, source)
      setProfileOrder(next)
    }
    finishProfileDrag()
  }
  const lastVisibleProfile = visibleProfileAvatars.at(-1)?.key
  const beginNavigationResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    event.preventDefault()
    navigationResize.current = { startX: event.clientX, startWidth: navigationWidth }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const updateNavigationResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = navigationResize.current
    if (start) setNavigationWidth(clampNavigationWidth(start.startWidth + event.clientX - start.startX))
  }
  const endNavigationResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    navigationResize.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const nudgeNavigationWidth = (delta: number) => setNavigationWidth(width => clampNavigationWidth(width + delta))
  const toggleNavigationTab = (value: NavigationTab) => {
    setVisibleNavigationTabs(current => {
      if (current.includes(value)) {
        if (current.length === 1) return current
        return current.filter(tabValue => tabValue !== value)
      }
      return NAVIGATION_TABS.filter(tabValue => current.includes(tabValue) || tabValue === value)
    })
  }
  return <ApprovalToolbarTarget value={approvalTarget}><div className="browser-shell" data-browser-shell="">
    <div className="browser-workspace">
      {drawerOpen && <button className="browser-scrim" aria-label="Close navigation" onClick={() => { setDrawerOpen(false); menu.current?.focus() }} />}
      <aside id="browser-navigation" ref={drawer} hidden={!compactNavigation && navigationCollapsed} className={`browser-navigation ${drawerOpen ? 'is-open' : ''}`} aria-label="Sessions, Bots and tools" style={{ '--browser-navigation-width': `${navigationWidth}px` } as CSSProperties}>
        <div className="browser-navigation-tabs" role="tablist" aria-label="Navigation" onContextMenu={event => {
          event.preventDefault()
          event.stopPropagation()
          setNavigationTabsMenuPosition({ x: event.clientX, y: event.clientY })
        }}>
          {visibleNavigationTabs.map((value, index, values) => <button key={value} role="tab" tabIndex={tab === value ? 0 : -1} aria-selected={tab === value} onKeyDown={event => {
            const next = event.key === 'ArrowRight' ? values[(index + 1) % values.length] : event.key === 'ArrowLeft' ? values[(index + values.length - 1) % values.length] : null
            if (next) { event.preventDefault(); event.stopPropagation(); setTab(next); (event.currentTarget.parentElement?.children[values.indexOf(next)] as HTMLElement)?.focus() }
          }} onClick={() => { setNavigationTabsMenuPosition(null); setTab(value) }}>{NAVIGATION_TAB_LABELS[value]}</button>)}
        </div>
        <div className="browser-navigation-body" role="tabpanel" aria-label={tab}>
          <BrowserSessionsPane hidden={tab !== 'sessions'}><BrowserSidebarNavigation onNavigate={openRoute}><WiredPane part="sidebar" /></BrowserSidebarNavigation></BrowserSessionsPane>
          <div hidden={tab !== 'bots'} className="browser-pane">{surface(bots) || <p className="browser-empty">Loading Bots…</p>}</div>
        </div>
        {updateNotice && !updateDismissed && <div className="browser-update-panel" role="status" aria-label="Application update">
          <div className="browser-update-panel-heading"><strong>Update available</strong><button type="button" aria-label="Dismiss update" onClick={() => setUpdateDismissed(true)}>×</button></div>
          <p>{updateNotice.message}</p>
          <button type="button" className="browser-update-panel-action" onClick={updateNotice.update}>Update when safe</button>
        </div>}
        {tab === 'sessions' && <div className="browser-profile-footer">
          <div className="browser-profile-rail" role="radiogroup" aria-label="Profiles" onContextMenu={event => openProfileContextMenu(event)} onDragOver={hoverProfileDrop} onDrop={reorderProfiles} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropTargetProfile(null) }}>
            {profiles.length > 1 && <Tip label="All profiles"><button className="browser-profile-choice browser-profile-all" type="button" aria-label="All profiles" aria-pressed={showAllProfiles} onClick={() => chooseProfile(ALL_PROFILES)} onContextMenu={event => openProfileContextMenu(event)}><Codicon name="symbol-misc" size="1rem" /></button></Tip>}
            {!showAllProfiles && !profiles.some(item => item.name === profile) && <Tip label={sentenceCase(profile)}><button className="browser-profile-choice" type="button" aria-label={sentenceCase(profile)} aria-pressed={profileValue === profile} onClick={() => chooseProfile(profile)} onContextMenu={event => openProfileContextMenu(event, profile)}><BotFace color={avatarColor(null, profile)} name={profile} shape={botAppearance(profile, undefined).shape} size={28} /></button></Tip>}
            {visibleProfileAvatars.map(item => <div className="browser-profile-slot" key={item.key}>
              {draggingProfile && dropTargetProfile?.key === item.key && !dropTargetProfile.after && draggingProfile !== item.key && <span className="browser-profile-drop-indicator" aria-hidden="true" />}
              <Tip label={item.label}><button className={`browser-profile-choice${draggingProfile === item.key ? ' is-dragging' : ''}${dropTargetProfile?.key === item.key && draggingProfile !== item.key ? ' is-drop-target' : ''}`} draggable data-profile-key={item.key} type="button" aria-label={item.label} aria-pressed={!showAllProfiles && profileValue === item.key} onClick={() => chooseProfile(item.key)} onContextMenu={event => openProfileContextMenu(event, item.key)} onDragStart={event => beginProfileDrag(event, item.key)} onDragEnd={finishProfileDrag}><BotFace color={avatarColor(item.appearance.color, item.botName)} image={item.appearance.image} name={item.botName} shape={item.appearance.shape} size={28} /></button></Tip>
            </div>)}
            {lastVisibleProfile && <div className="browser-profile-drop-end" aria-hidden="true">
              {draggingProfile && dropTargetProfile?.key === lastVisibleProfile && dropTargetProfile.after && draggingProfile !== lastVisibleProfile && <span className="browser-profile-drop-indicator" />}
            </div>}
          </div>
        </div>}
      </aside>
      {/* Keep fixed context menus outside the transformed mobile drawer so
          viewport coordinates stay anchored to the originating control. */}
      {navigationTabsMenuPosition && <div ref={navigationTabsMenu} className="browser-navigation-tabs-menu" role="menu" aria-label="Navigation tabs" style={{ left: navigationTabsMenuPosition.x, top: navigationTabsMenuPosition.y }}>
        {NAVIGATION_TABS.map(value => {
          const visible = visibleNavigationTabs.includes(value)
          return <button key={value} type="button" role="menuitemcheckbox" aria-checked={visible} disabled={visible && visibleNavigationTabs.length === 1} onClick={() => toggleNavigationTab(value)}>
            <span aria-hidden="true">{visible ? '✓' : ''}</span>{NAVIGATION_TAB_LABELS[value]}
          </button>
        })}
      </div>}
      {profileContextMenuPosition && <div ref={profileContextMenu} className="browser-profile-context-menu" role="menu" aria-label="Profile actions" style={{ left: profileContextMenuPosition.x, top: profileContextMenuPosition.y }}>
        {profileContextMenuPosition.profile && <button type="button" role="menuitem" onClick={() => hideProfile(profileContextMenuPosition.profile!)}>Hide profile</button>}
        <button type="button" role="menuitem" disabled={!hiddenProfiles.length} onClick={showHiddenProfiles}>Show hidden</button>
      </div>}
      <div className="browser-navigation-resizer" hidden={!navigationOpen} role="separator" tabIndex={0} aria-label="Resize navigation panel" aria-orientation="vertical" aria-valuemin={MIN_NAVIGATION_WIDTH} aria-valuemax={MAX_NAVIGATION_WIDTH} aria-valuenow={Math.round(navigationWidth)} onPointerDown={beginNavigationResize} onPointerMove={updateNavigationResize} onPointerUp={endNavigationResize} onPointerCancel={endNavigationResize} onDoubleClick={() => setNavigationWidth(DEFAULT_NAVIGATION_WIDTH)} onKeyDown={event => {
        if (event.key === 'ArrowLeft') { event.preventDefault(); nudgeNavigationWidth(-16) }
        if (event.key === 'ArrowRight') { event.preventDefault(); nudgeNavigationWidth(16) }
        if (event.key === 'Home') { event.preventDefault(); setNavigationWidth(MIN_NAVIGATION_WIDTH) }
        if (event.key === 'End') { event.preventDefault(); setNavigationWidth(MAX_NAVIGATION_WIDTH) }
      }} />
      <main className="browser-main" ref={main} tabIndex={-1} aria-label="Conversation and workspace">
        <div className="browser-chat-toolbar" aria-label="Chat title bar">
          <BrowserToolbarButton tooltip={navigationOpen ? 'Hide sidebar' : 'Show sidebar'} className="browser-menu" ref={menu} aria-label={navigationOpen ? 'Hide navigation' : 'Open navigation'} aria-expanded={navigationOpen} aria-controls="browser-navigation" onClick={() => compactNavigation ? setDrawerOpen(open => !open) : setNavigationCollapsed(collapsed => !collapsed)}>
            <Codicon name="layout-sidebar-left" size="0.75rem" />
          </BrowserToolbarButton>
          <div className="browser-chat-title" title={chatTitle}>{chatTitle}</div>
          <div className="browser-actions">
            {selected && <SessionActionsMenu align="end" onArchive={archiveSelectedSession} onDelete={deleteSelectedSession} onPin={toggleSelectedPin} onToggleUnread={toggleSelectedUnread} pinned={selectedSessionPinned} profile={selectedSessionProfile} sessionId={selected} title={chatTitle}>
              <BrowserToolbarButton tooltip="Chat actions" type="button" className="browser-chat-actions" aria-label="Chat actions"><Codicon name="kebab-vertical" size="0.75rem" /></BrowserToolbarButton>
            </SessionActionsMenu>}
            <span className="browser-approval-control" ref={setApprovalTarget} />
            <ActionsMenu align="end" ariaLabel="Settings and workspace" contentClassName="browser-settings-menu" onCloseAutoFocus={event => { if (gatewayDialogOpen) event.preventDefault() }} items={kit => <>
              <kit.Label>Systems</kit.Label>
              <kit.Item onSelect={() => openRoute('/settings')}><Codicon name="settings-gear" size="1rem" /><span>Settings</span></kit.Item>
              <kit.Item onSelect={() => { setDrawerOpen(false); setGatewayDialogOpen(true) }}><Codicon name="pulse" size="1rem" /><span>Gateway</span></kit.Item>
              <kit.Label className="mt-3">Notifications</kit.Label>
              <BrowserActivityToastsItem />
              {panelPanes.length > 0 && <kit.Label className="mt-3">Panels</kit.Label>}
              {panelPanes.map(pane => {
                const title = String(pane.title || pane.id)
                return <BrowserPanelButton key={pane.id} id={pane.id} title={sentenceCase(title)} ariaLabel={title} icon={<Codicon name="files" size="1rem" />} collapsible={Boolean((pane.data as { collapsible?: boolean } | undefined)?.collapsible)} onOpen={() => main.current?.focus()} />
              })}
              <kit.Label className="mt-3">Workspace</kit.Label>
              {APP_ROUTES.filter(route => WORKSPACE_ROUTE_IDS.has(route.id)).map(route => <kit.Item key={route.path} onSelect={() => openRoute(route.path)}>
                <Codicon name={toolRouteIcon(route.id)} size="1rem" /><span>{toolRouteLabel(route.id)}</span>
              </kit.Item>)}
            </>}>
              <BrowserToolbarButton ref={settingsTrigger} tooltip="Settings" type="button" aria-label="Open settings menu"><Codicon name="settings-gear" size="0.75rem" /></BrowserToolbarButton>
            </ActionsMenu>
          </div>
        </div>
        {!browserModalRoute && <BrowserWorkspace />}
        <div className="browser-status"><WiredPane part="statusbar" /></div>
      </main>
      <Dialog open={gatewayDialogOpen} onOpenChange={setGatewayDialogOpen}>
        <DialogContent className="browser-gateway-dialog" bodyClassName="gap-0 p-0" aria-describedby={undefined} onOpenAutoFocus={event => { event.preventDefault(); gatewayHeading.current?.focus() }} onCloseAutoFocus={event => { event.preventDefault(); settingsTrigger.current?.focus() }}>
          <DialogTitle ref={gatewayHeading} tabIndex={-1} className="browser-gateway-dialog-title">Gateway</DialogTitle>
          <GatewayMenuPanel gatewayState={gatewayState} inferenceStatus={inferenceStatus} statusSnapshot={statusSnapshot} onClose={() => setGatewayDialogOpen(false)} onOpenSystem={() => { setGatewayDialogOpen(false); openRoute('/command-center?section=system') }} />
        </DialogContent>
      </Dialog>
      {browserModalRoute && <OverlayView closeLabel={`Close ${toolRouteLabel(location.pathname.slice(1))}`} onClose={closeBrowserModal}>
        <WiredPane part="chatRoutes" />
      </OverlayView>}
    </div>
  </div></ApprovalToolbarTarget>
}
