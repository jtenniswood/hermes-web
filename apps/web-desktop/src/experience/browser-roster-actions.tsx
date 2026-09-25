import { useRef, useState, type ReactNode } from 'react'
import { Codicon, type RosterRow } from '../upstream/browser-api'
import { useBrowserBotRowActions, type BotActionCallbacks } from '../upstream/roster-actions'
import { BrowserActionSurface, type BrowserActionAnchor, type BrowserActionGroup } from './ui/action-surface'
import { useMobileBrowser } from './ui/use-compact-browser'

function RosterActions({ name, groups, children, sectionId, actionKey }: { name: string; actionKey: string; groups: BrowserActionGroup[]; children: ReactNode; sectionId?: string }) {
  const compact = useMobileBrowser()
  const trigger = useRef<HTMLButtonElement>(null)
  const fallback = { current: document.querySelector<HTMLElement>('.browser-navigation [role="tab"][aria-selected="true"]') }
  const [anchor, setAnchor] = useState<BrowserActionAnchor | null>(null)
  const open = (x?: number, y?: number) => {
    const control = trigger.current
    if (!control) return
    const bounds = control.getBoundingClientRect()
    setAnchor({ x: x ?? bounds.right, y: y ?? bounds.bottom, returnFocus: control })
  }
  return <div className="browser-roster-action-row" data-section-id={sectionId} onContextMenu={event => { event.preventDefault(); open(event.clientX, event.clientY) }} onKeyDown={event => {
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); open() }
  }}>
    {children}
    <button ref={trigger} data-browser-roster-key={actionKey} type="button" className="browser-roster-action-trigger" aria-label={`Actions for ${name}`} aria-haspopup={compact ? 'dialog' : 'menu'} aria-expanded={Boolean(anchor)} onClick={() => open()}><Codicon name="ellipsis" /></button>
    <BrowserActionSurface title={`Actions for ${name}`} groups={groups} anchor={anchor} compact={compact} fallbackFocus={fallback} onClose={() => setAnchor(null)} />
  </div>
}

export function BrowserBotRowActions({ bot, row, ...callbacks }: BotActionCallbacks & { bot: RosterRow; row: ReactNode }) {
  const model = useBrowserBotRowActions(bot, callbacks)
  return <RosterActions {...model}>{row}</RosterActions>
}

export function BrowserGroupRowActions({ name, row, onOpen, onDelete, deleteLabel }: { name: string; deleteLabel: string; row: ReactNode; onOpen(): void; onDelete(): void }) {
  return <RosterActions name={name} actionKey={`group:${name}`} groups={[{ key: 'group', actions: [
    { key: 'open', label: 'Open Group Chat', run: onOpen },
    { key: 'delete', destructive: true, label: deleteLabel, afterClose: true, run: onDelete }
  ] }]}>{row}</RosterActions>
}

export function BrowserBotSectionHeader({ id, name, count, collapsed, canMoveUp, canMoveDown, onToggle, onRename, onMove, onDelete }: {
  id: string | null; name: string; count: number; collapsed: boolean; canMoveUp: boolean; canMoveDown: boolean
  onToggle(): void; onRename(): void; onMove(delta: number): void; onDelete(): void
}) {
  const heading = <button className="browser-bot-section-heading" type="button" aria-expanded={!collapsed} onClick={onToggle} onDoubleClick={id ? onRename : undefined}>
    <Codicon name={collapsed ? 'chevron-right' : 'chevron-down'} /><Codicon name={id ? 'folder' : 'inbox'} /><span>{id ? name : 'Unassigned'}</span><span className="browser-bot-section-count">{count}</span>
  </button>
  if (!id) return heading
  return <RosterActions name={name} actionKey={`section:${id}`} sectionId={id} groups={[{ key: 'section', actions: [
    { key: 'rename', label: 'Rename', afterClose: true, run: onRename },
    { key: 'up', label: 'Move up', disabled: !canMoveUp, run: () => onMove(-1) },
    { key: 'down', label: 'Move down', disabled: !canMoveDown, run: () => onMove(1) },
    { key: 'delete', destructive: true, label: 'Delete', run: onDelete }
  ] }]}>{heading}</RosterActions>
}
