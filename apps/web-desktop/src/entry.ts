import { buildInfo } from './build-info'
import { completeStartup, recoverStartupChunk } from './platform/startup-recovery'
import { trackMediaRequests } from './platform/reload-safety'
import { consumeConnectionToken } from './platform/connection-state'
import './web.css'
import './web-overrides.css'
import { runtimeConfig } from './platform/runtime'
import { registerPwa } from './pwa/register'

registerPwa()

async function start(): Promise<void> {
  try {
    runtimeConfig()
    trackMediaRequests()
    consumeConnectionToken()
    ;(await import('./experience/browser-experience')).initializeBrowserExperience()
    // Complete bridge installation before any upstream module evaluates.
    await import('./web-bridge/install')
    ;(await import('./upstream/browser-bootstrap')).prepareBrowserBridge()
    await import('./web-sidebar-collapse')
    await import('./upstream/entry')
    completeStartup()
  } catch (error) {
    if (recoverStartupChunk(error, buildInfo.wrapperRevision)) return
    console.error('Hermes Web startup failed', error)
    const root = document.getElementById('root')
    if (!root) return
    const message = document.createElement('p')
    message.textContent = error instanceof Error ? error.message : 'The application could not start.'
    const retry = document.createElement('button')
    retry.textContent = 'Reload Hermes'
    retry.onclick = () => window.location.reload()
    root.replaceChildren(message, retry)
  }
}
void start()
