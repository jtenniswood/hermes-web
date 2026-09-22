// Observe worker promises in upgrade tests without changing their return values.
// Only protocol names, request categories, and states leave the worker: never
// request URLs, message payloads, drafts, or exception messages.
export function installWorkerDiagnostics(context) {
  const workers = []
  context.on('serviceworker', worker => {
    if (workers.length >= 8) return
    const setup = worker.evaluate(() => {
      const state = { events: [], pending: {}, pendingCount: 0, next: 0, dropped: 0 }
      self.__hermesUpdateDiagnostics = state
      const record = event => {
        if (state.events.length < 128) state.events.push({ at: Date.now(), ...event })
        else state.dropped++
      }
      const track = (kind, promise) => {
        if (state.pendingCount >= 2048) { state.dropped++; return }
        const id = ++state.next
        state.pendingCount++
        state.pending[id] = { kind, at: Date.now() }
        Promise.resolve(promise).then(() => {
          delete state.pending[id]
          state.pendingCount--
          if (kind === 'skipWaiting') record({ kind, outcome: 'resolved' })
        }, () => {
          delete state.pending[id]
          state.pendingCount--
          record({ kind, outcome: 'rejected' })
        })
      }
      const skip = self.skipWaiting
      self.skipWaiting = function (...args) {
        const promise = skip.apply(this, args)
        record({ kind: 'skipWaiting', outcome: 'called' })
        track('skipWaiting', promise)
        return promise
      }
      const wait = ExtendableEvent.prototype.waitUntil
      ExtendableEvent.prototype.waitUntil = function (promise, ...args) {
        const result = wait.call(this, promise, ...args)
        track(`waitUntil:${this.type}`, promise)
        return result
      }
      const respond = FetchEvent.prototype.respondWith
      FetchEvent.prototype.respondWith = function (promise, ...args) {
        const result = respond.call(this, promise, ...args)
        const path = new URL(this.request.url).pathname
        const category = this.request.mode === 'navigate' ? 'navigation'
          : path.startsWith('/assets/') ? 'asset' : path.startsWith('/api/') ? 'gateway' : 'other'
        track(`respondWith:${category}`, promise)
        return result
      }
      self.addEventListener('message', event => {
        if (event.data?.type === 'HERMES_PREPARE_UPDATE') record({ kind: 'prepare' })
      })
    }).then(() => true, () => false)
    workers.push({ worker, setup })
  })
  return async () => Promise.all(workers.map(async ({ worker, setup }, index) => {
    if (!await setup) return { worker: index + 1, unavailable: 'setup' }
    try {
      return { worker: index + 1, ...await worker.evaluate(() => ({
        ...self.__hermesUpdateDiagnostics,
        active: self.registration.active?.state ?? null,
        waiting: self.registration.waiting?.state ?? null
      })) }
    } catch { return { worker: index + 1, unavailable: 'closed' } }
  }))
}
