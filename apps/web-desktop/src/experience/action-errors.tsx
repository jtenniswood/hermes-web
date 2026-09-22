import { useStore } from '@nanostores/react'
import { atom } from 'nanostores'

const $actionError = atom<string | null>(null)

export function reportActionFailure(message: string): void {
  $actionError.set(message)
}

export function BrowserActionError() {
  const message = useStore($actionError)
  if (!message) return null
  return <div className="browser-action-error" role="alert">
    <span>{message}</span>
    <button type="button" aria-label="Dismiss action error" onClick={() => $actionError.set(null)}>Dismiss</button>
  </div>
}
