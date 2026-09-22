import { setTimeout as delay } from 'node:timers/promises'

// Docker's interface notifications can reach Chromium after nginx is ready.
// Probe only uncached identity in a disposable context: the application's first
// document, assets, storage and service-worker installation remain cold.
export async function waitForBrowserNetwork(browser, origin, { quietMs = 2000, timeoutMs = 15000, intervalMs = 200 } = {}) {
  const context = await browser.newContext({ serviceWorkers: 'block' })
  const started = performance.now()
  let stableSince, probes = 0, networkChanges = 0
  try {
    const page = await context.newPage()
    while (performance.now() - started < timeoutMs) {
      try {
        const response = await page.goto(new URL('/build-info.json', origin).href, { waitUntil: 'load', timeout: Math.max(1, timeoutMs - (performance.now() - started)) })
        if (response?.status() !== 200) throw new Error(`Fixture identity probe returned HTTP ${response?.status() ?? 'no response'}`)
        const identity = await response.json()
        if (!/^[a-f0-9]{40}$/.test(identity.rendererRevision || '')) throw new Error('Fixture identity probe did not return renderer build metadata')
        probes++
        stableSince ??= performance.now()
        if (performance.now() - stableSince >= quietMs) return { probes, networkChanges, elapsedMs: Math.round(performance.now() - started) }
      } catch (error) {
        // Other navigation errors, HTTP failures and invalid images are not
        // environmental readiness: fail setup instead of concealing them.
        if (!String(error).includes('net::ERR_NETWORK_CHANGED')) throw error
        networkChanges++
        stableSince = undefined
      }
      await delay(intervalMs)
    }
    throw new Error(`Fixture network did not settle within ${timeoutMs}ms (${networkChanges} network changes)`)
  } finally { await context.close() }
}
