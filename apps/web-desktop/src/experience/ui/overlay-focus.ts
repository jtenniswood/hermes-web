import { useLayoutEffect, useRef } from 'react'

const restoredFocus = new WeakSet<HTMLElement>()

/** Automatic composer visibility changes must yield to an overlay's return target.
 * Explicit composer focus requests still work and release this claim on blur. */
export function browserOverlayOwnsReturnedFocus() {
  return document.activeElement instanceof HTMLElement && restoredFocus.has(document.activeElement)
}

/** Focus belongs to each mounted workspace overlay, including keyboard opens. */
export function useBrowserOverlayFocus() {
  const surface = useRef<HTMLDivElement>(null)
  // Capture before descendants can autofocus their search/input during commit.
  const origin = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null)
  useLayoutEffect(() => {
    const element = surface.current
    if (!element) return
    const previous = origin.current
    const controls = () => Array.from(element.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])'))
      .filter(node => node.getClientRects().length && !node.closest('[hidden],[inert],[aria-disabled="true"]'))
    if (!element.contains(document.activeElement)) (controls()[0] || element).focus()
    const onKeyDown = (event: KeyboardEvent) => {
      // Nested overlays and portaled pickers retain their own focus scopes.
      if (event.key !== 'Tab' || event.defaultPrevented || !(event.target instanceof Element) || event.target.closest('[data-overlay-surface]') !== element) return
      const items = controls(), first = items[0], last = items.at(-1)
      if (!first) { event.preventDefault(); element.focus() }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === element)) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    element.addEventListener('keydown', onKeyDown)
    return () => {
      element.removeEventListener('keydown', onKeyDown)
      if ((element.contains(document.activeElement) || document.activeElement === document.body) && previous?.isConnected && previous.getClientRects().length) {
        previous.focus()
        if (document.activeElement === previous) {
          restoredFocus.add(previous)
          previous.addEventListener('blur', () => restoredFocus.delete(previous), { once: true })
        }
      }
    }
  }, [])
  return surface
}
