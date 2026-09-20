import type {} from '../upstream/types'

const WEB_ZOOM_STORAGE_KEY = 'hermes-web.ui-scale'
const MOBILE_WEB_ZOOM_STORAGE_KEY = 'hermes-web.ui-scale.mobile'
const ZOOM_FACTOR_BASE = 1.2
const DESKTOP_DEFAULT_ZOOM_LEVEL = Math.log(0.9) / Math.log(ZOOM_FACTOR_BASE)
const MOBILE_DEFAULT_ZOOM_LEVEL = Math.log(1.25) / Math.log(ZOOM_FACTOR_BASE)
const MIN_ZOOM_LEVEL = -9
const MAX_ZOOM_LEVEL = 9
const ZOOM_STEP = 0.1

type WebZoomChange = { level: number; percent: number }

function clampZoomLevel(level: number): number {
  if (!Number.isFinite(level)) {
    return defaultZoomLevel()
  }

  return Math.min(Math.max(level, MIN_ZOOM_LEVEL), MAX_ZOOM_LEVEL)
}

function isMobileDevice(): boolean {
  return typeof window !== 'undefined' &&
    window.matchMedia('(pointer: coarse)').matches &&
    window.matchMedia('(max-width: 64rem)').matches
}

function defaultZoomLevel(): number {
  return isMobileDevice() ? MOBILE_DEFAULT_ZOOM_LEVEL : DESKTOP_DEFAULT_ZOOM_LEVEL
}

function zoomStorageKey(): string {
  return isMobileDevice() ? MOBILE_WEB_ZOOM_STORAGE_KEY : WEB_ZOOM_STORAGE_KEY
}

function percentToZoomLevel(percent: number): number {
  if (!Number.isFinite(percent) || percent <= 0) {
    return defaultZoomLevel()
  }

  return clampZoomLevel(Math.log(percent / 100) / Math.log(ZOOM_FACTOR_BASE))
}

function zoomLevelToPercent(level: number): number {
  return Math.round(Math.pow(ZOOM_FACTOR_BASE, clampZoomLevel(level)) * 100)
}

function readStoredZoomPercent(): number {
  try {
    const stored = Number(window.localStorage.getItem(zoomStorageKey()))

    return Number.isFinite(stored) && stored > 0 ? stored : zoomLevelToPercent(defaultZoomLevel())
  } catch {
    return zoomLevelToPercent(defaultZoomLevel())
  }
}

function isEditableZoomTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName))
}

/** Browser equivalent of Electron's global window zoom bridge. */
export function createWebZoomBridge(): NonNullable<Window['hermesDesktop']['zoom']> {
  let level = percentToZoomLevel(readStoredZoomPercent())
  const listeners = new Set<(change: WebZoomChange) => void>()

  const current = (): WebZoomChange => ({ level, percent: zoomLevelToPercent(level) })

  const apply = (nextLevel: number, persist: boolean): void => {
    level = clampZoomLevel(nextLevel)
    const change = current()

    // CSS zoom is supported by the Chromium browsers used by the web app and
    // scales layout, text, controls, and icons together like Electron's
    // webContents.setZoomLevel(). Apply it before the renderer mounts to avoid
    // a visible jump on startup.
    const scale = String(change.percent / 100)
    document.documentElement.style.setProperty('--web-ui-scale', scale)
    document.documentElement.style.setProperty('zoom', scale)

    if (persist) {
      try {
        window.localStorage.setItem(zoomStorageKey(), String(change.percent))
      } catch {
        // Private browsing or a blocked storage area should not disable zoom.
      }
    }

    for (const listener of listeners) {
      listener(change)
    }
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey || isEditableZoomTarget(event.target)) {
      return
    }

    const key = event.key
    if (key === '0') {
      event.preventDefault()
      apply(defaultZoomLevel(), true)
    } else if (key === '+' || key === '=' || event.code === 'Equal') {
      event.preventDefault()
      apply(level + ZOOM_STEP, true)
    } else if (key === '-' || key === '_' || event.code === 'Minus') {
      event.preventDefault()
      apply(level - ZOOM_STEP, true)
    } else {
      return
    }

    event.stopPropagation()
  }

  // Capture the shortcut before the renderer can treat it as a composer or
  // browser-page command. Inputs and text editors are intentionally excluded.
  window.addEventListener('keydown', onKeyDown, true)
  apply(level, false)

  return {
    get: async () => current(),
    factor: () => current().percent / 100,
    setPercent: (percent: number) => apply(percentToZoomLevel(percent), true),
    onChanged: (callback: (change: WebZoomChange) => void) => {
      listeners.add(callback)

      return () => listeners.delete(callback)
    }
  }
}

