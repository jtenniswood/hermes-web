/** Persist one upstream draft at a time without replacing another tab's cache. */
export function createDraftPersistence(storageKey: string, maximum: number, storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, locks = navigator.locks) {
  const pending = new Map<string, { text: string; revision: number; failed: boolean }>()
  let revision = 0
  let tail: Promise<void> = Promise.resolve()
  let failure: unknown
  // Access can throw in restricted storage contexts; keep startup and typing usable.
  const store = () => storage ?? window.localStorage
  const read = (): Record<string, string> => {
    const value: unknown = JSON.parse(store().getItem(storageKey) || '{}')
    if (!value || Array.isArray(value) || typeof value !== 'object' || Object.values(value).some(text => typeof text !== 'string')) {
      throw new Error('Invalid saved drafts')
    }
    return value as Record<string, string>
  }
  return {
    pending: (key: string) => pending.has(key),
    cancel(key: string): void { pending.delete(key); failure = undefined },
    write(key: string, text: string): void {
      const current = pending.get(key)
      if (current?.text === text && !current.failed) return
      if (!current && !failure) {
        try { if ((read()[key] || '') === text) return } catch { /* Report through flush. */ }
      }
      const entry = { text, revision: ++revision, failed: false }
      pending.set(key, entry)
      tail = tail.then(async () => {
        if (pending.get(key) !== entry) return
        if (!locks) throw new Error('Shared draft locking is unavailable')
        await locks.request(storageKey, () => {
          if (pending.get(key) !== entry) return
          const values = new Map(Object.entries(read()))
          values.delete(key)
          if (text) values.set(key, text)
          const saved = Object.fromEntries([...values].slice(-maximum))
          if (Object.keys(saved).length) store().setItem(storageKey, JSON.stringify(saved))
          else store().removeItem(storageKey)
          if (JSON.stringify(read()) !== JSON.stringify(saved)) throw new Error('Draft storage did not retain the write')
          if (pending.get(key)?.revision === entry.revision) pending.delete(key)
          failure = undefined
        })
      }).catch(error => {
        if (pending.get(key) === entry) { entry.failed = true; failure = error }
      })
    },
    async flush(): Promise<void> {
      // Writes made while a previous save awaited the shared lock also belong
      // to this flush. Never acknowledge a partially drained queue.
      let observed
      do { observed = tail; await observed } while (tail !== observed)
      if (failure || pending.size) throw failure || new Error('Draft saves are still pending')
    }
  }
}
