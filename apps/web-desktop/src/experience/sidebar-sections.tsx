import { useEffect, useRef, useState, type ReactNode } from 'react'
import { BrowserActionSurface, type BrowserActionAnchor, type BrowserAction } from './ui/action-surface'
import { useMobileBrowser } from './ui/use-compact-browser'

const HIDDEN_SECTIONS_KEY = 'hermes-web.browser.hidden-sections'
const PINNED_HIDDEN_KEY = 'hermes-web.browser.pinned-section-hidden'
const CRON_HIDDEN_KEY = 'hermes-web.browser.cron-section-hidden'

type SidebarSection = { key: string; label: string }

function readHiddenSections(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(HIDDEN_SECTIONS_KEY) || 'null')
    if (Array.isArray(saved)) return saved.filter((value): value is string => typeof value === 'string')
    // Carry forward section preferences from versions that only exposed these two options.
    const hidden: string[] = []
    if (localStorage.getItem(PINNED_HIDDEN_KEY) === 'true') hidden.push('pinned')
    if (localStorage.getItem(CRON_HIDDEN_KEY) === 'true') hidden.push('cron-jobs')
    return hidden
  } catch { return [] }
}

function sectionKey(label: string, group: HTMLElement): string {
  if (group.classList.contains('browser-pinned-section')) return 'pinned'
  if (group.classList.contains('browser-session-list-section')) return 'sessions'
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function sectionLabel(header: HTMLElement | null): string {
  const label = header?.querySelector<HTMLElement>('[data-browser-section-label]')?.textContent?.trim() || ''
  const repeated = /^(.+?)\s*\1$/.exec(label)
  return repeated?.[1] || label
}

export function useBrowserSidebarSections() {
  const [hiddenSections, setHiddenSections] = useState(readHiddenSections)
  const [availableSections, setAvailableSections] = useState<SidebarSection[]>([])
  useEffect(() => {
    try { localStorage.setItem(HIDDEN_SECTIONS_KEY, JSON.stringify(hiddenSections)) } catch { /* Optional preference. */ }
  }, [hiddenSections])
  const actions: BrowserAction[] = availableSections.map(section => ({
    key: section.key,
    label: section.label,
    checked: !hiddenSections.includes(section.key),
    keepOpen: true,
    run: () => setHiddenSections(current => current.includes(section.key) ? current.filter(key => key !== section.key) : [...current, section.key])
  }))
  return { hiddenSections, setAvailableSections, actions }
}

export function BrowserSessionsPane({ hidden, sections, children }: { hidden: boolean; sections: ReturnType<typeof useBrowserSidebarSections>; children: ReactNode }) {
  const compact = useMobileBrowser()
  const [anchor, setAnchor] = useState<BrowserActionAnchor | null>(null)
  const pane = useRef<HTMLDivElement>(null)
  const fallback = { current: document.querySelector<HTMLButtonElement>('.browser-navigation-actions-trigger') }
  useEffect(() => { if (hidden) setAnchor(null) }, [hidden])
  useEffect(() => {
    const root = pane.current
    if (!root) return
    const markSections = () => {
      const groups = Array.from(root.querySelectorAll<HTMLElement>('[data-sidebar="group"]'))
      const discovered: SidebarSection[] = []
      for (const group of groups) {
        const header = group.querySelector<HTMLElement>(':scope > [data-browser-section-header]')
        const label = sectionLabel(header)
        if (!label) continue
        const key = sectionKey(label, group)
        if (key) discovered.push({ key, label })
      }
      const pinned = root.querySelector<HTMLElement>('.browser-pinned-section')
      if (pinned && !discovered.some(section => section.key === 'pinned')) discovered.push({ key: 'pinned', label: 'Pinned' })
      // Cron is omitted by upstream when there are no jobs; keep its visibility option available.
      if (!discovered.some(section => section.key === 'cron-jobs')) discovered.push({ key: 'cron-jobs', label: 'Cron jobs' })
      const unique = [...new Map(discovered.map(section => [section.key, section])).values()]
      sections.setAvailableSections(current => current.length === unique.length && current.every((section, index) => section.key === unique[index]?.key && section.label === unique[index]?.label) ? current : unique)

      for (const group of groups) {
        const header = group.querySelector<HTMLElement>(':scope > [data-browser-section-header]')
        const label = sectionLabel(header)
        const key = label ? sectionKey(label, group) : ''
        group.toggleAttribute('data-browser-section-hidden', Boolean(key) && sections.hiddenSections.includes(key))
      }
      if (pinned) pinned.toggleAttribute('data-browser-section-hidden', sections.hiddenSections.includes('pinned'))
    }
    markSections()
    const observer = new MutationObserver(markSections)
    observer.observe(root, { childList: true, subtree: true, characterData: true })
    return () => observer.disconnect()
  }, [sections.hiddenSections, sections.setAvailableSections])
  // Let the upstream context-menu coordinator leave this browser surface alone.
  return <div ref={pane} data-hermes-context-menu-trigger="" hidden={hidden} className="browser-pane browser-sessions-pane" onContextMenu={event => {
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
