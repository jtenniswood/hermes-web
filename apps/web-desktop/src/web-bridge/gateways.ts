import { configuredGatewayUrl, runtimeConfig } from '../platform/runtime'

export interface GatewayConnection {
  id: string
  name: string
  url: string
  authMode: 'oauth' | 'token'
  token?: string
}

export function servingBase(): string { return window.location.origin }
export function normalizeBase(url: string): string {
  if (!configuredGatewayUrl(url)) throw new Error('The gateway is configured by the web server. Sign in to the configured connection or ask its operator to change it.')
  return servingBase()
}
export function classifyGatewayReach(url: string): 'server-configured' | null {
  return configuredGatewayUrl(url) ? null : 'server-configured'
}

// Compatibility signatures retained while transport callers migrate. Requests
// always target the same origin; browser input cannot select the proxy backend.
export function upstreamOriginFor(_url: string): null { return null }
export function activeUpstreamOrigin(): null { return null }
export function withGatewayRoute(url: string, _origin: string | null): string { return url }
export function syncDevGatewayCookie(): void {
  document.cookie = 'hermes_dev_gateway=; path=/; Max-Age=0; SameSite=Lax'
}

const STORAGE_KEY = 'hermes-ui.gateways'
export function getActiveGateway(): GatewayConnection {
  const config = runtimeConfig()
  const fallback: GatewayConnection = { id: config.gateway.id, name: config.gateway.name, url: '', authMode: 'oauth' }
  try {
    const store = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
    const saved = store?.gateways?.find((entry: GatewayConnection) => entry.id === store.activeId)
    if (saved && typeof saved.url === 'string' && configuredGatewayUrl(saved.url)) {
      return { ...fallback, authMode: saved.authMode === 'token' ? 'token' : 'oauth', token: typeof saved.token === 'string' ? saved.token : '' }
    }
  } catch { /* Malformed or unavailable legacy storage leaves the configured gateway signed out. */ }
  return fallback
}
export function updateGateway(id: string, patch: Partial<Omit<GatewayConnection, 'id'>>): void {
  if (id !== runtimeConfig().gateway.id) throw new Error('Unknown configured gateway')
  if (patch.url !== undefined) normalizeBase(patch.url)
  const gateway = { ...getActiveGateway(), ...patch, id, url: '' }
  // Preserve the legacy records during the transition; no saved gateway is deleted.
  let store: { version: number; activeId: string; gateways: GatewayConnection[] }
  try { store = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') } catch { store = null! }
  if (!store || !Array.isArray(store.gateways)) store = { version: 1, activeId: id, gateways: [] }
  store.gateways = [...store.gateways.filter(entry => entry?.id !== id), gateway]
  store.activeId = id
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
}
