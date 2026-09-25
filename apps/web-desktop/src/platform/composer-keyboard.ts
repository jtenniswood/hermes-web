const COMPOSER_EDITOR_SELECTOR = '[data-slot="composer-rich-input"]'

/** Let Shift+Enter use the browser's native line break in the rich composer. */
export function installComposerKeyboard(): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' || !event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return
    if (!(event.target instanceof Element) || !event.target.closest(COMPOSER_EDITOR_SELECTOR)) return

    // The renderer's key handler owns plain Enter submission. Keep this chord
    // away from it while allowing the contenteditable's native line break.
    event.stopPropagation()
  }

  window.addEventListener('keydown', onKeyDown, true)
  return () => window.removeEventListener('keydown', onKeyDown, true)
}
