/**
 * Browser-only input and viewport integration for the web wrapper.
 *
 * The upstream renderer owns chat state and layout. This adapter only publishes
 * capability and viewport facts as document attributes/CSS variables so the
 * wrapper can adapt the renderer without forking its sources.
 */

const MOBILE_QUERY = '(max-width: 48rem)'
const TOUCH_QUERY = '(pointer: coarse), (hover: none)'
const KEYBOARD_THRESHOLD_PX = 120
const APPROVAL_MODE_LABELS = new Set(['Manual', 'Smart', 'Off'])

type MobileSheetContent = HTMLElement & { dataset: DOMStringMap }

function matches(query: string): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(query).matches
}

function isTouchLayout(): boolean {
  return matches(TOUCH_QUERY)
}

function isMobileLayout(): boolean {
  return matches(MOBILE_QUERY) || (isTouchLayout() && window.innerWidth <= 1024)
}

function viewportHeight(): number {
  return window.visualViewport?.height ?? window.innerHeight
}

function syncViewport(): void {
  const root = document.documentElement
  const height = viewportHeight()
  const layoutHeight = window.innerHeight
  const keyboardOpen = isTouchLayout() && layoutHeight - height > KEYBOARD_THRESHOLD_PX

  root.dataset.webInput = isTouchLayout() ? 'touch' : 'pointer'
  root.toggleAttribute('data-web-mobile', isMobileLayout())
  root.toggleAttribute('data-web-keyboard-open', keyboardOpen)
  root.style.setProperty('--web-visual-viewport-height', `${Math.max(0, height)}px`)
  root.style.setProperty(
    '--web-keyboard-inset',
    `${Math.max(0, layoutHeight - height - (window.visualViewport?.offsetTop ?? 0))}px`
  )
}

function isComposerEditor(element: Element | null): element is HTMLElement {
  return element?.matches('[data-slot="composer-rich-input"]') ?? false
}

function installMobileFocusGuards(): () => void {
  let userFocusUntil = 0

  const markUserIntent = (event: Event) => {
    if (event.target instanceof Element && isComposerEditor(event.target.closest('[data-slot="composer-rich-input"]'))) {
      userFocusUntil = Date.now() + 1200
    }
  }

  const preventUnexpectedComposerFocus = (event: FocusEvent) => {
    if (!isMobileLayout() || !isComposerEditor(event.target as Element | null) || Date.now() < userFocusUntil) {
      return
    }

    // Session navigation currently restores composer focus for desktop. On a
    // phone that would open the software keyboard without an explicit action.
    window.setTimeout(() => {
      if (isComposerEditor(document.activeElement) && Date.now() >= userFocusUntil) {
        ;(document.activeElement as HTMLElement).blur()
      }
    }, 0)
  }

  document.addEventListener('pointerdown', markUserIntent, true)
  document.addEventListener('touchstart', markUserIntent, true)
  document.addEventListener('keydown', markUserIntent, true)
  document.addEventListener('focusin', preventUnexpectedComposerFocus, true)

  return () => {
    document.removeEventListener('pointerdown', markUserIntent, true)
    document.removeEventListener('touchstart', markUserIntent, true)
    document.removeEventListener('keydown', markUserIntent, true)
    document.removeEventListener('focusin', preventUnexpectedComposerFocus, true)
  }
}

function insertMobileLineBreak(editor: HTMLElement): void {
  editor.focus({ preventScroll: true })

  if (typeof document.execCommand === 'function' && document.execCommand('insertLineBreak')) {
    return
  }

  const selection = window.getSelection()
  if (!selection?.rangeCount) {
    return
  }

  const range = selection.getRangeAt(0)
  range.deleteContents()
  const lineBreak = document.createElement('br')
  range.insertNode(lineBreak)
  range.setStartAfter(lineBreak)
  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)
  editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertLineBreak', data: null }))
}

function installMobileComposerKeyboard(): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (
      !isMobileLayout() ||
      event.key !== 'Enter' ||
      event.isComposing ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey
    ) {
      return
    }

    const editor = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-slot="composer-rich-input"]') : null
    if (!editor) {
      return
    }

    event.preventDefault()
    event.stopImmediatePropagation()
    insertMobileLineBreak(editor)
  }

  document.addEventListener('keydown', onKeyDown, true)

  return () => document.removeEventListener('keydown', onKeyDown, true)
}

function isProfileReorderTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('[data-slot="profile-rail"] [data-profile]'))
}

