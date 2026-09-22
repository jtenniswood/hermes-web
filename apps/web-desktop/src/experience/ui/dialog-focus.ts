import { useLayoutEffect, useRef } from 'react'

/** Controlled dialogs without a Radix trigger still return to their opening control. */
export function useBrowserDialogReturnFocus(open: boolean) {
  const origin = useRef<HTMLElement | null>(null)
  // Read before descendant inputs autofocus, then retain only committed openings.
  const openingControl = document.activeElement instanceof HTMLElement ? document.activeElement : null
  useLayoutEffect(() => { if (open) origin.current = openingControl }, [open])
  return (event: Event) => {
    event.preventDefault()
    const target = origin.current
    if (target?.isConnected && target.getClientRects().length && !target.closest('[hidden],[inert]')) target.focus()
  }
}
