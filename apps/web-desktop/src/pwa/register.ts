import { reloadReadiness, type DraftSnapshot } from '../platform/reload-safety'

/** A waiting worker performs an all-tab handshake before it activates. */
export function registerPwa(): void {
  if (!('serviceWorker' in navigator)) return
  const { hostname, protocol } = window.location
  const local = hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.localhost')
  if (protocol !== 'https:' && !local) return
  let transaction: string | undefined
  let snapshot: DraftSnapshot | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let banner: HTMLDivElement | undefined
  let status: HTMLSpanElement | undefined
  const unlock = () => {
    const root = document.getElementById('root')
    if (root) root.inert = false
    clearTimeout(timer); transaction = undefined; snapshot = undefined
  }
  navigator.serviceWorker.addEventListener('message', event => {
    const message = event.data
    if (message?.type === 'HERMES_ABORT_UPDATE') {
      if (message.transaction === transaction) unlock()
      if (status) status.textContent = 'Update postponed. Finish work in all Hermes tabs, or close older tabs, then try again.'
      return
    }
    if (!['HERMES_FLUSH_UPDATE', 'HERMES_VERIFY_UPDATE'].includes(message?.type)) return
    if (message.type === 'HERMES_FLUSH_UPDATE') {
      if (transaction && transaction !== message.transaction) { event.ports[0]?.postMessage({ ready: false }); return }
      const state = reloadReadiness()
      if (state.ready) {
        transaction = message.transaction; snapshot = state.drafts
        const root = document.getElementById('root')
        if (root) root.inert = true
        clearTimeout(timer); timer = setTimeout(unlock, 15000)
      } else if (status) status.textContent = state.reason || 'Update postponed.'
      event.ports[0]?.postMessage({ ready: state.ready, texts: snapshot?.texts })
    } else {
      let ready = transaction === message.transaction && !!snapshot
      try {
        const stored = JSON.parse(window.localStorage.getItem(snapshot!.storageKey) || '{}')
        ready = ready && Object.entries(snapshot!.texts).every(([key, text]) => stored[key] === text)
      } catch { ready = false }
      // Recheck activity, without accepting a different draft snapshot.
      const state = reloadReadiness()
      ready = ready && state.ready && JSON.stringify(state.drafts?.texts) === JSON.stringify(snapshot?.texts)
      event.ports[0]?.postMessage({ ready })
    }
  })
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (transaction && reloadReadiness().ready) window.location.reload()
    else unlock()
  })
  const showUpdate = (registration: ServiceWorkerRegistration) => {
    if (!registration.waiting || !navigator.serviceWorker.controller || banner) return
    banner = document.createElement('div')
    banner.className = 'hermes-update-banner'; banner.setAttribute('role', 'status')
    status = document.createElement('span'); status.textContent = 'A Hermes update is ready.'
    const action = document.createElement('button'); action.textContent = 'Update when safe'
    action.onclick = () => {
      const state = reloadReadiness()
      if (!state.ready) { status!.textContent = state.reason || 'Update postponed.'; return }
      status!.textContent = 'Checking open Hermes tabs…'
      registration.waiting?.postMessage({ type: 'HERMES_PREPARE_UPDATE' })
    }
    banner.append(status, action); document.body.append(banner)
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
