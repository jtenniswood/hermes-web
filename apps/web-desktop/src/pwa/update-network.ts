/** Keep background fetches from restarting the outgoing worker during activation. */
export function installUpdateNetworkBarrier() {
  const fetch = window.fetch.bind(window)
  let active = 0
  let generation = 0
  let release: (() => void) | undefined
  let resumed = Promise.resolve()

  window.fetch = async (...args: Parameters<typeof window.fetch>) => {
    while (release) {
      const signal = args[1]?.signal !== undefined ? args[1].signal
        : args[0] instanceof Request ? args[0].signal : undefined
      await new Promise<void>((resolve, reject) => {
        if (signal?.aborted) { reject(signal.reason); return }
        const aborted = () => { reject(signal!.reason) }
        signal?.addEventListener('abort', aborted, { once: true })
        void resumed.then(() => {
          signal?.removeEventListener('abort', aborted)
          resolve()
        })
      })
    }
    active++
    try { return await fetch(...args) } finally { active-- }
  }

  return {
    async pause(): Promise<boolean> {
      if (!release) {
        generation++
        resumed = new Promise<void>(resolve => { release = resolve })
      }
      const lease = generation, started = Date.now()
      let quietSince: number | undefined
      while (release && generation === lease && Date.now() - started < 2000) {
        if (active === 0) quietSince ??= Date.now()
        else quietSince = undefined
        // Allow completed responses to drain from the browser's worker queue.
        if (quietSince !== undefined && Date.now() - quietSince >= 100) return true
        await new Promise(resolve => setTimeout(resolve, 25))
      }
      return false
    },
    resume(): void {
      const resolve = release
      release = undefined
      generation++
      resolve?.()
    }
  }
}
