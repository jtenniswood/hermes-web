export interface DraftSnapshot {
  blocked: boolean
  storageKey: string
  texts: Record<string, string>
  attachments: number
}
declare global {
  interface Window {
    __HERMES_WEB_DRAFT_SNAPSHOT__?: () => DraftSnapshot
    __HERMES_WEB_DRAFT_BLOCKED__?: boolean
  }
}

let activeWork: number | undefined
let operations = 0
let pendingMedia = 0
const tracks = new Set<MediaStreamTrack>()
export function setActiveWork(work: { count: number }): void { activeWork = work.count }
export function beginOperation(): () => void {
  operations++
  let complete = false
  return () => { if (!complete) { complete = true; operations-- } }
}

/** Track the actual browser media lifetime, including permission prompts. */
export function trackMediaRequests(): void {
  const devices = navigator.mediaDevices
  if (!devices?.getUserMedia) return
  const original = devices.getUserMedia.bind(devices)
  devices.getUserMedia = async constraints => {
    pendingMedia++
    try {
      const stream = await original(constraints)
      for (const track of stream.getTracks()) tracks.add(track)
      return stream
    } finally { pendingMedia-- }
  }
}

export function reloadReadiness(requirePersisted = true): { ready: boolean; reason?: string; drafts?: DraftSnapshot } {
  if (activeWork === undefined || !window.__HERMES_WEB_DRAFT_SNAPSHOT__) return { ready: false, reason: 'Wait for the app to finish connecting.' }
  if (activeWork > 0) return { ready: false, reason: 'Wait for the active response to finish, or cancel it.' }
  if (operations > 0) return { ready: false, reason: 'Finish selecting or uploading files first.' }
  for (const track of tracks) if (track.readyState === 'ended') tracks.delete(track)
  if (pendingMedia || tracks.size) return { ready: false, reason: 'Finish recording first.' }
  try {
    const drafts = window.__HERMES_WEB_DRAFT_SNAPSHOT__()
    if (drafts.blocked) return { ready: false, reason: 'Finish editing the queued message or leave message history first.' }
    if (drafts.attachments) return { ready: false, reason: 'Send or remove unsent attachments before reloading.' }
    if (!requirePersisted) return { ready: true, drafts }
    const stored = JSON.parse(window.localStorage.getItem(drafts.storageKey) || '{}')
    if (!stored || Object.entries(drafts.texts).some(([key, value]) => stored[key] !== value)) {
      return { ready: false, reason: 'Your text draft could not be saved. Copy it before reloading.' }
    }
    return { ready: true, drafts }
  } catch { return { ready: false, reason: 'Browser storage is unavailable. Copy your draft before reloading.' } }
}

export function assertSafeReload(): void {
  const state = reloadReadiness()
  if (!state.ready) throw new Error(state.reason)
}

export function assertSafeConnectionChange(): void {
  const state = reloadReadiness(false)
  if (!state.ready) throw new Error(state.reason)
}
