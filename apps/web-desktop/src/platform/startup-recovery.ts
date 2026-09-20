const RETRY_KEY = 'hermes-web.startup-chunk-retry'
/** A navigation can abort a module fetch while the browser cache/worker changes.
 * Retry a failed initial import once, before any composer has mounted. A second
 * failure keeps the explicit recovery screen; unavailable storage never loops. */
export function recoverStartupChunk(error: unknown, revision: string): boolean {
  if (!(error instanceof Error) || !/Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(error.message)) return false
  try {
    if (sessionStorage.getItem(RETRY_KEY) === revision) return false
    sessionStorage.setItem(RETRY_KEY, revision)
    if (sessionStorage.getItem(RETRY_KEY) !== revision) return false
  } catch { return false }
  window.location.reload()
  return true
}
export function completeStartup(): void {
  try { sessionStorage.removeItem(RETRY_KEY) } catch { /* Optional recovery marker. */ }
}
