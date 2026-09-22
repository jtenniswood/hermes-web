import { useEffect, useRef, useState, type PointerEvent, type RefObject, type MouseEvent } from 'react'
import { Codicon } from '../upstream/browser-api'
import { BrowserActionSurface, type BrowserActionAnchor } from './ui/action-surface'
import { BrowserToolbarButton } from './ui/toolbar-button'
import { useCompactBrowser } from './ui/use-compact-browser'
import { clampNavigationWidth, DEFAULT_NAVIGATION_WIDTH, MAX_NAVIGATION_WIDTH, MIN_NAVIGATION_WIDTH, NAVIGATION_TAB_LABELS, NAVIGATION_TABS, readNavigationTab, readNavigationWidth, readVisibleNavigationTabs, type NavigationTab, writeBrowserPreference } from './browser-preferences'

/** Browser navigation preferences and focus never own the conversation state. */
export function useBrowserNavigation({ selectionKey, path, main, trigger }: {
  selectionKey: string
  path: string
  main: RefObject<HTMLElement | null>
  trigger: RefObject<HTMLButtonElement | null>
}) {
  const drawer = useRef<HTMLElement>(null)
  const compact = useCompactBrowser()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [width, setWidth] = useState(readNavigationWidth)
  const [tab, setTab] = useState<NavigationTab>(readNavigationTab)
  const [visibleTabs, setVisibleTabs] = useState<NavigationTab[]>(readVisibleNavigationTabs)
  const previous = useRef({ selectionKey, path })
  useEffect(() => { setDrawerOpen(false) }, [compact])
  useEffect(() => {
    if (previous.current.selectionKey !== selectionKey || previous.current.path !== path) {
      setDrawerOpen(false)
      if (drawerOpen) requestAnimationFrame(() => main.current?.focus())
    }
    previous.current = { selectionKey, path }
  }, [selectionKey, path])
  useEffect(() => { writeBrowserPreference('activeTab', tab) }, [tab])
  useEffect(() => { writeBrowserPreference('navigationTabs', JSON.stringify(visibleTabs)) }, [visibleTabs])
  useEffect(() => { if (!visibleTabs.includes(tab)) setTab(visibleTabs[0]) }, [tab, visibleTabs])
  useEffect(() => { writeBrowserPreference('navigationWidth', String(width)) }, [width])
  useEffect(() => {
    if (!drawerOpen) return
    drawer.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const keydown = (event: KeyboardEvent) => {
      // Portaled controls own focus and Escape until they are dismissed.
      if (event.defaultPrevented || (event.target instanceof Element && event.target.closest('[role="menu"], [data-browser-action-surface]'))) return
      if (event.key === 'Escape') { setDrawerOpen(false); trigger.current?.focus() }
      if (event.key !== 'Tab') return
      const items = [trigger.current, ...Array.from(drawer.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input,select,[tabindex="0"]') || [])].filter((el): el is HTMLElement => Boolean(el?.getClientRects().length))
      const first = items[0], last = items.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', keydown)
    return () => document.removeEventListener('keydown', keydown)
  }, [drawerOpen])
  return {
    drawer, compact, drawerOpen, collapsed, width, setWidth, tab, setTab, visibleTabs,
    open: compact ? drawerOpen : !collapsed,
    toggle: () => compact ? setDrawerOpen(open => !open) : setCollapsed(value => !value),
    closeDrawer: () => setDrawerOpen(false),
    dismissDrawer: () => { setDrawerOpen(false); trigger.current?.focus() },
    toggleTab(value: NavigationTab) {
      setVisibleTabs(current => {
        if (current.includes(value)) return current.length === 1 ? current : current.filter(item => item !== value)
        return NAVIGATION_TABS.filter(item => current.includes(item) || item === value)
      })
    }
  }
}

type Navigation = ReturnType<typeof useBrowserNavigation>

export function BrowserNavigationTabs({ navigation }: { navigation: Navigation }) {
  const [anchor, setAnchor] = useState<BrowserActionAnchor | null>(null)
  const actionsTrigger = useRef<HTMLButtonElement>(null)
  const { tab, setTab, visibleTabs, compact, open } = navigation
  useEffect(() => { if (!open) setAnchor(null) }, [open])
  const showActions = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const bounds = event.currentTarget.getBoundingClientRect()
    setAnchor({ x: event.type === 'contextmenu' ? event.clientX : bounds.left, y: event.type === 'contextmenu' ? event.clientY : bounds.bottom, returnFocus: event.currentTarget })
  }
  return <>
    <div className="browser-navigation-heading">
      <div className="browser-navigation-tabs" role="tablist" aria-label="Navigation" onContextMenu={showActions}>
        {visibleTabs.map((value, index) => <button key={value} type="button" role="tab" tabIndex={tab === value ? 0 : -1} aria-selected={tab === value} onKeyDown={event => {
          const next = event.key === 'ArrowRight' ? visibleTabs[(index + 1) % visibleTabs.length] : event.key === 'ArrowLeft' ? visibleTabs[(index + visibleTabs.length - 1) % visibleTabs.length] : null
          if (next) {
            event.preventDefault()
            event.stopPropagation()
            setTab(next)
            ;(event.currentTarget.parentElement?.children[visibleTabs.indexOf(next)] as HTMLElement)?.focus()
          }
        }} onClick={() => { setAnchor(null); setTab(value) }}>{NAVIGATION_TAB_LABELS[value]}</button>)}
      </div>
      <BrowserToolbarButton ref={actionsTrigger} tooltip="Navigation tabs" className="browser-navigation-actions-trigger" aria-label="Navigation tabs" aria-haspopup={compact ? 'dialog' : 'menu'} aria-expanded={Boolean(anchor)} onClick={showActions}><Codicon name="ellipsis" size="1rem" /></BrowserToolbarButton>
    </div>
    <BrowserActionSurface title="Navigation tabs" anchor={anchor} compact={compact} fallbackFocus={actionsTrigger} onClose={() => setAnchor(null)} closeLabel="Done" actions={NAVIGATION_TABS.map(value => ({
      key: value, label: NAVIGATION_TAB_LABELS[value], checked: visibleTabs.includes(value), disabled: visibleTabs.includes(value) && visibleTabs.length === 1, keepOpen: true, run: () => navigation.toggleTab(value)
    }))} />
  </>
}

export function BrowserNavigationResizer({ navigation }: { navigation: Navigation }) {
  const resize = useRef<{ startX: number; startWidth: number; scale: number } | null>(null)
  const { width, setWidth } = navigation
  const finish = (event: PointerEvent<HTMLDivElement>) => {
    resize.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  return <div className="browser-navigation-resizer" hidden={!navigation.open} role="separator" tabIndex={0} aria-label="Resize navigation panel" aria-orientation="vertical" aria-valuemin={MIN_NAVIGATION_WIDTH} aria-valuemax={MAX_NAVIGATION_WIDTH} aria-valuenow={Math.round(width)} onPointerDown={event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    event.preventDefault()
    const scale = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--web-ui-scale')) || 1
    resize.current = { startX: event.clientX, startWidth: width, scale }
    event.currentTarget.setPointerCapture(event.pointerId)
  }} onPointerMove={event => {
    const start = resize.current
    if (start) setWidth(clampNavigationWidth(start.startWidth + (event.clientX - start.startX) / start.scale))
  }} onPointerUp={finish} onPointerCancel={finish} onDoubleClick={() => setWidth(DEFAULT_NAVIGATION_WIDTH)} onKeyDown={event => {
    if (event.key === 'ArrowLeft') { event.preventDefault(); setWidth(value => clampNavigationWidth(value - 16)) }
    if (event.key === 'ArrowRight') { event.preventDefault(); setWidth(value => clampNavigationWidth(value + 16)) }
    if (event.key === 'Home') { event.preventDefault(); setWidth(MIN_NAVIGATION_WIDTH) }
    if (event.key === 'End') { event.preventDefault(); setWidth(MAX_NAVIGATION_WIDTH) }
  }} />
}
