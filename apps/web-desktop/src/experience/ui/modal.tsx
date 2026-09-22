import { useRef, type ReactNode, type RefObject } from 'react'
import { Dialog, DialogContent, DialogTitle } from '../../upstream/browser-api'

/** Browser modal focus enters its heading and returns to its opening control. */
export function BrowserModal({ title, open, onOpenChange, returnFocus, className, children }: {
  title: string
  open: boolean
  onOpenChange: (open: boolean) => void
  returnFocus: RefObject<HTMLElement | null>
  className?: string
  children: ReactNode
}) {
  const heading = useRef<HTMLHeadingElement>(null)
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className={className} bodyClassName="gap-0 p-0" aria-describedby={undefined} onOpenAutoFocus={event => { event.preventDefault(); heading.current?.focus() }} onCloseAutoFocus={event => { event.preventDefault(); returnFocus.current?.focus() }}>
      <DialogTitle ref={heading} tabIndex={-1} className="browser-modal-title">{title}</DialogTitle>
      {children}
    </DialogContent>
  </Dialog>
}
