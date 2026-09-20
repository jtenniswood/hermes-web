import { beginOperation } from './reload-safety'
import type { DesktopConnectionConfig, DesktopConnectionConfigInput, DesktopOauthLoginResult, HermesApiRequest, HermesConnection } from '../upstream/types'
import {
  activeUpstreamOrigin,
  classifyGatewayReach,
  getActiveGateway,
  normalizeBase,
  servingBase,
  syncDevGatewayCookie,
  updateGateway,
  upstreamOriginFor,
  withGatewayRoute
} from '../web-bridge/gateways'

export const WEB_CONNECTION_ID = 'web-single'

/**
 * The bridge always operates on the ACTIVE gateway (see `./gateways`). This is
 * the adapter shape the connection-config methods below speak; it is derived
 * from, and written back to, the active gateway entry.
 */
interface StoredConnection {
  mode: 'local' | 'remote'
  remoteAuthMode: 'oauth' | 'token'
  remoteToken: string
  remoteUrl: string
}

export function loadStoredConnection(): StoredConnection {
  const gateway = getActiveGateway()

  return {
    mode: 'remote',
    remoteAuthMode: gateway.authMode,
    remoteToken: gateway.token ?? '',
    remoteUrl: gateway.url || servingBase()
  }
}

export function persistConnection(input: DesktopConnectionConfigInput): StoredConnection {
  updateGateway(getActiveGateway().id, {
    ...(input.remoteAuthMode !== undefined ? { authMode: input.remoteAuthMode } : {}),
    // An omitted token means "leave the saved one unchanged".
    ...(input.remoteToken !== undefined ? { token: input.remoteToken } : {}),
    ...(input.remoteUrl !== undefined ? { url: input.remoteUrl.trim() } : {})
  })

  return loadStoredConnection()
}

export function baseUrl(): string {
  return normalizeBase(getActiveGateway().url)
}

/** Only the active deployment's explicitly bound credential is eligible. */
export function resolveToken(): string {
  const gateway = getActiveGateway()
  return gateway.authMode === 'token' ? gateway.token ?? '' : ''
}

export function wsBaseUrl(): string {
  const httpBase = baseUrl()

  return httpBase.replace(/^http/, 'ws')
}

export function buildTokenWsUrl(token: string): string {
  return `${wsBaseUrl()}/api/ws?token=${encodeURIComponent(token)}`
}

export async function mintWsTicket(origin: string | null): Promise<string> {
  const res = await fetch(withGatewayRoute(`${baseUrl()}/api/auth/ws-ticket`, origin), {
    method: 'POST',
    credentials: 'same-origin'
  })

  if (!res.ok) {
    throw new Error(`${res.status}: failed to mint websocket ticket`)
  }

  const body = (await res.json()) as { ticket?: string }

  if (!body.ticket) {throw new Error('ws-ticket response had no ticket')}

  return body.ticket
}

/**
 * True when the active gateway currently has a usable session. Token gateways
 * are "connected" if a token is present; OAuth/cookie gateways are probed via
 * the public-ish /api/auth/me (200 = signed in, 401 = not). Best-effort: any
 * failure reports not-connected so the UI offers a sign-in path rather than
 * falsely claiming a live session.
 */
export async function probeAuthConnected(
  base: string = baseUrl(),
  origin: string | null = activeUpstreamOrigin()
): Promise<boolean> {
  if (resolveToken()) {
    return true
  }

  try {
    const res = await fetch(withGatewayRoute(`${base}/api/auth/me`, origin), {
      credentials: 'same-origin',
      signal: AbortSignal.timeout(6_000)
    })

    return res.ok
  } catch {
    return false
  }
}

/**
 * True when `base` shares the app's origin. OAuth in the browser only works
 * same-origin: the gateway sets its session as an `HttpOnly; SameSite=Lax`
 * cookie with no credentialed CORS, so the browser refuses to send it back on a
 * cross-origin fetch/WS. Same-origin covers the zero-config default gateway and
 * any `/prefix` gateway (both resolve to the serving origin, which the Vite dev
 * proxy or the gateway's own static host routes through), plus production where
 * the gateway serves the app. An absolute cross-origin URL never can.
 */
