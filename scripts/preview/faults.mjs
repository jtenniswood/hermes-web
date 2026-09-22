/** In-process controls only: the served gateway never exposes a fault endpoint. */
export function createFaultControls() {
  const rules = [], pending = new Set(), calls = [], unexpected = []
  const matches = (match, call) => typeof match === 'function' ? match(call) : Object.entries(match).every(([key, value]) => call[key] === value)
  return {
    calls,
    unexpected,
    hold(match) {
      let entered, release
      const observed = new Promise(resolve => { entered = resolve })
      const waiting = new Promise(resolve => { release = resolve })
      rules.push({ match, run: async call => {
        pending.add(release)
        entered(call)
        await waiting
        pending.delete(release)
      } })
      return { entered: observed, release }
    },
    reject(match, message = 'Synthetic operation rejected', status = 503) {
      rules.push({ match, run: () => { throw Object.assign(new Error(message), { status, code: -32000 }) } })
    },
    async before(request) {
      const call = { ...structuredClone(request), sequence: calls.length + 1 }
      calls.push(call)
      const index = rules.findIndex(rule => matches(rule.match, call))
      if (index !== -1) await rules.splice(index, 1)[0].run(call)
      return call
    },
    unknown(request) {
      unexpected.push(structuredClone(request))
      throw Object.assign(new Error(`Unsupported synthetic ${request.transport}: ${request.method} ${request.path || ''}`), { status: 501, code: -32601 })
    },
    assertExpected() {
      if (unexpected.length) throw new Error(`Unexpected gateway operations: ${unexpected.map(call => `${call.transport} ${call.method} ${call.path || ''}`).join(', ')}`)
    },
    releaseAll() {
      rules.length = 0
      for (const release of pending) release()
      pending.clear()
    }
  }
}
