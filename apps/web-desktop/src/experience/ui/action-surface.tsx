import { Dialog, DropdownMenu } from 'radix-ui'
import { createPortal } from 'react-dom'
import { useEffect, useRef, type ReactNode, type RefObject } from 'react'

export type BrowserAction = {
  key: string
  label: string
  ariaLabel?: string
  icon?: ReactNode
  afterClose?: boolean
  disabled?: boolean
  checked?: boolean
  keepOpen?: boolean
  run: () => void
}

export type BrowserActionGroup = {
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
export function BrowserActionSurface({ title, actions = [], groups, anchor, compact, onClose, fallbackFocus, closeLabel = 'Cancel', className = '' }: {
  title: string
  actions?: BrowserAction[]
  groups?: BrowserActionGroup[]
  className?: string
  anchor: BrowserActionAnchor | null
  compact: boolean
  onClose: () => void
  fallbackFocus?: RefObject<HTMLElement | null>
  closeLabel?: string
}) {
  const returnToTrigger = useRef(true)
  const nextAction = useRef<BrowserAction | null>(null)
  useEffect(() => { if (anchor) returnToTrigger.current = true }, [anchor])
  if (!anchor) return null
  const restoreFocus = (event: Event) => {
    event.preventDefault()
    // Clicking another control expresses a new focus target. Escape and
    // action selection still restore the opening control (or its fallback).
    if (returnToTrigger.current) {
      const target = anchor.returnFocus
      if (target.isConnected && target.getClientRects().length && target.matches('button,a,input,[tabindex]')) target.focus()
      else fallbackFocus?.current?.focus()
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
  const sections = (groups ?? [{ key: 'actions', actions }]).filter(group => group.actions.length)
  const label = (action: BrowserAction) => <>{action.icon && <span className="browser-action-icon" aria-hidden="true">{action.icon}</span>}<span>{action.label}</span></>
  if (compact) return <Dialog.Root open onOpenChange={open => { if (!open) onClose() }}>
    <Dialog.Portal>
      <Dialog.Overlay className="browser-action-backdrop" />
      <Dialog.Content className={`browser-action-sheet ${className}`} data-browser-action-surface aria-describedby={undefined} onCloseAutoFocus={restoreFocus}>
        <Dialog.Title className="browser-action-title">{title}</Dialog.Title>
        <div className="browser-action-list">
          {sections.map(group => <div key={group.key} className="browser-action-group" role="group" aria-label={group.label}>
            {group.label && <h3 className="browser-action-group-label">{group.label}</h3>}
            {group.actions.map(action => <button key={action.key} className="browser-action-item" type="button" role={action.checked === undefined ? undefined : 'checkbox'} aria-label={action.ariaLabel} aria-checked={action.checked} disabled={action.disabled} onClick={() => run(action)}>
              {action.checked !== undefined && <span className="browser-action-check" aria-hidden="true">{action.checked ? '✓' : ''}</span>}{label(action)}
            </button>)}
          </div>)}
        </div>
        <Dialog.Close className="browser-action-item browser-action-close">{closeLabel}</Dialog.Close>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>

  const scale = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--web-ui-scale')) || 1
  return <DropdownMenu.Root open modal={false} onOpenChange={open => { if (!open) onClose() }}>
    {createPortal(<DropdownMenu.Trigger tabIndex={-1} aria-hidden className="browser-action-anchor" style={{ left: anchor.x / scale, top: anchor.y / scale }} />, document.body)}
    <DropdownMenu.Portal>
      <DropdownMenu.Content className={`browser-action-menu ${className}`} data-browser-action-surface aria-label={title} side="bottom" align="start" sideOffset={2} collisionPadding={8} onInteractOutside={() => { returnToTrigger.current = false }} onCloseAutoFocus={restoreFocus}>
        {sections.map(group => <DropdownMenu.Group key={group.key} className="browser-action-group" aria-label={group.label}>
          {group.label && <DropdownMenu.Label className="browser-action-group-label">{group.label}</DropdownMenu.Label>}
          {group.actions.map(action => {
            const onSelect = (event: Event) => {
              if (action.keepOpen) event.preventDefault()
              run(action)
            }
            return action.checked === undefined
              ? <DropdownMenu.Item key={action.key} className="browser-action-item" aria-label={action.ariaLabel} disabled={action.disabled} onSelect={onSelect}>{label(action)}</DropdownMenu.Item>
              : <DropdownMenu.CheckboxItem key={action.key} className="browser-action-item" aria-label={action.ariaLabel} checked={action.checked} disabled={action.disabled} onSelect={onSelect}><span className="browser-action-check" aria-hidden="true"><DropdownMenu.ItemIndicator>✓</DropdownMenu.ItemIndicator></span>{label(action)}</DropdownMenu.CheckboxItem>
          })}
        </DropdownMenu.Group>)}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>
}
