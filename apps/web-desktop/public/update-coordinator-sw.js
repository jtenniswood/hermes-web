/* Activate an update only when every existing app tab has flushed its drafts.
 * Old clients without this protocol time out: close them before updating. */
let preparingUpdate = false
const appClients = async () => (await self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
  .filter(client => client.url.startsWith(self.registration.scope))
const sameClients = (left, right) => left.length === right.length && right.every(client => left.some(known => known.id === client.id))
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
    try {
      const clients = await appClients()
      if (!clients.length) return
      let originalTexts
      // Older composers can refuse verification while cross-tab storage events
      // settle. Retry that refusal once with a new transaction and every check.
      for (let attempt = 0; attempt < 2; attempt++) {
        const transaction = crypto.randomUUID()
        let committed = false
        try {
          const participants = attempt === 0 ? clients : await appClients()
          if (!sameClients(clients, participants)) return
          const replies = await Promise.all(participants.map(client => askClient(client, 'HERMES_FLUSH_UPDATE', transaction)))
          if (replies.some(reply => !reply?.ready)) return
          // Two tabs editing the same session differently must not overwrite each other.
          const texts = new Map()
          for (const reply of replies) for (const [key, text] of Object.entries(reply.texts || {})) {
            if (texts.has(key) && texts.get(key) !== text) return
            texts.set(key, text)
          }
          // A fresh snapshot must never conceal a draft lost or changed since
          // the first attempt, including drafts in an unmounted conversation.
          if (originalTexts && [...originalTexts].some(([key, text]) => !texts.has(key) || texts.get(key) !== text)) return
          originalTexts ??= texts
          const current = await appClients()
          if (!sameClients(clients, current)) return
          const checks = await Promise.all(current.map(client => askClient(client, 'HERMES_VERIFY_UPDATE', transaction)))
          if (checks.some(reply => !reply?.ready)) continue
          if (!sameClients(clients, await appClients())) return
          await self.skipWaiting()
          committed = true
          return
        } finally {
          if (!committed) for (const client of await appClients()) client.postMessage({ type: 'HERMES_ABORT_UPDATE', transaction })
        }
      }
    } finally {
      preparingUpdate = false
    }
  })())
})
