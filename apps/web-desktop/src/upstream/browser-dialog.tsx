import { createContext, useContext, useState, type ComponentProps } from 'react'
import {
  Dialog as UpstreamDialog,
  DialogContent as UpstreamDialogContent
} from '@/components/ui/dialog'
import { useBrowserDialogReturnFocus } from '../experience/ui/dialog-focus'
import { browserDialogStyle } from '../experience/ui/dialog-layout'

// This module is resolved only for the registered dialog consumers. Its own
// imports reach the upstream primitives, retaining portals, banners and a11y.
export {
  DialogClose, DialogDescription, DialogFooter, DialogHeader, DialogOverlay,
  DialogPortal, DialogTitle, DialogTrigger, preventCloseButtonAutoFocus
} from '@/components/ui/dialog'

const ReturnFocus = createContext<((event: Event) => void) | null>(null)

export function Dialog({ open, defaultOpen = false, onOpenChange, ...props }: ComponentProps<typeof UpstreamDialog>) {
  const [uncontrolledOpen, setOpen] = useState(defaultOpen)
  const returnFocus = useBrowserDialogReturnFocus(open ?? uncontrolledOpen)
  return <ReturnFocus.Provider value={returnFocus}>
    <UpstreamDialog {...props} open={open ?? uncontrolledOpen} onOpenChange={value => {
      setOpen(value)
      onOpenChange?.(value)
    }} />
  </ReturnFocus.Provider>
}

export function DialogContent({ style, onCloseAutoFocus, ...props }: ComponentProps<typeof UpstreamDialogContent>) {
  const returnFocus = useContext(ReturnFocus)
  return <UpstreamDialogContent {...props} style={browserDialogStyle(style)} onCloseAutoFocus={event => {
    onCloseAutoFocus?.(event)
    if (!event.defaultPrevented) returnFocus?.(event)
  }} />
}
