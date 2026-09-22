import { reloadReadinessAfterSaving, type DraftSnapshot } from '../platform/reload-safety'
import { installUpdateNetworkBarrier } from './update-network'

export type PwaUpdateNotice = {
  readonly update: () => void
  readonly message: string
}

type PwaUpdateListener = (notice: PwaUpdateNotice | null) => void
const listeners = new Set<PwaUpdateListener>()
let currentNotice: PwaUpdateNotice | null = null

export function currentPwaUpdate(): PwaUpdateNotice | null { return currentNotice }

export function subscribePwaUpdate(listener: PwaUpdateListener): () => void {
  listeners.add(listener)
  listener(currentNotice)
  return () => listeners.delete(listener)
}

function publishPwaUpdate(notice: PwaUpdateNotice | null): void {
  currentNotice = notice
  for (const listener of listeners) listener(currentNotice)
  window.dispatchEvent(new CustomEvent('hermes-update-available', { detail: currentNotice }))
}

/** A waiting worker performs an all-tab handshake before it activates. */
export function registerPwa(): void {
  // Vite serves `/sw.js` as the application fallback during development,
  // which produces an HTML service-worker response and a misleading MIME
  // error before the browser shell starts. The production bundle injects the
  // real worker and remains fully registered.
  if (import.meta.env.DEV) return
  if (!('serviceWorker' in navigator)) return
  const { hostname, protocol } = window.location
  const local = hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.localhost')
  if (protocol !== 'https:' && !local) return
  const network = installUpdateNetworkBarrier()
  let transaction: string | undefined
  let snapshot: DraftSnapshot | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let notice: PwaUpdateNotice | null = null
  const setStatus = (message: string) => {
    if (!notice) return
    notice = { ...notice, message }
    publishPwaUpdate(notice)
  }
  const unlock = () => {
    const root = document.getElementById('root')
    if (root) root.inert = false
    clearTimeout(timer); transaction = undefined; snapshot = undefined
    network.resume()
  }
  navigator.serviceWorker.addEventListener('message', async event => {
    const message = event.data
    if (message?.type === 'HERMES_ABORT_UPDATE') {
      if (message.transaction === transaction) unlock()
      setStatus('Update postponed. Finish work in all Hermes tabs, or close older tabs, then try again.')
      return
    }
    if (!['HERMES_FLUSH_UPDATE', 'HERMES_VERIFY_UPDATE'].includes(message?.type)) return
    if (message.type === 'HERMES_FLUSH_UPDATE') {
      if (transaction && transaction !== message.transaction) { event.ports[0]?.postMessage({ ready: false }); return }
      transaction = message.transaction
      snapshot = undefined
      const root = document.getElementById('root')
      if (root) root.inert = true
      clearTimeout(timer); timer = setTimeout(unlock, 15000)
      const networkReady = network.pause()
      const state = await reloadReadinessAfterSaving()
      const drained = await networkReady
      // A worker timeout/abort must not leave a late save holding the UI locked.
      if (transaction !== message.transaction) { event.ports[0]?.postMessage({ ready: false }); return }
      if (state.ready && drained) {
        snapshot = state.drafts
      } else { unlock(); setStatus(state.reason || 'Update postponed. Wait for pending requests to finish, then try again.') }
      event.ports[0]?.postMessage({ ready: state.ready && drained, texts: snapshot?.texts })
    } else {
      let ready = transaction === message.transaction && !!snapshot
      try {
        const stored = JSON.parse(window.localStorage.getItem(snapshot!.storageKey) || '{}')
        ready = ready && Object.entries(snapshot!.texts).every(([key, text]) => stored[key] === text)
      } catch { ready = false }
      // Recheck activity and every prepared entry. Other tabs may have added
      // independently saved drafts while their flushes completed.
      const state = await reloadReadinessAfterSaving()
      const current = state.drafts
      // The upstream stash uses insertion order for recency. A storage sync
      // can reorder unchanged entries without changing any conversation draft.
      ready = ready && transaction === message.transaction && state.ready && !!current && !!snapshot &&
        current.storageKey === snapshot.storageKey &&
        Object.entries(snapshot.texts).every(([key, text]) => current.texts[key] === text)
      event.ports[0]?.postMessage({ ready })
    }
  })
  navigator.serviceWorker.addEventListener('controllerchange', async () => {
    const prepared = transaction
    if (prepared && (await reloadReadinessAfterSaving()).ready && transaction === prepared) window.location.reload()
    else unlock()
  })
  const showUpdate = (registration: ServiceWorkerRegistration) => {
    if (!registration.waiting || !navigator.serviceWorker.controller || notice) return
    const update = async () => {
      const state = await reloadReadinessAfterSaving()
      if (!state.ready) { setStatus(state.reason || 'Update postponed.'); return }
      setStatus('Checking open Hermes tabs…')
      registration.waiting?.postMessage({ type: 'HERMES_PREPARE_UPDATE' })
    }
    notice = { update, message: 'A Hermes update is ready.' }
    publishPwaUpdate(notice)
  }
  const register = async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
      showUpdate(registration)
      registration.addEventListener('updatefound', () => {
        const installing = registration.installing
        installing?.addEventListener('statechange', () => { if (installing.state === 'installed') showUpdate(registration) })
      })
    } catch { /* The shell and connection recovery remain usable without a worker. */ }
  }
  if (document.readyState === 'complete') void register()
  else window.addEventListener('load', () => void register(), { once: true })
}
