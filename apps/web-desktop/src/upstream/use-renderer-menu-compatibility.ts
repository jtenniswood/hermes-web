import { useEffect } from 'react'
import { useMobileBrowser } from '../experience/ui/use-compact-browser'

const subTrigger = '[data-slot="dropdown-menu-sub-trigger"], [data-slot="context-menu-sub-trigger"]'
const subContent = '[data-slot="dropdown-menu-sub-content"], [data-slot="context-menu-sub-content"]'

/** Keep renderer menu event and focus workarounds out of the browser shell. */
export function useRendererMenuCompatibility() {
  const compact = useMobileBrowser()
  useEffect(() => {
    if (!compact) return
    let focusFrame = 0
    const focusAfterUpdate = (target: () => HTMLElement | null) => {
      cancelAnimationFrame(focusFrame)
      focusFrame = requestAnimationFrame(() => target()?.focus({ preventScroll: true }))
    }
    const preventHover = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest(subTrigger)) {
        // Radix checks defaultPrevented before scheduling its hover-open timer.
        event.preventDefault()
      }
    }
    const onClick = (event: MouseEvent) => {
      const trigger = event.target instanceof Element ? event.target.closest<HTMLElement>(subTrigger) : null
      if (!trigger) return
      // Mouse activation normally leaves focus on the trigger. Its parent
      // sheet is now hidden, so move focus into the newly opened submenu.
      focusAfterUpdate(() => document.getElementById(trigger.getAttribute('aria-controls') || ''))
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const content = event.target instanceof Element ? event.target.closest<HTMLElement>(subContent) : null
      if (!content) return
      const closeKey = getComputedStyle(content).direction === 'rtl' ? 'ArrowRight' : 'ArrowLeft'
      if (event.key !== closeKey) return
      // Radix closes the submenu and restores focus before React reveals the
      // parent. Repeat that restoration after the visibility update commits.
      focusAfterUpdate(() => document.getElementById(content.getAttribute('aria-labelledby') || ''))
    }
    document.addEventListener('pointermove', preventHover, true)
    document.addEventListener('click', onClick, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      cancelAnimationFrame(focusFrame)
      document.removeEventListener('pointermove', preventHover, true)
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [compact])

  useEffect(() => {
    let triggerPointerId: number | null = null
    let suppressOpeningClick = false
    let resetTimer = 0
    const onPointerDown = (event: PointerEvent) => {
      triggerPointerId = event.target instanceof Element && event.target.closest('button[aria-haspopup="menu"]') ? event.pointerId : null
      suppressOpeningClick = false
      window.clearTimeout(resetTimer)
    }
    const onPointerUp = (event: PointerEvent) => {
      if (event.pointerId !== triggerPointerId) return
      triggerPointerId = null
      suppressOpeningClick = Boolean(document.querySelector('[data-slot="dropdown-menu-content"][data-state="open"], [data-slot="context-menu-content"][data-state="open"]'))
      if (suppressOpeningClick) resetTimer = window.setTimeout(() => { suppressOpeningClick = false }, 0)
    }
    const onPointerCancel = () => { triggerPointerId = null; suppressOpeningClick = false }
    const onClick = (event: MouseEvent) => {
      if (!suppressOpeningClick || !(event.target instanceof Element) || !event.target.closest('[data-slot="dropdown-menu-content"] [role^="menuitem"], [data-slot="context-menu-content"] [role^="menuitem"]')) return
      suppressOpeningClick = false
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('pointerup', onPointerUp, true)
    document.addEventListener('pointercancel', onPointerCancel, true)
    document.addEventListener('click', onClick, true)
    return () => {
      window.clearTimeout(resetTimer)
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('pointerup', onPointerUp, true)
      document.removeEventListener('pointercancel', onPointerCancel, true)
      document.removeEventListener('click', onClick, true)
    }
  }, [])
}
