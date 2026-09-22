import { BrowserToolModal } from './tool-modal'
import { BrowserModal } from './ui/modal'
import { BrowserToolbarButton } from './ui/toolbar-button'
import { BrowserNavigationTabs, BrowserNavigationResizer, useBrowserNavigation } from './navigation'
import { BrowserProfileNavigation } from './profile-navigation'
import { BrowserGatewayPanel, useBrowserGatewayStatus } from '../upstream/browser-gateway-panel'
import { BrowserActionError } from './action-errors'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { BrowserSidebarNavigation } from './sidebar-extras'
import { BrowserSessionsPane } from './sidebar-sections'
import { SettingsMenu } from './settings-menu'
import { Codicon, ContribWiring, WiredPane, SidebarProvider, ContribRender, ContribBoundary, useContributions, navigateToWorkspacePage, SessionTileCloseConfirm, BrowserWorkspace, SessionActionsMenu } from '../upstream/browser-api'
import { useBrowserConversation } from '../upstream/conversation'
import { useBrowserSessionActions } from '../upstream/conversation-actions'
import { currentPwaUpdate, subscribePwaUpdate, type PwaUpdateNotice } from '../pwa/register'
import { ApprovalToolbarTarget } from '../upstream/browser-api'

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
  const main = useRef<HTMLElement>(null), menu = useRef<HTMLButtonElement>(null)
  const navigation = useBrowserNavigation({ selectionKey: conversation.selectionKey, path: location.pathname, main, trigger: menu })
  const { tab } = navigation
  const [gatewayDialogOpen, setGatewayDialogOpen] = useState(false)
  const settingsTrigger = useRef<HTMLButtonElement>(null)
  const [updateNotice, setUpdateNotice] = useState<PwaUpdateNotice | null>(() => currentPwaUpdate())
  const [updateDismissed, setUpdateDismissed] = useState(false)
  const bots = panes.find(pane => pane.id === 'hermes-bots:pane')
  useEffect(() => subscribePwaUpdate(notice => {
    setUpdateNotice(notice)
    if (notice) setUpdateDismissed(false)
  }), [])
  const surface = (pane: typeof bots) => pane?.render ? <ContribBoundary id={pane.id}><ContribRender render={pane.render} /></ContribBoundary> : null
  const openRoute = (path: string) => {
    navigateToWorkspacePage(navigate, path)
    navigation.closeDrawer()
  }
  const panelPanes = panes.filter(pane => !['workspace', 'sessions', 'hermes-bots:pane', 'terminal'].includes(pane.id))
  return <ApprovalToolbarTarget value={approvalTarget}><div className="browser-shell" data-browser-shell="" data-browser-conversation-kind={conversation.kind} data-browser-conversation-id={conversation.id || undefined}>
    <BrowserActionError />
    <div className="browser-workspace">
      {navigation.drawerOpen && <button className="browser-scrim" aria-label="Close navigation" onClick={navigation.dismissDrawer} />}
      <aside id="browser-navigation" ref={navigation.drawer} hidden={!navigation.compact && navigation.collapsed} className={`browser-navigation ${navigation.drawerOpen ? 'is-open' : ''}`} aria-label="Sessions, Bots and tools" style={{ '--browser-navigation-width': `${navigation.width}px` } as CSSProperties}>
        <BrowserNavigationTabs navigation={navigation} />
        <div className="browser-navigation-body" role="tabpanel" aria-label={tab}>
          <BrowserSessionsPane hidden={tab !== 'sessions'} sections={navigation.sections}><BrowserSidebarNavigation onNavigate={openRoute}><WiredPane part="sidebar" /></BrowserSidebarNavigation></BrowserSessionsPane>
          <div hidden={tab !== 'bots'} className="browser-pane">{surface(bots) || <p className="browser-empty">Loading Bots…</p>}</div>
        </div>
        {updateNotice && !updateDismissed && <div className="browser-update-panel" role="status" aria-label="Application update">
          <div className="browser-update-panel-heading"><strong>Update available</strong><button type="button" aria-label="Dismiss update" onClick={() => setUpdateDismissed(true)}>×</button></div>
          <p>{updateNotice.message}</p>
          <button type="button" className="browser-update-panel-action" onClick={updateNotice.update}>Update when safe</button>
        </div>}
        <BrowserProfileNavigation hidden={tab !== 'sessions'} />
      </aside>
      <BrowserNavigationResizer navigation={navigation} />
      <main className="browser-main" ref={main} tabIndex={-1} aria-label="Conversation and workspace">
        <div className="browser-chat-toolbar" aria-label="Chat toolbar">
          <BrowserToolbarButton tooltip={navigation.open ? 'Hide sidebar' : 'Show sidebar'} className="browser-menu" ref={menu} aria-label={navigation.open ? 'Hide navigation' : 'Open navigation'} aria-expanded={navigation.open} aria-controls="browser-navigation" onClick={navigation.toggle}>
            <Codicon name="layout-sidebar-left" size="0.75rem" />
          </BrowserToolbarButton>
          <div className="browser-actions">
            {selected && <SessionActionsMenu align="end" onArchive={sessionActions.archive} onDelete={sessionActions.delete} onPin={sessionActions.togglePin} onToggleUnread={sessionActions.toggleUnread} pinned={sessionActions.pinned} unread={sessionActions.unread} profile={sessionActions.profile} sessionId={selected} title={chatTitle}>
              <BrowserToolbarButton tooltip="Chat actions" type="button" className="browser-chat-actions" aria-label="Chat actions"><Codicon name="kebab-vertical" size="0.75rem" /></BrowserToolbarButton>
            </SessionActionsMenu>}
            <span className="browser-approval-control" ref={setApprovalTarget} />
            <SettingsMenu triggerRef={settingsTrigger} onOpenGateway={() => { navigation.closeDrawer(); setGatewayDialogOpen(true) }} onOpenPanel={() => main.current?.focus()} onOpenRoute={openRoute} panelPanes={panelPanes} />
          </div>
        </div>
        <BrowserWorkspace />
        <div className="browser-status"><WiredPane part="statusbar" /></div>
      </main>
      <BrowserModal title="Gateway" open={gatewayDialogOpen} onOpenChange={setGatewayDialogOpen} returnFocus={settingsTrigger} className="browser-gateway-dialog">
        <BrowserGatewayPanel status={gatewayStatus} onClose={() => setGatewayDialogOpen(false)} onOpenSystem={() => { setGatewayDialogOpen(false); openRoute('/command-center?section=system') }} />
      </BrowserModal>
      <BrowserToolModal />
    </div>
  </div></ApprovalToolbarTarget>
}
