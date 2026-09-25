import { useEffect, useRef, useState, type ReactNode } from 'react'
import { BrowserActionSurface, type BrowserActionAnchor, type BrowserAction } from './ui/action-surface'
import { useCompactBrowser } from './ui/use-compact-browser'

const PINNED_HIDDEN_KEY = 'hermes-web.browser.pinned-section-hidden'
const CRON_HIDDEN_KEY = 'hermes-web.browser.cron-section-hidden'

export function useBrowserSidebarSections() {
  const [pinnedHidden, setPinnedHidden] = useState(() => {
    try { return localStorage.getItem(PINNED_HIDDEN_KEY) === 'true' } catch { return false }
  })
  useEffect(() => {
    try { localStorage.setItem(PINNED_HIDDEN_KEY, String(pinnedHidden)) } catch { /* Optional preference. */ }
  }, [pinnedHidden])
  const [cronHidden, setCronHidden] = useState(() => {
    try { return localStorage.getItem(CRON_HIDDEN_KEY) === 'true' } catch { return false }
  })
  useEffect(() => {
    try { localStorage.setItem(CRON_HIDDEN_KEY, String(cronHidden)) } catch { /* Optional preference. */ }
  }, [cronHidden])
  const actions: BrowserAction[] = [
    { key: 'pinned', label: 'Pinned', checked: !pinnedHidden, keepOpen: true, run: () => setPinnedHidden(value => !value) },
    { key: 'cron', label: 'Cron jobs', checked: !cronHidden, keepOpen: true, run: () => setCronHidden(value => !value) }
  ]
  return { pinnedHidden, cronHidden, actions }
}

export function BrowserSessionsPane({ hidden, sections, children }: { hidden: boolean; sections: ReturnType<typeof useBrowserSidebarSections>; children: ReactNode }) {
  const compact = useCompactBrowser()
  const [anchor, setAnchor] = useState<BrowserActionAnchor | null>(null)
  const pane = useRef<HTMLDivElement>(null)
  const fallback = { current: document.querySelector<HTMLButtonElement>('.browser-navigation-actions-trigger') }
  useEffect(() => { if (hidden) setAnchor(null) }, [hidden])
  useEffect(() => {
    const root = pane.current
    if (!root) return
    const markCronSection = () => {
      for (const header of root.querySelectorAll<HTMLElement>('[data-browser-section-header]')) {
        if (!/\bcron(?:\s+jobs)?\b/i.test(header.textContent || '')) continue
        header.closest<HTMLElement>('[data-sidebar="group"]')?.setAttribute('data-browser-cron-section', '')
      }
    }
    markCronSection()
    const observer = new MutationObserver(markCronSection)
    observer.observe(root, { childList: true, subtree: true, characterData: true })
    return () => observer.disconnect()
  }, [])
  // Let the upstream context-menu coordinator leave this browser surface alone.
  return <div ref={pane} data-hermes-context-menu-trigger="" hidden={hidden} className="browser-pane browser-sessions-pane" data-pinned-hidden={sections.pinnedHidden} data-cron-hidden={sections.cronHidden} onContextMenu={event => {
    // Session-row menus own their actions and must not open the section surface.
    if (event.defaultPrevented || (event.target instanceof Element && event.target.closest('[data-row-actions]'))) return
    event.preventDefault()
    event.stopPropagation()
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('button,a,input,[tabindex]') : null
    setAnchor({ x: event.clientX, y: event.clientY, returnFocus: target || event.currentTarget })
  }}>
    {children}
    <BrowserActionSurface title="Sidebar sections" actions={sections.actions} anchor={anchor} compact={compact} fallbackFocus={fallback} onClose={() => setAnchor(null)} />
  </div>
}
