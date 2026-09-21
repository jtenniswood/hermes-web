/** Browser-scoped preferences. Keys stay stable to preserve existing installs. */
export const NAVIGATION_TABS = ['sessions', 'bots'] as const
export type NavigationTab = typeof NAVIGATION_TABS[number]
export const NAVIGATION_TAB_LABELS: Record<NavigationTab, string> = { sessions: 'Sessions', bots: 'Bots' }
export const DEFAULT_NAVIGATION_WIDTH = 304
export const MIN_NAVIGATION_WIDTH = 224
export const MAX_NAVIGATION_WIDTH = 560

const KEYS = {
  activeTab: 'hermes-web.browser.navigation',
  hiddenProfiles: 'hermes-web.browser.hidden-profiles',
  navigationTabs: 'hermes-web.browser.navigation-tabs',
  navigationWidth: 'hermes-web.browser.navigation-width'
} as const

function storage(): Storage | null {
  try { return window.localStorage } catch { return null }
}

function read(key: string): string | null {
  try { return storage()?.getItem(key) ?? null } catch { return null }
}

export function writeBrowserPreference(key: keyof typeof KEYS, value: string): void {
  try { storage()?.setItem(KEYS[key], value) } catch { /* Optional browser preference. */ }
}

export function clampNavigationWidth(width: number): number {
  return Math.min(MAX_NAVIGATION_WIDTH, Math.max(MIN_NAVIGATION_WIDTH, width))
}

export function readNavigationTab(): NavigationTab {
  return read(KEYS.activeTab) === 'bots' ? 'bots' : 'sessions'
}

export function readVisibleNavigationTabs(): NavigationTab[] {
  try {
    const saved = JSON.parse(read(KEYS.navigationTabs) || 'null')
    if (Array.isArray(saved)) {
      const visible = NAVIGATION_TABS.filter(value => saved.includes(value))
      if (visible.length) return visible
    }
  } catch { /* Malformed or unavailable preference uses the safe default. */ }
  return [...NAVIGATION_TABS]
}

export function readHiddenProfiles(): string[] {
  try {
    const saved = JSON.parse(read(KEYS.hiddenProfiles) || 'null')
    return Array.isArray(saved) ? saved.filter((value): value is string => typeof value === 'string') : []
  } catch { return [] }
}

export function readNavigationWidth(): number {
  const saved = Number(read(KEYS.navigationWidth))
  return Number.isFinite(saved) ? clampNavigationWidth(saved) : DEFAULT_NAVIGATION_WIDTH
}
