import { initializeBrowserExperience } from './experience/browser-experience'
import { consumeConnectionToken } from './platform/connection-state'
import { trackMediaRequests } from './platform/reload-safety'
import { runtimeConfig } from './platform/runtime'
import { registerPwa } from './pwa/register'
import { prepareBrowserBridge } from './upstream/browser-bootstrap'
import { startUpstreamRenderer } from './upstream/entry'
import { installSidebarCollapse } from './web-sidebar-collapse'

/** Called once per page load; entry.ts owns startup completion and recovery. */
export async function startBrowserApplication(): Promise<void> {
  registerPwa()
  runtimeConfig()
  trackMediaRequests()
  consumeConnectionToken()
  initializeBrowserExperience()

  // Bridge dependencies may read browser state while evaluating. Load them
  // only after configuration, credentials, and profile migration are ready.
  const { installWebBridge } = await import('./web-bridge/install')
  installWebBridge()
  prepareBrowserBridge()
  installSidebarCollapse()

  // Upstream stores read the bridge during module evaluation. The adapter
  // defers that evaluation until the bridge and browser handlers are ready.
  await startUpstreamRenderer()
}
