// Browser-process lifecycle observations survive service-worker global restarts.
export async function observeWorkerVersions(page) {
  const session = await page.context().newCDPSession(page)
  const events = [], latest = new Map()
  let dropped = 0
  session.on('ServiceWorker.workerVersionUpdated', ({ versions }) => {
    for (const version of versions) {
      const state = {
        version: version.versionId,
        registration: version.registrationId,
        status: version.status,
        running: version.runningStatus,
        clients: version.controlledClients?.length ?? 0
      }
      const key = JSON.stringify(state)
      if (latest.get(state.version) === key) continue
      latest.set(state.version, key)
      if (events.length < 512) events.push({ at: Date.now(), ...state })
      else dropped++
    }
  })
  await session.send('ServiceWorker.enable')
  return async () => {
    await session.detach()
    return { events, dropped }
  }
}
