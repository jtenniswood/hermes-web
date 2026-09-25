const VIEWPORT = '[data-slot="aui_thread-viewport"]'
const USER_MESSAGE = '[data-slot="aui_user-message-root"]'
const COMPOSER = '[data-slot="composer-root"]'
const EDIT_COMPOSER = '[data-slot="aui_edit-composer-root"]'
const TOP_GAP_PX = 12
const OBSERVE_TIMEOUT_MS = 10_000

function visibleChatViewport(): HTMLElement | null {
  const shell = document.querySelector('[data-browser-shell]')
  if (!shell) return null

  return [...shell.querySelectorAll<HTMLElement>(VIEWPORT)].find(viewport =>
    viewport.getClientRects().length > 0 && !viewport.closest('[hidden]')
  ) ?? null
}

function latestUserMessage(viewport: HTMLElement): HTMLElement | null {
  const messages = viewport.querySelectorAll<HTMLElement>(USER_MESSAGE)
  return messages.item(messages.length - 1) ?? null
}

function movePromptToTop(viewport: HTMLElement, prompt: HTMLElement): void {
  const viewportTop = viewport.getBoundingClientRect().top
  const promptTop = prompt.getBoundingClientRect().top
  const desiredTop = viewport.scrollTop + promptTop - viewportTop - TOP_GAP_PX
  const maximumTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight)

  viewport.scrollTop = Math.max(0, Math.min(desiredTop, maximumTop))
}

/** Keep a submitted prompt and the start of its response together in view. */
export function installConversationSubmitScroll(): () => void {
  let observer: MutationObserver | null = null
  let timeout = 0
  let firstFrame = 0
  let secondFrame = 0

  const clearPending = () => {
    observer?.disconnect()
    observer = null
    window.clearTimeout(timeout)
    window.cancelAnimationFrame(firstFrame)
    window.cancelAnimationFrame(secondFrame)
  }

  const onSubmit = (event: Event) => {
    const target = event.target
    if (!(target instanceof Element) || !target.closest(COMPOSER) || target.closest(EDIT_COMPOSER)) return

    const viewport = visibleChatViewport()
    if (!viewport) return

    clearPending()
    const previousPrompt = latestUserMessage(viewport)

    observer = new MutationObserver(() => {
      const nextPrompt = latestUserMessage(viewport)
      if (!nextPrompt || nextPrompt === previousPrompt) return

      clearPending()
      firstFrame = window.requestAnimationFrame(() => {
        secondFrame = window.requestAnimationFrame(() => {
          if (viewport.isConnected && nextPrompt.isConnected) movePromptToTop(viewport, nextPrompt)
        })
      })
    })
    observer.observe(viewport, { childList: true, subtree: true })
    timeout = window.setTimeout(clearPending, OBSERVE_TIMEOUT_MS)
  }

  document.addEventListener('submit', onSubmit, true)
  return () => {
    document.removeEventListener('submit', onSubmit, true)
    clearPending()
  }
}
