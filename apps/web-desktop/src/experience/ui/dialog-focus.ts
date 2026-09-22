import { useLayoutEffect, useRef } from 'react'

/** A moved roster row is a new DOM node with the same source-qualified key. */
export function restoreBrowserControlFocus(target: HTMLElement | null, fallback: HTMLElement | null = null) {
  const key = target?.dataset.browserRosterKey
  const replacement = key ? [...document.querySelectorAll<HTMLElement>('[data-browser-roster-key]')].find(node => node.dataset.browserRosterKey === key) : null
  for (const candidate of [target, replacement, fallback]) {
    if (candidate?.isConnected && candidate.getClientRects().length && !candidate.closest('[hidden],[inert],[aria-hidden="true"]')) {
      candidate.focus()
      return
    }
  }
}

/** Controlled dialogs without a Radix trigger still return to their opening control. */
export function useBrowserDialogReturnFocus(open: boolean) {
  const origin = useRef<{ control: HTMLElement | null; fallback: HTMLElement | null }>({ control: null, fallback: null })
  // Read before descendant inputs autofocus, then retain only committed openings.
  const control = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const fallback = control?.closest('.browser-navigation')?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]') ?? null
  useLayoutEffect(() => { if (open) origin.current = { control, fallback } }, [open])
  return (event: Event) => {
    event.preventDefault()
    restoreBrowserControlFocus(origin.current.control, origin.current.fallback)
  }
}
