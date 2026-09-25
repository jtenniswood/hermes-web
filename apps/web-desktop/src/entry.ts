import { buildInfo } from './build-info'
import { completeStartup, recoverStartupChunk, showStartupRecovery } from './platform/startup-recovery'
import { trackMediaRequests } from './platform/reload-safety'
import { consumeConnectionToken } from './platform/connection-state'
import './web.css'
import './experience/styles/tokens.css'
import './experience/styles/controls.css'
import './experience/styles/menus.css'
import './web-overrides.css'
import { runtimeConfig } from './platform/runtime'
import { registerPwa } from './pwa/register'
import { trackVisualViewport } from './platform/viewport'

const stopTrackingViewport = trackVisualViewport()
if (import.meta.hot) import.meta.hot.dispose(stopTrackingViewport)
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
    showStartupRecovery(error, buildInfo.wrapperRevision)
  }
}
void start()
