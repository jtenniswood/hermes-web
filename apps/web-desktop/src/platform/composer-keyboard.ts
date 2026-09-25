const COMPOSER_EDITOR_SELECTOR = '[data-slot="composer-rich-input"]'

/** Insert a line break for Shift+Enter in the rich composer. */
export function installComposerKeyboard(): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' || !event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return
    const editor = event.target instanceof Element
      ? event.target.closest<HTMLElement>(COMPOSER_EDITOR_SELECTOR)
      : null
    if (!editor) return

    // Keep Shift+Enter away from the renderer's send handler, then insert the
    // line break explicitly because native key handling can be suppressed.
    event.preventDefault()
    event.stopPropagation()
    editor.focus()
    document.execCommand('insertLineBreak')
  }

  window.addEventListener('keydown', onKeyDown, true)
  return () => window.removeEventListener('keydown', onKeyDown, true)
}
