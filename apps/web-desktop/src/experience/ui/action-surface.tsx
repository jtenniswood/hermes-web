import { Dialog, DropdownMenu } from 'radix-ui'
import { createPortal } from 'react-dom'
import { useEffect, useRef, type RefObject } from 'react'

export type BrowserAction = {
  key: string
  label: string
  disabled?: boolean
  run: () => void
}

export type BrowserActionAnchor = {
  x: number
  y: number
  returnFocus: HTMLElement
}

/** One command list, with keyboard menus on desktop and a modal phone sheet. */
export function BrowserActionSurface({ title, actions, anchor, compact, onClose, fallbackFocus }: {
  title: string
  actions: BrowserAction[]
  anchor: BrowserActionAnchor | null
  compact: boolean
  onClose: () => void
  fallbackFocus?: RefObject<HTMLElement | null>
}) {
  const returnToTrigger = useRef(true)
  useEffect(() => { if (anchor) returnToTrigger.current = true }, [anchor])
  if (!anchor) return null
  const restoreFocus = (event: Event) => {
    event.preventDefault()
    // Clicking another control expresses a new focus target. Escape and
    // action selection still restore the opening control (or its fallback).
    if (!returnToTrigger.current) return
    const target = anchor.returnFocus
    if (target.isConnected && target.getClientRects().length && target.matches('button,a,input,[tabindex]')) target.focus()
    else fallbackFocus?.current?.focus()
  }
  const run = (action: BrowserAction) => {
    if (action.disabled) return
    action.run()
    onClose()
  }
  if (compact) return <Dialog.Root open onOpenChange={open => { if (!open) onClose() }}>
    <Dialog.Portal>
      <Dialog.Overlay className="browser-action-backdrop" />
      <Dialog.Content className="browser-action-sheet" data-browser-action-surface aria-describedby={undefined} onCloseAutoFocus={restoreFocus}>
        <Dialog.Title className="browser-action-title">{title}</Dialog.Title>
        <div className="browser-action-list">
          {actions.map(action => <button key={action.key} className="browser-action-item" type="button" disabled={action.disabled} onClick={() => run(action)}>{action.label}</button>)}
        </div>
        <Dialog.Close className="browser-action-item browser-action-close">Cancel</Dialog.Close>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>

  const scale = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--web-ui-scale')) || 1
  return <DropdownMenu.Root open modal={false} onOpenChange={open => { if (!open) onClose() }}>
    {createPortal(<DropdownMenu.Trigger tabIndex={-1} aria-hidden className="browser-action-anchor" style={{ left: anchor.x / scale, top: anchor.y / scale }} />, document.body)}
    <DropdownMenu.Portal>
      <DropdownMenu.Content className="browser-action-menu" data-browser-action-surface aria-label={title} side="bottom" align="start" sideOffset={2} collisionPadding={8} onInteractOutside={() => { returnToTrigger.current = false }} onCloseAutoFocus={restoreFocus}>
        {actions.map(action => <DropdownMenu.Item key={action.key} className="browser-action-item" disabled={action.disabled} onSelect={() => run(action)}>{action.label}</DropdownMenu.Item>)}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>
}
