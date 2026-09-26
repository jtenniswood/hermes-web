import { Dialog, DropdownMenu } from 'radix-ui'
import { restoreBrowserControlFocus } from './dialog-focus'
import { createPortal } from 'react-dom'
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { DropdownMenuLabel, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from '../../upstream/browser-api'

export type BrowserAction = {
  key: string
  label: string
  ariaLabel?: string
  icon?: ReactNode
  afterClose?: boolean
  disabled?: boolean
  destructive?: boolean
  checked?: boolean
  keepOpen?: boolean
  description?: string
  hideSubmenuTitle?: boolean
  children?: BrowserActionGroup[]
  run: () => void
}

export type BrowserActionGroup = {
  selection?: 'single'
  key: string
  label?: string
  actions: BrowserAction[]
}

export type BrowserActionAnchor = {
  x: number
  y: number
  returnFocus: HTMLElement
}

/** One command list, with keyboard menus on desktop and a modal phone sheet. */
export function BrowserActionSurface({ title, hideTitle = false, actions = [], groups, anchor, compact, onClose, fallbackFocus, className = '' }: {
  title: string
  hideTitle?: boolean
  actions?: BrowserAction[]
  groups?: BrowserActionGroup[]
  className?: string
  anchor: BrowserActionAnchor | null
  compact: boolean
  onClose: () => void
  fallbackFocus?: RefObject<HTMLElement | null>
}) {
  const returnToTrigger = useRef(true)
  const nextAction = useRef<BrowserAction | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const pendingFocusKey = useRef<string | null>(null)
  const [submenu, setSubmenu] = useState<BrowserAction | null>(null)
  useEffect(() => { if (!anchor) setSubmenu(null) }, [anchor])
  useEffect(() => { if (anchor) returnToTrigger.current = true }, [anchor])
  useEffect(() => {
    if (!compact || !anchor) return
    const frame = requestAnimationFrame(() => {
      const returnKey = pendingFocusKey.current
      pendingFocusKey.current = null
      const target = returnKey
        ? list.current?.querySelector<HTMLElement>(`[data-action-key="${CSS.escape(returnKey)}"]`)
        : submenu
          ? list.current?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]') || list.current?.querySelector<HTMLElement>('.browser-action-back')
          : list.current?.querySelector<HTMLElement>('button:not([disabled])')
      target?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [anchor, compact, submenu])
  if (!anchor) return null
  const restoreFocus = (event: Event) => {
    event.preventDefault()
    // Clicking another control expresses a new focus target. Escape and
    // action selection still restore the opening control (or its fallback).
    if (returnToTrigger.current) {
      restoreBrowserControlFocus(anchor.returnFocus, fallbackFocus?.current)
    }
    const next = nextAction.current
    nextAction.current = null
    // Let the old focus scope finish cleanup before mounting another surface.
    if (next) queueMicrotask(next.run)
  }

  const run = (action: BrowserAction) => {
    if (action.disabled) return
    if (action.afterClose) { nextAction.current = action; onClose(); return }
    action.run()
    if (!action.keepOpen) onClose()
  }
  const selectRadio = (event: KeyboardEvent<HTMLButtonElement>, group: BrowserActionGroup, action: BrowserAction) => {
    if (!['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const enabled = group.actions.filter(item => !item.disabled)
    const index = enabled.indexOf(action)
    const offset = ['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 1
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1 : (index + offset + enabled.length) % enabled.length
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button[role="radio"]:not(:disabled)')[next]?.focus()
    run(enabled[next])
  }
  const sections = (groups ?? [{ key: 'actions', actions }]).filter(group => group.actions.length)
  const label = (action: BrowserAction) => <>{action.icon && <span className="browser-action-icon" aria-hidden="true">{action.icon}</span>}<span className="browser-action-label">{action.label}{action.description && <small>{action.description}</small>}</span>{action.children && <span className="browser-action-chevron" aria-hidden="true">›</span>}</>
  if (compact) return <Dialog.Root open onOpenChange={open => { if (!open) onClose() }}>
    <Dialog.Portal>
      <Dialog.Overlay className="browser-action-backdrop" />
      <Dialog.Content className={`browser-action-sheet ${className}`} data-browser-action-surface aria-describedby={undefined} onCloseAutoFocus={restoreFocus}>
        <Dialog.Title className="browser-action-title" hidden={hideTitle || submenu?.hideSubmenuTitle}>{submenu?.label || title}</Dialog.Title>
        <div className="browser-action-list" ref={list}>
          {submenu && <button type="button" className="browser-action-item browser-action-back" aria-label="Back to settings menu" onClick={() => { pendingFocusKey.current = submenu.key; setSubmenu(null) }}><span aria-hidden="true">‹</span><span>Back</span></button>}
          {(submenu?.children ?? sections).map(group => <div key={group.key} className="browser-action-group" role={group.selection === 'single' ? 'radiogroup' : 'group'} aria-label={group.label}>
            {group.label && <h3 className="browser-action-group-label">{group.label}</h3>}
            {group.actions.map(action => <button key={action.key} data-action-key={action.key} className="browser-action-item" data-destructive={action.destructive || undefined} type="button" role={action.children ? 'button' : group.selection === 'single' ? 'radio' : action.checked === undefined ? undefined : 'checkbox'} tabIndex={group.selection === 'single' ? (action.checked || (!group.actions.some(item => item.checked) && action === group.actions.find(item => !item.disabled)) ? 0 : -1) : undefined} onKeyDown={group.selection === 'single' && !action.children ? event => selectRadio(event, group, action) : undefined} aria-label={action.ariaLabel} aria-checked={action.children ? undefined : action.checked} aria-haspopup={action.children ? 'menu' : undefined} disabled={action.disabled} onClick={() => action.children ? setSubmenu(action) : run(action)}>
              {action.checked !== undefined && <span className="browser-action-check" aria-hidden="true">{action.checked ? '✓' : ''}</span>}{label(action)}
            </button>)}
          </div>)}
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>

  const scale = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--web-ui-scale')) || 1
  return <DropdownMenu.Root open modal={false} onOpenChange={open => { if (!open) onClose() }}>
    {createPortal(<DropdownMenu.Trigger tabIndex={-1} aria-hidden className="browser-action-anchor" style={{ left: anchor.x / scale, top: anchor.y / scale }} />, document.body)}
    <DropdownMenu.Portal>
      <DropdownMenu.Content className={`browser-action-menu ${className}`} data-browser-action-surface aria-label={title} side="bottom" align="start" sideOffset={2} collisionPadding={8} onInteractOutside={() => { returnToTrigger.current = false }} onCloseAutoFocus={restoreFocus}>
        {sections.map(group => {
          const Group = group.selection === 'single' ? DropdownMenu.RadioGroup : DropdownMenu.Group
          return <Group key={group.key} className="browser-action-group" aria-label={group.label} {...(group.selection === 'single' ? { value: group.actions.find(action => action.checked)?.key } : {})}>
            {group.label && <DropdownMenu.Label className="browser-action-group-label">{group.label}</DropdownMenu.Label>}
            {group.actions.map(action => {
              const onSelect = (event: Event) => {
                if (action.keepOpen) event.preventDefault()
                run(action)
              }
              const indicator = <span className="browser-action-check" aria-hidden="true"><DropdownMenu.ItemIndicator>✓</DropdownMenu.ItemIndicator></span>
              if (action.children) return <DropdownMenuSub key={action.key}>
                <DropdownMenuSubTrigger className="browser-action-item" aria-label={action.ariaLabel} disabled={action.disabled} hideChevron>{label(action)}</DropdownMenuSubTrigger>
                <DropdownMenuSubContent className={`browser-action-menu ${className}`} data-browser-action-surface sideOffset={4} collisionPadding={8}>
                  {action.children.filter(child => child.actions.length).map(child => {
                    const nestedItems = child.actions.map(nested => {
                      const nestedSelect = (event: Event) => { if (nested.keepOpen) event.preventDefault(); run(nested) }
                      if (child.selection === 'single') return <DropdownMenu.RadioItem key={nested.key} className="browser-action-item" value={nested.key} disabled={nested.disabled} onSelect={nestedSelect}>
                        {indicator}{label(nested)}
                      </DropdownMenu.RadioItem>
                      return nested.checked === undefined
                        ? <DropdownMenu.Item key={nested.key} className="browser-action-item" disabled={nested.disabled} onSelect={nestedSelect}>{label(nested)}</DropdownMenu.Item>
                        : <DropdownMenu.CheckboxItem key={nested.key} className="browser-action-item" checked={nested.checked} disabled={nested.disabled} onSelect={nestedSelect}>{indicator}{label(nested)}</DropdownMenu.CheckboxItem>
                    })
                    return <DropdownMenu.Group key={child.key} className="browser-action-group" aria-label={child.label}>
                      {child.label && <DropdownMenuLabel className="browser-action-group-label">{child.label}</DropdownMenuLabel>}
                      {child.selection === 'single'
                        ? <DropdownMenu.RadioGroup value={child.actions.find(item => item.checked)?.key || ''}>{nestedItems}</DropdownMenu.RadioGroup>
                        : nestedItems}
                    </DropdownMenu.Group>
                  })}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              if (group.selection === 'single') return <DropdownMenu.RadioItem key={action.key} value={action.key} className="browser-action-item" aria-label={action.ariaLabel} disabled={action.disabled} onSelect={onSelect}>{indicator}{label(action)}</DropdownMenu.RadioItem>
              return action.checked === undefined
                ? <DropdownMenu.Item key={action.key} className="browser-action-item" data-destructive={action.destructive || undefined} aria-label={action.ariaLabel} disabled={action.disabled} onSelect={onSelect}>{label(action)}</DropdownMenu.Item>
                : <DropdownMenu.CheckboxItem key={action.key} className="browser-action-item" aria-label={action.ariaLabel} checked={action.checked} disabled={action.disabled} onSelect={onSelect}>{indicator}{label(action)}</DropdownMenu.CheckboxItem>
            })}
          </Group>
        })}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>
}
