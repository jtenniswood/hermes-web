const RETRY_KEY = 'hermes-web.startup-chunk-retry'

type RecoveryStage = 'application' | 'configuration' | 'renderer'

function stageFor(error: unknown): RecoveryStage {
  const message = error instanceof Error ? error.message : String(error || '')
  if (/runtime|gateway|configuration|environment/i.test(message)) return 'configuration'
  if (/module|chunk|import|entry/i.test(message)) return 'renderer'
  return 'application'
}

function safeRevision(revision: string): string {
  return String(revision || 'unknown').replace(/[^a-z0-9._-]/gi, '').slice(0, 80) || 'unknown'
}

/** Render recovery without importing React, the renderer, or the gateway. */
export function showStartupRecovery(error: unknown, revision: string): void {
  const root = document.getElementById('root')
  if (!root) return

  const stage = stageFor(error)
  const copy = stage === 'configuration'
    ? ['Hermes could not read its runtime configuration.', 'Check the configured gateway URL and try again.']
    : stage === 'renderer'
      ? ['Hermes could not load the browser interface.', 'Reload once to retry the current build.']
      : ['Hermes could not finish starting.', 'Retry the current page. Your saved browser data was not cleared.']
  const wrapperRevision = safeRevision(revision)
  const section = document.createElement('main')
  section.className = 'hermes-startup-recovery'
  section.setAttribute('role', 'alert')
  section.innerHTML = `<h1>${copy[0]}</h1><p>${copy[1]}</p><p class="hermes-startup-recovery-meta">Build ${wrapperRevision}</p>`
  const actions = document.createElement('div')
  actions.className = 'hermes-startup-recovery-actions'
  const retry = document.createElement('button')
  retry.type = 'button'
  retry.textContent = 'Retry'
  retry.onclick = () => window.location.reload()
  actions.append(retry)
  const copyButton = document.createElement('button')
  copyButton.type = 'button'
  copyButton.textContent = 'Copy diagnostics'
  copyButton.onclick = () => {
    const diagnostics = `Hermes Web startup failure\nStage: ${stage}\nBuild: ${wrapperRevision}`
    void navigator.clipboard?.writeText(diagnostics)
  }
  actions.append(copyButton)
  section.append(actions)
  root.replaceChildren(section)
}

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