export function isSameOrigin(base: string): boolean {
  try {
    return new URL(base, window.location.href).origin === window.location.origin
  } catch {
    return false
  }
}

/**
 * Browser equivalent of the desktop's `openOauthLoginWindow`: open the
 * gateway's `/login` in a child window and poll our own (same-origin) session
 * until it goes live, resolving `connected: true` then. The app window is never
 * navigated away - exactly the desktop behaviour. Resolves `connected: false`
 * if the popup is blocked, the user closes it before finishing, or the login
 * doesn't complete within the timeout.
 */
export function openOauthLoginPopup(base: string, origin: string | null): Promise<DesktopOauthLoginResult> {
  return new Promise(resolve => {
    const popup = window.open(
      withGatewayRoute(`${base}/login`, origin),
      'hermes-oauth-login',
      'width=520,height=720'
    )

    if (!popup) {
      resolve({ ok: false, baseUrl: base, connected: false })

      return
    }

    // Sever the popup's back-reference to us so a later cross-origin page (the
    // IDP, or any redirect it makes) can't drive our window via window.opener
    // (reverse tabnabbing). We can't pass `noopener` to window.open because that
    // returns null and we need the handle to poll `.closed` / call `.close()`.
    // Safe to set here: the popup is still on our same-origin `/login`.
    try {
      popup.opener = null
    } catch {
      // Some browsers make opener read-only; the poll/close path still works.
    }

    let settled = false
    const startedAt = Date.now()
    const TIMEOUT_MS = 5 * 60_000

    const finish = (connected: boolean): void => {
      if (settled) {return}
      settled = true
      clearInterval(timer)

      try {
        if (!popup.closed) {popup.close()}
      } catch {
        // Closing a window we opened is always allowed, but guard anyway.
      }

      resolve({ ok: true, baseUrl: base, connected })
    }

    // The gateway lands on `/` (a valid authenticated page) after the callback
    // sets the cookies; we only care that the cookie jar is populated, which we
    // observe from the app window via /api/auth/me now that it's same-origin.
    const timer = setInterval(() => {
      void (async () => {
        if (settled) {return}

        if (await probeAuthConnected(base, origin)) {
          finish(true)

          return
        }

        if (popup.closed || Date.now() - startedAt > TIMEOUT_MS) {
          finish(false)
        }
      })()
    }, 600)
  })
}

const DEFAULT_API_TIMEOUT_MS = 30_000

export async function apiFetch<T>(request: HermesApiRequest): Promise<T> {
  const { body, method = 'GET', path, profile, timeoutMs } = request
  let url = baseUrl() + path

  if (profile) {
    url += `${url.includes('?') ? '&' : '?'}profile=${encodeURIComponent(profile)}`
  }

  const token = resolveToken()
  const headers: Record<string, string> = {}

  if (body !== undefined) {headers['Content-Type'] = 'application/json'}

  if (token) {headers['X-Hermes-Session-Token'] = token}

  const finish = method === 'GET' ? () => {} : beginOperation()
  try {
  const res = await fetch(withGatewayRoute(url, activeUpstreamOrigin()), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
    signal: AbortSignal.timeout(timeoutMs ?? DEFAULT_API_TIMEOUT_MS)
  })

  const text = await res.text()

  if (!res.ok) {
    // Do NOT navigate away on 401. The app shell must stay mounted so the user
    // can reach Settings -> Gateway (change the URL, switch gateways, sign in).
    // Boot surfaces the reauth state via the WS path (getGatewayWsUrl ->
    // GatewayReauthRequiredError) which drives the boot-failure sign-in branch.
    // Same error contract as the Electron IPC handler: reject with "NNN: msg".
    throw new Error(`${res.status}: ${text || res.statusText}`)
  }

  if (!text) {return null as T}
  const trimmed = text.trimStart()

  if (trimmed.startsWith('<')) {
    throw new Error(`Expected JSON from ${url} but got HTML`)
  }

  return JSON.parse(text) as T
  } finally { finish() }
}

