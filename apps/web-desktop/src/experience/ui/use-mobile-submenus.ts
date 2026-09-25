import { useEffect } from 'react'
import { useMobileBrowser } from './use-compact-browser'

const subTrigger = '[data-slot="dropdown-menu-sub-trigger"], [data-slot="context-menu-sub-trigger"]'
const subContent = '[data-slot="dropdown-menu-sub-content"], [data-slot="context-menu-sub-content"]'

/** Adapt renderer-owned Radix submenus to the browser's single mobile sheet. */
export function useMobileSubmenus() {
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
}
