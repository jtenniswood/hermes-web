// Keep protocol evidence outside the page so activation/reload cannot erase it.
// Record states and acknowledgments, never composer text, credentials, or URLs.
export async function installUpdateDiagnostics(context) {
  const events = [], pages = new WeakMap()
  let nextPage = 0, dropped = 0
  await context.exposeBinding('__recordUpdateDiagnostic', ({ page }, event) => {
    if (!pages.has(page)) pages.set(page, ++nextPage)
    if (events.length >= 1000) { dropped++; return }
    events.push({ page: pages.get(page), ...event })
  })
  await context.addInitScript(() => {
    if (!navigator.serviceWorker) return
    const record = (type, details) => {
      void window.__recordUpdateDiagnostic({ at: Date.now(), type, ...details }).catch(() => {})
    }
    const protocol = new Set(['HERMES_FLUSH_UPDATE', 'HERMES_VERIFY_UPDATE', 'HERMES_ABORT_UPDATE'])
    navigator.serviceWorker.addEventListener('message', event => {
      if (protocol.has(event.data?.type)) record('receive', { message: event.data.type, transaction: event.data.transaction })
    })
    navigator.serviceWorker.addEventListener('controllerchange', () => record('controllerchange', {}))
    window.addEventListener('hermes-update-available', event => record('notice', { message: event.detail?.message }))

    // Observe the real protocol calls, forwarding the original arguments and
    // transfer lists unchanged. In particular, do not consume reply ports.
    const send = ServiceWorker.prototype.postMessage
    ServiceWorker.prototype.postMessage = function (message, ...args) {
      if (message?.type === 'HERMES_PREPARE_UPDATE') record('send', { message: message.type, workerState: this.state })
      return send.call(this, message, ...args)
    }
    const reply = MessagePort.prototype.postMessage
    MessagePort.prototype.postMessage = function (message, ...args) {
      if (typeof message?.ready === 'boolean') record('reply', { ready: message.ready })
      return reply.call(this, message, ...args)
    }
    let previous
    const inspect = async () => {
      try {
        const registration = await navigator.serviceWorker.getRegistration()
        const state = {
          waiting: registration?.waiting?.state ?? null,
          installing: registration?.installing?.state ?? null,
          active: registration?.active?.state ?? null,
          controller: navigator.serviceWorker.controller?.state ?? null,
          inert: document.getElementById('root')?.inert ?? false
        }
        const key = JSON.stringify(state)
        if (key !== previous) { previous = key; record('registration', state) }
      } catch { /* A closing document may no longer have a registration. */ }
    }
    void inspect()
    setInterval(inspect, 250)
  })
  return () => ({ events, dropped })
}
