import { useState, type RefObject } from 'react'
import { useStore } from '@nanostores/react'
import { $activeGatewayProfile } from '@/store/profile'
import { useGatewayRequest } from '@/app/gateway/hooks/use-gateway-request'
import { APP_ROUTES, Codicon, useI18n, type StatusbarItem } from '../upstream/browser-api'
import { useBrowserApproval } from '../upstream/approval'
import type { BrowserApprovalMode } from './contracts/actions'
import { useBrowserSettings } from '../upstream/settings'
import { BrowserActionSurface, type BrowserActionAnchor, type BrowserActionGroup } from './ui/action-surface'
import { BrowserToolbarButton } from './ui/toolbar-button'
import { useMobileBrowser } from './ui/use-compact-browser'

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
  backendVersion: StatusbarItem | null
  onOpenGateway: () => void
  onOpenPanel: () => void
  onOpenRoute: (path: string) => void
  panelPanes: PanelEntry[]
}

export function SettingsMenu({ triggerRef, backendVersion, onOpenGateway, onOpenPanel, onOpenRoute, panelPanes }: SettingsMenuProps) {
  const compact = useMobileBrowser()
  const [anchor, setAnchor] = useState<BrowserActionAnchor | null>(null)
  const { t } = useI18n()
  const activeProfile = useStore($activeGatewayProfile)
  const { requestGateway } = useGatewayRequest()
  const { mode, setMode } = useBrowserApproval(activeProfile || 'default', requestGateway)
  const approvalCopy = t.shell.approvalMode
  const approvalLabels: Record<BrowserApprovalMode, string> = { manual: approvalCopy.manual, smart: approvalCopy.smart, off: approvalCopy.off }
  const approvalDescriptions: Record<BrowserApprovalMode, string> = { manual: approvalCopy.manualDescription, smart: 'Ask when needed', off: approvalCopy.offDescription }
  const model = useBrowserSettings(panelPanes.map(pane => ({ id: pane.id, collapsible: Boolean((pane.data as { collapsible?: boolean } | undefined)?.collapsible) })))
  const groups: BrowserActionGroup[] = [
    { key: 'panels', label: 'Panels', actions: model.panels.map(panel => {
      const title = String(panelPanes.find(pane => pane.id === panel.id)?.title || panel.id)
      return { key: panel.id, label: sentenceCase(title), ariaLabel: title, checked: panel.checked, icon: <Codicon name={panel.id === 'review' ? 'git-compare' : 'files'} size="1rem" />, afterClose: true, run: () => { if (panel.select()) onOpenPanel() } }
    }) },
    { key: 'systems', label: 'Systems', actions: [
      { key: 'settings', label: 'Settings', icon: <Codicon name="settings-gear" size="1rem" />, afterClose: true, run: () => onOpenRoute('/settings') },
      { key: 'approval-mode', label: 'Approval mode', hideSubmenuTitle: true, icon: <Codicon name="shield" size="1rem" />, children: [{ key: 'approval-modes', selection: 'single', actions: (['manual', 'smart', 'off'] as const).map(value => ({ key: value, label: approvalLabels[value], description: approvalDescriptions[value], checked: mode === value, afterClose: true, run: () => void setMode(value) })) }], run: () => {} },
      { key: 'gateway', label: 'Gateway', icon: <Codicon name="pulse" size="1rem" />, afterClose: true, run: onOpenGateway }
    ] },
    ...(backendVersion ? [{ key: 'updates', label: 'Updates', actions: [{ key: backendVersion.id, label: typeof backendVersion.label === 'string' ? backendVersion.label : 'Backend update', icon: backendVersion.icon, disabled: backendVersion.disabled, afterClose: true, run: () => backendVersion.onSelect?.({ shiftKey: false }) }] }] : []),
    { key: 'workspace', actions: [{ key: 'workspace-options', label: 'Workspace', icon: <Codicon name="folder" size="1rem" />, children: [{ key: 'workspace-routes', actions: APP_ROUTES.filter(route => WORKSPACE_ROUTE_IDS.has(route.id)).map(route => ({ key: route.path, label: toolRouteLabel(route.id), icon: <Codicon name={toolRouteIcon(route.id)} size="1rem" />, afterClose: true, run: () => onOpenRoute(route.path) })) }], run: () => {} }] }
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
