/* Activate an update only when every existing app tab has flushed its drafts.
 * Old clients without this protocol time out: close them before updating. */
let preparingUpdate = false
const appClients = async () => (await self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
  .filter(client => client.url.startsWith(self.registration.scope))
function askClient(client, type, transaction) {
  return new Promise(resolve => {
    const channel = new MessageChannel()
    const timer = setTimeout(() => { channel.port1.close(); resolve({ ready: false }) }, 4000)
    channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); resolve(event.data) }
    client.postMessage({ type, transaction }, [channel.port2])
  })
}
self.addEventListener('message', event => {
  if (event.data?.type !== 'HERMES_PREPARE_UPDATE' || preparingUpdate) return
  // Only a same-origin application client can request this protocol.
  if (!event.source?.url?.startsWith(self.registration.scope)) return
  preparingUpdate = true
  event.waitUntil((async () => {
    const transaction = crypto.randomUUID()
    let committed = false
    try {
      const clients = await appClients()
      if (!clients.length) return
      const replies = await Promise.all(clients.map(client => askClient(client, 'HERMES_FLUSH_UPDATE', transaction)))
      if (replies.some(reply => !reply?.ready)) return
      // Two tabs editing the same session differently must not overwrite each other.
      const texts = new Map()
      for (const reply of replies) for (const [key, text] of Object.entries(reply.texts || {})) {
        if (texts.has(key) && texts.get(key) !== text) return
        texts.set(key, text)
      }
      const current = await appClients()
      if (current.length !== clients.length || current.some(client => !clients.some(known => known.id === client.id))) return
      const checks = await Promise.all(current.map(client => askClient(client, 'HERMES_VERIFY_UPDATE', transaction)))
      if (checks.some(reply => !reply?.ready)) return
      await self.skipWaiting()
      committed = true
    } finally {
      if (!committed) for (const client of await appClients()) client.postMessage({ type: 'HERMES_ABORT_UPDATE', transaction })
      preparingUpdate = false
    }
  })())
})
