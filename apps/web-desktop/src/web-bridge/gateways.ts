import { connectionState } from '../platform/connection-state'
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

export function getActiveGateway(): GatewayConnection {
  const config = runtimeConfig()
  const state = connectionState().load()
  return { id: config.gateway.id, name: config.gateway.name, url: '', authMode: state.authMode, token: state.token }
}
export function updateGateway(id: string, patch: Partial<Omit<GatewayConnection, 'id'>>): void {
  if (id !== runtimeConfig().gateway.id) throw new Error('Unknown configured gateway')
  if (patch.url !== undefined) normalizeBase(patch.url)
  connectionState().update({ ...(patch.authMode ? { authMode: patch.authMode } : {}), ...(patch.token !== undefined ? { token: patch.token } : {}) })
}
