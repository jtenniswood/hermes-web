import { setSessionPinnedRemote } from '@/hermes'
import { reportActionFailure } from '../experience/action-errors'

type Intent = { pinned: boolean; settle: (confirmed: boolean, failed: boolean) => void }
type WriteState = { id: string; tail: Promise<void>; confirmed: boolean; latest: Intent }
const writes = new Map<string, WriteState>()

export function hasBrowserPinWrite(id: string): boolean {
  return [...writes.values()].some(state => state.id === id)
}

/** A rescope invalidates callbacks and prevents queued writes reaching a new gateway. */
export function resetBrowserPinWrites(): void { writes.clear() }

/** All engine pin callers share backend ordering and one latest commit owner. */
export function queueBrowserPinWrite(
  id: string, pinned: boolean, profile: string | null | undefined, confirmed: boolean,
  settle: Intent['settle']
): void {
  const key = JSON.stringify([id, profile ?? null])
  const intent = { pinned, settle }
  const state = writes.get(key) ?? { id, tail: Promise.resolve(), confirmed, latest: intent }
  state.latest = intent
  writes.set(key, state)
  state.tail = state.tail.then(async () => {
    if (writes.get(key) !== state) return
    let failed = false
    try {
      const result = await setSessionPinnedRemote(id, pinned, profile)
      if (result.ok !== true) throw new Error('Gateway did not confirm pinned status')
      state.confirmed = pinned
    } catch { failed = true }
    if (writes.get(key) !== state || state.latest !== intent) return
    writes.delete(key)
    intent.settle(state.confirmed, failed)
    if (failed) reportActionFailure('Could not change pinned status.')
  })
}
