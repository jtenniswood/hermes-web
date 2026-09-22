import { atom } from 'nanostores'
import { setSessionUnreadRemote } from '@/hermes'
import { $sessions, setSessions } from '@/store/session'

export const UNREAD_WRITE_GUARD_MS = 10_000
type WriteGuard = { at: number; value: boolean; profile?: string | null }
export const $unreadWriteGuard = atom<Map<string, WriteGuard>>(new Map())
type WriteState = { tail: Promise<void>; confirmed: boolean; latest: WriteGuard }
const writes = new Map<string, WriteState>()
const ownerKey = (id: string, profile?: string | null) => JSON.stringify([id, profile ?? null])

/** The optimistic value belongs to the current owner until its queue settles. */
export function pendingUnreadValue(id: string | null, profile?: string | null): boolean | undefined {
  return id ? writes.get(ownerKey(id, profile))?.latest.value : undefined
}

/** All callers, including automatic read-on-open, share this commit owner. */
export async function markSessionUnread(storedId: string, unread: boolean): Promise<void> {
  const row = $sessions.get().find(candidate => candidate.id === storedId)
  if (!row) return
  const profile = row.profile
  const key = ownerKey(storedId, profile)
  const operation = { at: Date.now(), value: unread, profile }
  const state = writes.get(key) ?? { tail: Promise.resolve(), confirmed: row.unread === true, latest: operation }
  state.latest = operation
  writes.set(key, state)
  const publishRow = (value: boolean) => setSessions(rows => rows.map(candidate =>
    candidate.id === storedId && candidate.profile === profile ? { ...candidate, unread: value } : candidate))
  $unreadWriteGuard.set(new Map($unreadWriteGuard.get()).set(storedId, operation))
  publishRow(unread)

  // Serialize backend writes as well as UI commits: response guards alone
  // cannot stop an older request from changing the server after a newer one.
  const request = state.tail.then(async () => {
    try {
      const result = await setSessionUnreadRemote(storedId, unread, profile)
      if (result.ok !== true) throw new Error('Gateway did not confirm unread status')
      state.confirmed = unread
      if (state.latest === operation) {
        operation.at = Date.now()
        $unreadWriteGuard.set(new Map($unreadWriteGuard.get()))
        publishRow(unread)
      }
    } catch (error) {
      // A later intent will still be sent. Its caller owns any resulting
      // failure; this older request cannot roll it back or report false failure.
      if (state.latest !== operation) return
      const guards = new Map($unreadWriteGuard.get())
      if (guards.get(storedId) === operation) guards.delete(storedId)
      $unreadWriteGuard.set(guards)
      publishRow(state.confirmed)
      throw error
    }
  })
  state.tail = request.catch(() => {})
  try { await request } finally {
    if (state.latest === operation && writes.get(key) === state) writes.delete(key)
  }
}

export async function clearUnreadOnOpen(storedId: string): Promise<void> {
  const row = $sessions.get().find(candidate => candidate.id === storedId)
  if (!row || (pendingUnreadValue(storedId, row.profile) ?? row.unread) !== true) return
  try { await markSessionUnread(storedId, false) } catch { /* A later refresh reconciles automatic read failures. */ }
}

/** Optimistic rows are not confirmation; retain their guards during writes. */
export function watchUnreadWriteGuard(): void {
  $sessions.listen(rows => {
    const guards = new Map($unreadWriteGuard.get())
    let changed = false
    for (const [id, entry] of guards) {
      if (writes.has(ownerKey(id, entry.profile))) continue
      const row = rows.find(candidate => candidate.id === id && candidate.profile === entry.profile)
      if (row && row.unread === entry.value) {
        guards.delete(id)
        changed = true
      }
    }
    if (changed) $unreadWriteGuard.set(guards)
  })
}
