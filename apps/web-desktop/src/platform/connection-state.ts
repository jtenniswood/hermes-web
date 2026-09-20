import { configuredGatewayUrl, runtimeConfig } from './runtime'

export interface BrowserConnectionStateV2 {
  version: 2
  gatewayId: string
  authMode: 'oauth' | 'token'
  token: string
  migration: { source: 'none' | 'legacy-list' | 'legacy-single'; complete: boolean }
}
export interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void }
const keyFor = (id: string) => `hermes-web.connection.v2.${id}`

export function createConnectionState(storage: StorageLike, gatewayId: string, matches: (url: string) => boolean) {
  let current: BrowserConnectionStateV2 | undefined
  let persisted = false
  function parse(key: string): unknown { try { return JSON.parse(storage.getItem(key) || 'null') } catch { return null } }
  function persist(next: BrowserConnectionStateV2) {
    const verified = { ...next, migration: { ...next.migration, complete: true } }
    try {
      const encoded = JSON.stringify(verified)
      storage.setItem(keyFor(gatewayId), encoded)
      persisted = storage.getItem(keyFor(gatewayId)) === encoded
    } catch { persisted = false }
    current = persisted ? verified : { ...next, migration: { ...next.migration, complete: false } }
    return current
  }
  function load(): BrowserConnectionStateV2 {
    if (current) return current
    const saved = parse(keyFor(gatewayId)) as Partial<BrowserConnectionStateV2> | null
    if (saved?.version === 2 && saved.gatewayId === gatewayId && ['oauth', 'token'].includes(saved.authMode || '') && typeof saved.token === 'string' && saved.migration?.complete === true && ['none', 'legacy-list', 'legacy-single'].includes(saved.migration.source)) {
      current = saved as BrowserConnectionStateV2; persisted = true; return current
    }
    const next: BrowserConnectionStateV2 = { version: 2, gatewayId, authMode: 'oauth', token: '', migration: { source: 'none', complete: false } }
    const list = parse('hermes-ui.gateways') as { activeId?: unknown; gateways?: unknown } | null
    let legacy: { url?: unknown; authMode?: unknown; token?: unknown } | undefined
    let unambiguous = false
    if (Array.isArray(list?.gateways)) {
      const active = list.gateways.filter(item => item && typeof item === 'object' && item.id === list.activeId)
      if (active.length === 1) {
        legacy = active[0]
        // A global token cannot be assigned safely when several saved servers exist.
        unambiguous = list.gateways.length === 1
        next.migration.source = 'legacy-list'
      }
    } else {
      const single = parse('hermes-web.connection') as Record<string, unknown> | null
      if (single && typeof single === 'object') {
        legacy = { url: single.remoteUrl, authMode: single.remoteAuthMode, token: single.remoteToken }
        unambiguous = true
        next.migration.source = 'legacy-single'
      }
    }
    // An empty/same-origin legacy URL is not evidence of the old backend identity.
    // Only the configured backend's explicit origin can migrate credentials.
    if (legacy && typeof legacy.url === 'string' && legacy.url !== '' && matches(legacy.url)) {
      next.authMode = legacy.authMode === 'token' ? 'token' : 'oauth'
      if (next.authMode === 'token') {
        next.token = typeof legacy.token === 'string' ? legacy.token : ''
        if (!next.token && unambiguous) {
          try { next.token = storage.getItem('hermes-web.session-token') || '' } catch { /* Remain signed out. */ }
        }
      }
    }
    return persist(next)
  }
  return {
    load,
    persisted: () => { load(); return persisted },
    update(patch: { authMode?: 'oauth' | 'token'; token?: string }) {
      const next = { ...load(), ...patch }
      if (next.authMode === 'oauth') next.token = ''
      return persist(next)
    }
  }
}

let cached: { id: string; state: ReturnType<typeof createConnectionState> } | undefined
export function connectionState() {
  const config = runtimeConfig()
  if (cached?.id === config.gateway.id) return cached.state
  const storage: StorageLike = { getItem: key => window.localStorage.getItem(key), setItem: (key, value) => window.localStorage.setItem(key, value) }
  const matches = (url: string) => {
    try { return configuredGatewayUrl(url) && config.gateway.legacyUrls.includes(new URL(url).origin) } catch { return false }
  }
  const state = createConnectionState(storage, config.gateway.id, matches)
  cached = { id: config.gateway.id, state }
  return state
}

export function consumeConnectionToken(): void {
  const url = new URL(window.location.href)
  const token = url.searchParams.get('token') || window.__HERMES_SESSION_TOKEN__
  if (!token) return
  connectionState().update({ authMode: 'token', token })
  url.searchParams.delete('token')
  window.history.replaceState(null, '', url.toString())
  // An explicitly imported token is now bound to this deployment's gateway.
  delete window.__HERMES_SESSION_TOKEN__
}
