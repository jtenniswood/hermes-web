import { buildInfo } from './build-info'
import { completeStartup, recoverStartupChunk, showStartupRecovery } from './platform/startup-recovery'
import { startBrowserApplication } from './startup'
import './web.css'
import './experience/styles/tokens.css'
import './experience/styles/controls.css'
import './experience/styles/menus.css'
import './web-overrides.css'
import { installTimelineRailScrubbing } from './experience/ui/timeline-rail-scrubbing'
import { trackVisualViewport } from './platform/viewport'
import { installComposerKeyboard } from './platform/composer-keyboard'

const stopTrackingViewport = trackVisualViewport()
if (import.meta.hot) import.meta.hot.dispose(stopTrackingViewport)
const stopTimelineRailScrubbing = installTimelineRailScrubbing()
if (import.meta.hot) import.meta.hot.dispose(stopTimelineRailScrubbing)
const stopComposerKeyboard = installComposerKeyboard()
if (import.meta.hot) import.meta.hot.dispose(stopComposerKeyboard)

async function start(): Promise<void> {
  try {
    await startBrowserApplication()
    completeStartup()
  } catch (error) {
    if (recoverStartupChunk(error, buildInfo.wrapperRevision)) return
    console.error('Hermes Web startup failed', error)
    showStartupRecovery(error, buildInfo.wrapperRevision)
  }
}
void start()
