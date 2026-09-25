import { useState, type RefObject } from 'react'
import { APP_ROUTES, Codicon } from '../upstream/browser-api'
import { useBrowserSettings } from '../upstream/settings'
import { BrowserActionSurface, type BrowserActionAnchor, type BrowserActionGroup } from './ui/action-surface'
import { BrowserToolbarButton } from './ui/toolbar-button'
import { useCompactBrowser } from './ui/use-compact-browser'

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
  triggerRef: RefObject<HTMLButtonElement | null>
  onOpenGateway: () => void
  onOpenPanel: () => void
  onOpenRoute: (path: string) => void
  panelPanes: PanelEntry[]
}

export function SettingsMenu({ triggerRef, onOpenGateway, onOpenPanel, onOpenRoute, panelPanes }: SettingsMenuProps) {
  const compact = useCompactBrowser()
  const [anchor, setAnchor] = useState<BrowserActionAnchor | null>(null)
  const model = useBrowserSettings(panelPanes.map(pane => ({ id: pane.id, collapsible: Boolean((pane.data as { collapsible?: boolean } | undefined)?.collapsible) })))
  const groups: BrowserActionGroup[] = [
    { key: 'panels', label: 'Panels', actions: model.panels.map(panel => {
      const title = String(panelPanes.find(pane => pane.id === panel.id)?.title || panel.id)
      return { key: panel.id, label: sentenceCase(title), ariaLabel: title, checked: panel.checked, icon: <Codicon name={panel.id === 'review' ? 'git-compare' : 'files'} size="1rem" />, afterClose: true, run: () => { if (panel.select()) onOpenPanel() } }
    }) },
    { key: 'systems', label: 'Systems', actions: [
      { key: 'settings', label: 'Settings', icon: <Codicon name="settings-gear" size="1rem" />, afterClose: true, run: () => onOpenRoute('/settings') },
      { key: 'gateway', label: 'Gateway', icon: <Codicon name="pulse" size="1rem" />, afterClose: true, run: onOpenGateway }
    ] },
    { key: 'workspace', label: 'Workspace', actions: APP_ROUTES.filter(route => WORKSPACE_ROUTE_IDS.has(route.id)).map(route => ({ key: route.path, label: toolRouteLabel(route.id), icon: <Codicon name={toolRouteIcon(route.id)} size="1rem" />, afterClose: true, run: () => onOpenRoute(route.path) })) }
  ]
  return <>
    <BrowserToolbarButton ref={triggerRef} tooltip="Settings" aria-label="Open settings menu" aria-haspopup={compact ? 'dialog' : 'menu'} aria-expanded={Boolean(anchor)} onClick={event => {
      const bounds = event.currentTarget.getBoundingClientRect()
      setAnchor({ x: bounds.right, y: bounds.bottom, returnFocus: event.currentTarget })
    }}><Codicon name="settings-gear" /></BrowserToolbarButton>
    <BrowserActionSurface title="Settings and workspace" className="browser-settings-menu" groups={groups} anchor={anchor} compact={compact} onClose={() => setAnchor(null)} fallbackFocus={triggerRef} />
  </>
}

function sentenceCase(label: string) {
  const value = label.replaceAll('-', ' ').trim()
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value
}
