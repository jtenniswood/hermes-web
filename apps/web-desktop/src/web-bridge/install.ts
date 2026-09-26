/**
 * Installs the web bridge as `window.hermesDesktop` when explicitly called.
 *
 * Startup must call this before loading the upstream renderer. Several stores
 * touch the bridge at module-evaluation time (translucency, zoom, clipboard).
 *
 * Installation is skipped when a bridge already exists so the same source
 * tree still works under Electron and under test mocks.
 */
import { createWebBridge } from './bridge'

export function installWebBridge(): void {
  if (typeof window === 'undefined') return

  // The browser shell owns its contextual menus, so suppress the browser page
  // menu before the renderer's default handler can consume the event.
  window.addEventListener('contextmenu', event => {
    if (document.documentElement.dataset.experience === 'browser') {
      // Radix checks defaultPrevented before opening and suppresses the native
      // menu itself. Let marked triggers receive an unhandled gesture.
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('[data-hermes-context-menu-trigger]')) return
      event.preventDefault()
    }
  }, true)

  // HUD is an Electron window mode. Normalize stale/bookmarked HUD URLs before
  // the upstream renderer reads window.location.search during module startup.
  const url = new URL(window.location.href)

  if (url.searchParams.get('win') === 'hud') {
    url.searchParams.delete('win')
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
  }

  if (!window.hermesDesktop) {
    window.hermesDesktop = createWebBridge()
  }
}
