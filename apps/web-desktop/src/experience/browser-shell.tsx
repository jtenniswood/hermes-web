import { BrowserProfileNavigation } from './profile-navigation'
import { BrowserGatewayPanel, useBrowserGatewayStatus } from '../upstream/browser-gateway-panel'
import { revealBrowserWorkspace } from '../upstream/browser-workspace'
import { BrowserActionError } from './action-errors'
import { useEffect, useRef, useState, type ComponentPropsWithRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { BrowserSidebarNavigation } from './sidebar-extras'
import { BrowserSessionsPane } from './sidebar-sections'
import { SettingsMenu, toolRouteLabel } from './settings-menu'
import { Codicon, ContribWiring, WiredPane, SidebarProvider, ContribRender, ContribBoundary, useContributions, navigateToWorkspacePage, SessionTileCloseConfirm, BrowserWorkspace, OverlayView, Tip, Dialog, DialogContent, DialogTitle, SessionActionsMenu } from '../upstream/browser-api'
import { useBrowserConversation } from '../upstream/conversation'
import { useBrowserSessionActions } from '../upstream/conversation-actions'
import { currentPwaUpdate, subscribePwaUpdate, type PwaUpdateNotice } from '../pwa/register'
import { ApprovalToolbarTarget } from '../upstream/browser-api'
import { clampNavigationWidth, DEFAULT_NAVIGATION_WIDTH, MAX_NAVIGATION_WIDTH, MIN_NAVIGATION_WIDTH, NAVIGATION_TAB_LABELS, NAVIGATION_TABS, readNavigationTab, readNavigationWidth, readVisibleNavigationTabs, type NavigationTab, writeBrowserPreference } from './browser-preferences'

// Settings and Command Center are owned by the upstream ContribWiring overlay
// router. Only the full-page workspace routes need the browser modal shell.
const BROWSER_MODAL_ROUTES = new Set(['/skills', '/messaging', '/artifacts'])
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
  const conversation = useBrowserConversation()
  const selected = conversation.sessionId
  const sessionActions = useBrowserSessionActions()
  const gatewayStatus = useBrowserGatewayStatus()
  const chatTitle = conversation.displayName || ''
  const panes = useContributions('panes')
  const main = useRef<HTMLElement>(null), menu = useRef<HTMLButtonElement>(null), drawer = useRef<HTMLElement>(null), navigationTabsMenu = useRef<HTMLDivElement>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [compactNavigation, setCompactNavigation] = useState(() => window.matchMedia('(max-width:47.999rem)').matches)
  const [navigationCollapsed, setNavigationCollapsed] = useState(false)
  const navigationOpen = compactNavigation ? drawerOpen : !navigationCollapsed
  const [navigationTabsMenuPosition, setNavigationTabsMenuPosition] = useState<{ x: number; y: number } | null>(null)
  const [gatewayDialogOpen, setGatewayDialogOpen] = useState(false)
  const settingsTrigger = useRef<HTMLButtonElement>(null)
  const gatewayHeading = useRef<HTMLHeadingElement>(null)
  const [updateNotice, setUpdateNotice] = useState<PwaUpdateNotice | null>(() => currentPwaUpdate())
  const [updateDismissed, setUpdateDismissed] = useState(false)
  const [navigationWidth, setNavigationWidth] = useState(readNavigationWidth)
  const navigationResize = useRef<{ startX: number; startWidth: number } | null>(null)
  const [tab, setTab] = useState<NavigationTab>(readNavigationTab)
  const [visibleNavigationTabs, setVisibleNavigationTabs] = useState<NavigationTab[]>(readVisibleNavigationTabs)
  const browserModalReturnPath = useRef('/')
  const browserModalRoute = BROWSER_MODAL_ROUTES.has(location.pathname)
  const bots = panes.find(pane => pane.id === 'hermes-bots:pane')
  const previous = useRef({ selection: conversation.selectionKey, path: location.pathname })
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
    if (previous.current.selection !== conversation.selectionKey || previous.current.path !== location.pathname) {
      setDrawerOpen(false); revealBrowserWorkspace()
      if (drawerOpen) requestAnimationFrame(() => main.current?.focus())
    }
    previous.current = { selection: conversation.selectionKey, path: location.pathname }
  }, [conversation.selectionKey, location.pathname])
  useEffect(() => { writeBrowserPreference('activeTab', tab) }, [tab])
  useEffect(() => { writeBrowserPreference('navigationTabs', JSON.stringify(visibleNavigationTabs)) }, [visibleNavigationTabs])
  useEffect(() => {
    if (!visibleNavigationTabs.includes(tab)) setTab(visibleNavigationTabs[0])
  }, [tab, visibleNavigationTabs])
  useEffect(() => { writeBrowserPreference('navigationWidth', String(navigationWidth)) }, [navigationWidth])
  useEffect(() => subscribePwaUpdate(notice => {
    setUpdateNotice(notice)
    if (notice) setUpdateDismissed(false)
  }), [])
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
  const panelPanes = panes.filter(pane => !['workspace', 'sessions', 'hermes-bots:pane', 'terminal'].includes(pane.id))
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
  return <ApprovalToolbarTarget value={approvalTarget}><div className="browser-shell" data-browser-shell="" data-browser-conversation-kind={conversation.kind} data-browser-conversation-id={conversation.id || undefined}>
    <BrowserActionError />
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
        <BrowserProfileNavigation hidden={tab !== 'sessions'} />
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

      <div className="browser-navigation-resizer" hidden={!navigationOpen} role="separator" tabIndex={0} aria-label="Resize navigation panel" aria-orientation="vertical" aria-valuemin={MIN_NAVIGATION_WIDTH} aria-valuemax={MAX_NAVIGATION_WIDTH} aria-valuenow={Math.round(navigationWidth)} onPointerDown={beginNavigationResize} onPointerMove={updateNavigationResize} onPointerUp={endNavigationResize} onPointerCancel={endNavigationResize} onDoubleClick={() => setNavigationWidth(DEFAULT_NAVIGATION_WIDTH)} onKeyDown={event => {
        if (event.key === 'ArrowLeft') { event.preventDefault(); nudgeNavigationWidth(-16) }
        if (event.key === 'ArrowRight') { event.preventDefault(); nudgeNavigationWidth(16) }
        if (event.key === 'Home') { event.preventDefault(); setNavigationWidth(MIN_NAVIGATION_WIDTH) }
        if (event.key === 'End') { event.preventDefault(); setNavigationWidth(MAX_NAVIGATION_WIDTH) }
      }} />
      <main className="browser-main" ref={main} tabIndex={-1} aria-label="Conversation and workspace">
        <div className="browser-chat-toolbar" aria-label="Chat toolbar">
          <BrowserToolbarButton tooltip={navigationOpen ? 'Hide sidebar' : 'Show sidebar'} className="browser-menu" ref={menu} aria-label={navigationOpen ? 'Hide navigation' : 'Open navigation'} aria-expanded={navigationOpen} aria-controls="browser-navigation" onClick={() => compactNavigation ? setDrawerOpen(open => !open) : setNavigationCollapsed(collapsed => !collapsed)}>
            <Codicon name="layout-sidebar-left" size="0.75rem" />
          </BrowserToolbarButton>
          <div className="browser-actions">
            {selected && <SessionActionsMenu align="end" onArchive={sessionActions.archive} onDelete={sessionActions.delete} onPin={sessionActions.togglePin} onToggleUnread={sessionActions.toggleUnread} pinned={sessionActions.pinned} unread={sessionActions.unread} profile={sessionActions.profile} sessionId={selected} title={chatTitle}>
              <BrowserToolbarButton tooltip="Chat actions" type="button" className="browser-chat-actions" aria-label="Chat actions"><Codicon name="kebab-vertical" size="0.75rem" /></BrowserToolbarButton>
            </SessionActionsMenu>}
            <span className="browser-approval-control" ref={setApprovalTarget} />
            <SettingsMenu gatewayDialogOpen={gatewayDialogOpen} onOpenGateway={() => { setDrawerOpen(false); setGatewayDialogOpen(true) }} onOpenPanel={() => main.current?.focus()} onOpenRoute={openRoute} panelPanes={panelPanes}>
              <BrowserToolbarButton ref={settingsTrigger} tooltip="Settings" type="button" aria-label="Open settings menu"><Codicon name="settings-gear" size="0.75rem" /></BrowserToolbarButton>
            </SettingsMenu>
          </div>
        </div>
        {!browserModalRoute && <BrowserWorkspace />}
        <div className="browser-status"><WiredPane part="statusbar" /></div>
      </main>
      <Dialog open={gatewayDialogOpen} onOpenChange={setGatewayDialogOpen}>
        <DialogContent className="browser-gateway-dialog" bodyClassName="gap-0 p-0" aria-describedby={undefined} onOpenAutoFocus={event => { event.preventDefault(); gatewayHeading.current?.focus() }} onCloseAutoFocus={event => { event.preventDefault(); settingsTrigger.current?.focus() }}>
          <DialogTitle ref={gatewayHeading} tabIndex={-1} className="browser-gateway-dialog-title">Gateway</DialogTitle>
          <BrowserGatewayPanel status={gatewayStatus} onClose={() => setGatewayDialogOpen(false)} onOpenSystem={() => { setGatewayDialogOpen(false); openRoute('/command-center?section=system') }} />
        </DialogContent>
      </Dialog>
      {browserModalRoute && <OverlayView closeLabel={`Close ${toolRouteLabel(location.pathname.slice(1))}`} onClose={closeBrowserModal}>
        <WiredPane part="chatRoutes" />
      </OverlayView>}
    </div>
  </div></ApprovalToolbarTarget>
}
