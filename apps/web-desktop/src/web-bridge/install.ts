/**
 * Side-effect module: installs the web bridge as `window.hermesDesktop`.
 *
 * MUST be the first import in `main.tsx`. Several stores touch the bridge at
 * module-evaluation time (store/translucency, store/zoom, lib/clipboard), and
 * ES module imports execute in order, so this file has to run before them.
 *
 * Installation is skipped when a bridge already exists so the same source
 * tree still works under Electron and under test mocks.
 */
import { createWebBridge } from './bridge'

// The browser shell owns its contextual menus, so suppress the browser page
// menu before the renderer's default handler can consume the event.
if (typeof window !== 'undefined') {
  window.addEventListener('contextmenu', event => {
    if (document.documentElement.dataset.experience === 'browser') {
      // Radix checks defaultPrevented before opening and suppresses the native
      // menu itself. Let marked triggers receive an unhandled gesture.
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('[data-hermes-context-menu-trigger]')) return
      event.preventDefault()
    }
  }, true)
}

// HUD is an Electron window mode. The browser wrapper has no separate native
// window for it, so treat stale/bookmarked HUD URLs as the normal app before
// the upstream renderer reads `window.location.search` during module startup.
if (typeof window !== 'undefined') {
  const url = new URL(window.location.href)

  if (url.searchParams.get('win') === 'hud') {
    url.searchParams.delete('win')
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
  }
}

if (typeof window !== 'undefined' && !window.hermesDesktop) {
  window.hermesDesktop = createWebBridge()
}

export {}