export function connection(profile?: string | null): HermesConnection {
  const token = resolveToken()

  return {
    baseUrl: baseUrl(),
    connectionId: WEB_CONNECTION_ID,
    mode: 'remote',
    registryScoped: true,
    source: 'settings',
    // 'oauth' forces the renderer to re-resolve the WS URL through
    // getGatewayWsUrl on every reconnect, which cookie mode needs because
    // tickets are single-use.
    authMode: token ? 'token' : 'oauth',
    token,
    wsUrl: token ? buildTokenWsUrl(token) : '',
    logs: [],
    sharedRemote: true,
    ...(profile ? { sharedPrimary: true } : {}),
    isFullscreen: false,
    nativeOverlayWidth: 0,
    windowButtonPosition: null,
    ...(profile ? { profile } : {})
  }
}

/** Resolve any Bot Mode profile onto this browser's one shared gateway. */
export function connectionForProfile(connectionId?: null | string, profile?: null | string): HermesConnection {
  const requestedId = (connectionId ?? '').trim()

  if (requestedId && requestedId !== WEB_CONNECTION_ID) {
    throw new Error(`Unknown web connection: ${requestedId}`)
  }

  return connection(profile)
}

export async function toConnectionConfig(stored: StoredConnection): Promise<DesktopConnectionConfig> {
  const token = resolveToken()
  const hasToken = stored.remoteAuthMode === 'token' && Boolean(stored.remoteToken || token)
  // Reflect the REAL session state so isRemoteReauthFailure() can decide whether
  // to show the sign-in branch. Reporting a false "connected" here would hide
  // the sign-in path and strand the user on a dead connection.
  const remoteOauthConnected = stored.remoteAuthMode === 'oauth' ? await probeAuthConnected() : false

  return {
    // The server owns the gateway address; authentication remains browser state.
    envOverride: true,
    mode: stored.mode,
    profile: null,
    remoteAuthMode: stored.remoteAuthMode,
    remoteOauthConnected,
    remoteTokenPreview: stored.remoteToken ? `...${stored.remoteToken.slice(-4)}` : null,
    remoteTokenSet: hasToken,
    remoteUrl: stored.remoteUrl,
    // No OS keychain / SSH / cloud in the browser.
    secureTokenStorage: false,
    remoteTokenPlainText: false,
    cloudOrg: '',
    sshHost: '',
    sshUser: '',
    sshPort: null,
    sshKeyPath: '',
    sshRemoteHermesPath: '',
    sshRemoteProfile: ''
  }
}

/** GET /api/status against an arbitrary base, bypassing the auth header path. */
export async function fetchStatus(
  base: string,
  origin: string | null = null
): Promise<{ auth_providers?: string[]; auth_required?: boolean; version?: string } | null> {
  const res = await fetch(withGatewayRoute(`${base}/api/status`, origin), {
    cache: 'no-store',
    credentials: 'same-origin',
    signal: AbortSignal.timeout(8_000)
  })

  if (!res.ok) {throw new Error(`${res.status}: ${res.statusText}`)}

  return (await res.json()) as { auth_providers?: string[]; auth_required?: boolean; version?: string }
}

const REMOTE_RESTART_TIMEOUT_MS = 45_000
const REMOTE_RESTART_POLL_MS = 500

/**
 * The gateway restart endpoint hands the restart off to a detached process,
 * so its successful response is not proof that the replacement is ready.
 * Wait for the old process to disappear and the new gateway to answer before
 * the settings page retries the request that exposed the code skew.
 */
export async function waitForRemoteRestart(): Promise<void> {
  const deadline = Date.now() + REMOTE_RESTART_TIMEOUT_MS
  let unavailable = false

  while (Date.now() < deadline) {
    await new Promise<void>(resolve => window.setTimeout(resolve, REMOTE_RESTART_POLL_MS))

    try {
      await fetchStatus(baseUrl(), activeUpstreamOrigin())

      if (unavailable) {
        return
      }
    } catch {
      unavailable = true
    }
  }

  throw new Error('Timed out waiting for the gateway to restart')
}

