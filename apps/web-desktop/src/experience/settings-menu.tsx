import type { ReactNode } from 'react'
import { ActionsMenu, APP_ROUTES, BrowserActivityToastsItem, BrowserPanelButton, Codicon } from '../upstream/browser-api'

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

export const WORKSPACE_ROUTE_IDS = new Set(['command-center', 'webhooks', 'profiles', 'agents'])

export function toolRouteIcon(id: string) {
  return TOOL_ROUTE_META[id]?.icon || 'folder'
}

export function toolRouteLabel(id: string) {
  const value = TOOL_ROUTE_META[id]?.label || id
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value
}

type PanelEntry = {
  id: string
  title?: unknown
  data?: unknown
}

type SettingsMenuProps = {
  children: ReactNode
  gatewayDialogOpen: boolean
  onOpenGateway: () => void
  onOpenPanel: () => void
  onOpenRoute: (path: string) => void
  panelPanes: PanelEntry[]
}

export function SettingsMenu({ children, gatewayDialogOpen, onOpenGateway, onOpenPanel, onOpenRoute, panelPanes }: SettingsMenuProps) {
  return <ActionsMenu align="end" ariaLabel="Settings and workspace" contentClassName="w-40 browser-settings-menu" onCloseAutoFocus={event => { if (gatewayDialogOpen) event.preventDefault() }} items={kit => <>
    <kit.Label>Notifications</kit.Label>
    <BrowserActivityToastsItem />
    {panelPanes.length > 0 && <>
      <kit.Separator />
      <kit.Label>Panels</kit.Label>
      {panelPanes.map(pane => {
        const title = String(pane.title || pane.id)
        const icon = pane.id === 'review' ? 'git-compare' : 'files'
        const data = pane.data as { collapsible?: boolean } | undefined
        return <BrowserPanelButton key={pane.id} id={pane.id} title={sentenceCase(title)} ariaLabel={title} icon={<Codicon name={icon} size="0.875rem" />} collapsible={Boolean(data?.collapsible)} onOpen={onOpenPanel} />
      })}
    </>}
    <kit.Separator />
    <kit.Label>Systems</kit.Label>
    <kit.Item onSelect={() => onOpenRoute('/settings')}><Codicon name="settings-gear" size="0.875rem" /><span>Settings</span></kit.Item>
    <kit.Item onSelect={onOpenGateway}><Codicon name="pulse" size="0.875rem" /><span>Gateway</span></kit.Item>
    <kit.Separator />
    <kit.Label>Workspace</kit.Label>
    {APP_ROUTES.filter(route => WORKSPACE_ROUTE_IDS.has(route.id)).map(route => <kit.Item key={route.path} onSelect={() => onOpenRoute(route.path)}>
      <Codicon name={toolRouteIcon(route.id)} size="0.875rem" /><span>{toolRouteLabel(route.id)}</span>
    </kit.Item>)}
  </>}>
    {children}
  </ActionsMenu>
}

function sentenceCase(label: string) {
  const value = label.replaceAll('-', ' ').trim()
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value
}