function installMobileProfileGuard(): () => void {
  const blockProfileDrag = (event: Event) => {
    if (!isTouchLayout() || !isProfileReorderTarget(event.target)) {
      return
    }

    // Let the button's click handler select the profile, but do not let the
    // upstream dnd-kit sensor receive the pointer stream as a reorder gesture.
    event.stopPropagation()
  }

  const blockNativeProfileDrag = (event: DragEvent) => {
    if (isTouchLayout() && isProfileReorderTarget(event.target)) {
      event.preventDefault()
    }
  }

  document.addEventListener('pointerdown', blockProfileDrag, true)
  document.addEventListener('dragstart', blockNativeProfileDrag, true)

  return () => {
    document.removeEventListener('pointerdown', blockProfileDrag, true)
    document.removeEventListener('dragstart', blockNativeProfileDrag, true)
  }
}

function installMobileApprovalModeMarker(): () => void {
  const statusbarSelector = '[data-slot="statusbar"]'

  const syncApprovalModeMarker = () => {
    document.querySelectorAll<HTMLButtonElement>(`${statusbarSelector} button`).forEach(button => {
      const isApprovalMode = APPROVAL_MODE_LABELS.has(button.textContent?.trim() ?? '')
      button.toggleAttribute('data-web-approval-mode', isApprovalMode)
    })
  }

  const observer = new MutationObserver(syncApprovalModeMarker)
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  syncApprovalModeMarker()

  return () => observer.disconnect()
}

function openSheetContent(): MobileSheetContent | null {
  const selectors = [
    '[data-slot="dropdown-menu-content"][data-state="open"]',
    '[data-slot="context-menu-content"][data-state="open"]',
    '[data-slot="select-content"][data-state="open"]',
    '[data-slot="popover-content"][data-state="open"]'
  ]

  return document.querySelector<MobileSheetContent>(selectors.join(', '))
}

function installMobileSheetHistory(): () => void {
  let sheetHistory = false
  let observer: MutationObserver | null = null

  const clearSheetHistory = () => {
    if (!sheetHistory) {
      return
    }

    const state = { ...(window.history.state ?? {}) }
    delete state.__hermesMobileSheet
    window.history.replaceState(state, '', window.location.href)
    sheetHistory = false
  }

  const syncSheet = () => {
    const open = isMobileLayout() && openSheetContent() !== null
    document.documentElement.toggleAttribute('data-web-sheet-open', open)

    if (open && !sheetHistory) {
      window.history.pushState({ ...(window.history.state ?? {}), __hermesMobileSheet: true }, '', window.location.href)
      sheetHistory = true
    } else if (!open) {
      clearSheetHistory()
    }
  }

  const onPopState = () => {
    if (!sheetHistory) {
      return
    }

    sheetHistory = false
    const state = { ...(window.history.state ?? {}) }
    delete state.__hermesMobileSheet
    window.history.replaceState(state, '', window.location.href)
    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }))
    window.setTimeout(syncSheet, 0)
  }

  observer = new MutationObserver(syncSheet)
  observer.observe(document.body, { attributes: true, childList: true, subtree: true })
  window.addEventListener('popstate', onPopState)
  syncSheet()

  return () => {
    observer?.disconnect()
    window.removeEventListener('popstate', onPopState)
    document.documentElement.removeAttribute('data-web-sheet-open')
    clearSheetHistory()
  }
}

export function installMobileExperience(): () => void {
  syncViewport()

  const viewport = window.visualViewport
  const mediaQueries = [window.matchMedia(MOBILE_QUERY), window.matchMedia(TOUCH_QUERY)]
  const onViewportChange = () => syncViewport()
  const onMediaChange = () => syncViewport()

  window.addEventListener('resize', onViewportChange)
  window.addEventListener('orientationchange', onViewportChange)
  window.addEventListener('pageshow', onViewportChange)
  document.addEventListener('visibilitychange', onViewportChange)
  viewport?.addEventListener('resize', onViewportChange)
  viewport?.addEventListener('scroll', onViewportChange)
  mediaQueries.forEach(query => query.addEventListener('change', onMediaChange))

  const cleanups = [
    installMobileFocusGuards(),
    installMobileComposerKeyboard(),
    installMobileProfileGuard(),
    installMobileApprovalModeMarker(),
    installMobileSheetHistory()
  ]

  return () => {
    window.removeEventListener('resize', onViewportChange)
    window.removeEventListener('orientationchange', onViewportChange)
    window.removeEventListener('pageshow', onViewportChange)
    document.removeEventListener('visibilitychange', onViewportChange)
    viewport?.removeEventListener('resize', onViewportChange)
    viewport?.removeEventListener('scroll', onViewportChange)
    mediaQueries.forEach(query => query.removeEventListener('change', onMediaChange))
    cleanups.forEach(cleanup => cleanup())
  }
}
