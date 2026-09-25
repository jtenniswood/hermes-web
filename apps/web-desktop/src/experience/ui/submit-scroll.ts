const VIEWPORT = '[data-slot="aui_thread-viewport"]'
const USER_MESSAGE = '[data-slot="aui_user-message-root"]'
const CONTENT = '[data-slot="aui_thread-content"]'
const TURN = '[data-slot="aui_turn-pair"]'
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

function viewportScale(viewport: HTMLElement): number {
  return viewport.getBoundingClientRect().height / viewport.offsetHeight || 1
}

function reserveResponseSpace(viewport: HTMLElement, prompt: HTMLElement) {
  const initialTurn = prompt.closest<HTMLElement>(TURN)
  const content = viewport.querySelector<HTMLElement>(CONTENT)
  const shell = viewport.closest('[data-browser-shell]')
  if (!initialTurn || !content || !shell) return null

  let turn = initialTurn
  let previousMinHeight = turn.style.minHeight
  let conversationId = shell.getAttribute('data-browser-conversation-id')
  const conversationKind = shell.getAttribute('data-browser-conversation-kind')
  const promptText = (element: HTMLElement) => (element.querySelector('[data-slot="aui_user-message-text"]') ?? element).textContent
  const submittedText = promptText(prompt)
  const resize = () => {
    if (!turn.isConnected || viewport.clientHeight === 0) return
    const scale = viewportScale(viewport)
    const tail = content.lastElementChild
    if (!tail) return

    // Measure actual trailing elements (including composer clearance). The
    // content's min-height can include unused space in a short conversation.
    const trailingHeight = Math.max(0, (tail.getBoundingClientRect().bottom - turn.getBoundingClientRect().bottom) / scale)
      + (Number.parseFloat(getComputedStyle(content).paddingBottom) || 0)
    const minimum = `${Math.max(0, Math.ceil(viewport.clientHeight - TOP_GAP_PX - trailingHeight))}px`
    if (turn.style.minHeight !== minimum) turn.style.minHeight = minimum
  }
  const sizes = new ResizeObserver(resize)
  const changes = new MutationObserver(() => {
    const nextConversationId = shell.getAttribute('data-browser-conversation-id')
    if (!viewport.isConnected || (conversationId && nextConversationId !== conversationId)
      || shell.getAttribute('data-browser-conversation-kind') !== conversationKind) {
      dispose()
      return
    }
    // A fresh draft receives its session identity after the first send.
    conversationId ??= nextConversationId
    const latest = latestUserMessage(viewport)
    if (!latest || latest === prompt) return

    // The runtime can replace optimistic message IDs and DOM on completion.
    // Carry the reservation over that reconciliation within the same chat.
    const sameMessage = latest.dataset.messageId && latest.dataset.messageId === prompt.dataset.messageId
    if (!sameMessage && (prompt.isConnected || promptText(latest) !== submittedText)) {
      dispose()
      return
    }
    const nextTurn = latest.closest<HTMLElement>(TURN)
    if (!nextTurn) return
    const following = viewport.getAttribute('data-following') === 'true'
    turn.style.minHeight = previousMinHeight
    prompt = latest
    turn = nextTurn
    previousMinHeight = turn.style.minHeight
    resize()
    // Removing the old turn can clamp scrollTop before the replacement is
    // measured, even if the final content height is unchanged (no RO event).
    if (following) viewport.scrollTop = viewport.scrollHeight - viewport.clientHeight
  })
  const dispose = () => {
    sizes.disconnect()
    changes.disconnect()
    turn.style.minHeight = previousMinHeight
  }

  // Minimum height leaves the reply at the top and lets it consume the empty
  // space naturally. Keep it after short replies to avoid a completion jump.
  resize()
  sizes.observe(viewport)
  sizes.observe(content)
  changes.observe(shell, {
    childList: true, subtree: true, attributes: true,
    attributeFilter: ['data-browser-conversation-id', 'data-browser-conversation-kind']
  })

  return {
    dispose,
    align() {
      if (!prompt.isConnected) return
      resize()
      // The prompt is sticky; its containing turn gives its natural position.
      const delta = (turn.getBoundingClientRect().top - viewport.getBoundingClientRect().top) / viewportScale(viewport)
      viewport.scrollTop = Math.max(0, viewport.scrollTop + delta - TOP_GAP_PX)
    }
  }
}

/** Keep a submitted prompt and the start of its response together in view. */
export function installConversationSubmitScroll(): () => void {
  let observer: MutationObserver | null = null
  let timeout = 0
  let firstFrame = 0
  let secondFrame = 0
  let space: ReturnType<typeof reserveResponseSpace> = null

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
    const previousId = previousPrompt?.dataset.messageId

    observer = new MutationObserver(() => {
      // A conversation switch must not be mistaken for the submitted turn.
      if (previousPrompt && !previousPrompt.isConnected) {
        clearPending()
        return
      }
      const nextPrompt = latestUserMessage(viewport)
      if (!nextPrompt || nextPrompt === previousPrompt) return
      if (previousId && nextPrompt.dataset.messageId === previousId) return

      clearPending()
      space?.dispose()
      space = reserveResponseSpace(viewport, nextPrompt)
      firstFrame = window.requestAnimationFrame(() => {
        secondFrame = window.requestAnimationFrame(() => {
          if (viewport.isConnected && nextPrompt.isConnected) space?.align()
        })
      })
    })
    observer.observe(viewport, { childList: true, subtree: true })
    timeout = window.setTimeout(clearPending, OBSERVE_TIMEOUT_MS)
  }

  // The rich editor sends directly on Enter, without a native form submit.
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return
    if (!(event.target instanceof Element) || !event.target.closest('[data-slot="composer-rich-input"]')) return
    onSubmit(event)
  }

  document.addEventListener('submit', onSubmit, true)
  document.addEventListener('keydown', onKeyDown, true)
  return () => {
    document.removeEventListener('submit', onSubmit, true)
    document.removeEventListener('keydown', onKeyDown, true)
    clearPending()
    space?.dispose()
  }
}
