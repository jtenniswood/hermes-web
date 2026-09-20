import type { DesktopBootProgress, DesktopCloudAgentSignInResult, DesktopCloudDiscoverResult, DesktopCloudStatus, QuickEntryStatus, QuickEntrySubmitPayload } from '../upstream/types'
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

import { buildInfo } from '../build-info'
import { createWebZoomBridge } from '../platform/display'
import { clipboardImageAsFile, readClipboard, writeClipboard } from '../platform/clipboard'
import { isUnderPluginRoot, isWebFileHandle, registerWebFile, webFileAsDataUrl, ensureFileInput, pickWithInput, acceptsFor } from '../platform/files'
import { webNotify } from '../platform/notifications'
import { WEB_CONNECTION_ID, wsBaseUrl, connection, connectionForProfile, resolveToken, buildTokenWsUrl, mintWsTicket, apiFetch, waitForRemoteRestart, loadStoredConnection, persistConnection, toConnectionConfig, fetchStatus, baseUrl, isSameOrigin, openOauthLoginPopup } from '../platform/connection'
const noop = (): void => {}
const unsubscribed = (): (() => void) => noop

function readyBootProgress(): DesktopBootProgress {
  return {
    error: null,
    fakeMode: false,
    message: 'Ready',
    phase: 'backend.ready',
    progress: 100,
    running: false,
    timestamp: Date.now()
  }
}

/**
 * Everything the web build supports. `terminal` and `git` are
 * intentionally absent: their consumers probe for bridge presence and
 * self-disable (terminal), or never reach the native path in remote mode
 * (git). The browser provides its own zoom implementation below.
 */
type WebBridge = Omit<Window['hermesDesktop'], 'terminal' | 'git'> & { agentPluginsRoot: () => Promise<string> }

export function createWebBridge(): Window['hermesDesktop'] {
  window.__HERMES_WEB_BRIDGE__ = true

  const bridge: WebBridge = {
    zoom: createWebZoomBridge(),
    getConnection: async profile => connection(profile),
    getConnectionFor: async ({ connectionId, profile }) => connectionForProfile(connectionId, profile),
    // Single-gateway web: every profile is served by the live connection.
    getProfileRoutes: async profiles =>
      profiles.map(name => ({
        connectionId: WEB_CONNECTION_ID,
        mode: 'remote',
        profile: name,
        targetProfile: name
      })),
    // Web has no spawn pool; report the default UI values (Settings rows read them).
    getPoolLimits: async () => ({ maxBackends: 3, idleMs: 10 * 60_000 }),
    setPoolLimits: async () => ({ ok: false, limits: { maxBackends: 3, idleMs: 10 * 60_000 } }),
    openBrowserWindow: async () => ({ ok: false, error: 'no browser pop-out in the web app' }),
    onBrowserPopoutClosed: unsubscribed,
    // No OS keychain in the browser; secrets encryption stays off.
    getSecretStorageEncryption: async () => ({ on: false }),
    setSecretStorageEncryption: async () => ({ on: false }),
    revalidateConnection: async () => ({ ok: true, rebuilt: false }),
    touchBackend: async () => ({ ok: true }),
    // Single window in the browser: always the first to claim a cue.
    claimAmbientCue: async () => true,
    getGatewayWsUrl: async () => {
      // One origin for both the ticket mint and the socket connect, so the dev
      // proxy routes them to the same gateway (a mismatch would 4403).
      const origin = activeUpstreamOrigin()
      const token = resolveToken()

      if (token) {return withGatewayRoute(buildTokenWsUrl(token), origin)}
      const ticket = await mintWsTicket(origin)

      return withGatewayRoute(`${wsBaseUrl()}/api/ws?ticket=${encodeURIComponent(ticket)}`, origin)
    },
    getGatewayWsUrlFor: async ({ connectionId }) => {
      // Bot Mode routes profiles through the web-single registry source. It is
      // still this same gateway, so mint the same fresh ticket used by the
      // primary path rather than making the renderer fall back to its stale
      // connection URL.
      if (connectionId && connectionId !== WEB_CONNECTION_ID) {
        throw new Error(`Unknown web connection: ${connectionId}`)
      }

      return bridge.getGatewayWsUrl()
    },
    openSessionWindow: async sessionId => {
      const opened = window.open(`${window.location.pathname}#/${sessionId}`, '_blank', 'noopener')

      return opened ? { ok: true } : { ok: false, error: 'popup-blocked' }
    },
    openWindow: async () => {
      const opened = window.open(window.location.pathname, '_blank', 'noopener')

      return opened ? { ok: true } : { ok: false, error: 'popup-blocked' }
    },
    // No external terminal in a browser — resume-in-terminal is unavailable.
    openSessionInTerminal: async () => ({ ok: false, error: 'terminal is unavailable in the web app' }),
    // v2 connection registry is desktop-main-process state; the web app rides
    // the gateway connection it was served from, so the registry is read-only
    // empty (mutation attempts fail cleanly instead of pretending to persist).
    connections: {
      list: async () => ({ version: 1, primary: '', secureTokenStorage: false, connections: [] }),
      save: async payload => ({
        ok: false,
        connection: {
          id: payload.id ?? '',
          kind: payload.kind,
          label: payload.label,
          url: payload.url,
          authMode: payload.authMode,
          org: payload.org,
          host: payload.host,
          user: payload.user,
          port: payload.port ?? undefined,
          keyPath: payload.keyPath,
          remoteHermesPath: payload.remoteHermesPath,
          remoteProfile: payload.remoteProfile,
          tokenSet: false,
          tokenPreview: null
        },
        registry: { version: 1, primary: '', secureTokenStorage: false, connections: [] }
      }),
      remove: async () => ({ ok: false, registry: { version: 1, primary: '', secureTokenStorage: false, connections: [] } }),
      setPrimary: async () => ({ ok: false, registry: { version: 1, primary: '', secureTokenStorage: false, connections: [] } }),
      test: async () => ({ ok: false, error: 'connections are managed by the desktop app' }),
      updateAll: async () => ({ ok: false, results: [] })
    },
    petOverlay: {
      open: async () => ({ ok: false }),
      close: async () => ({ ok: true }),
      setBounds: noop,
      setIgnoreMouse: noop,
      setFocusable: noop,
      pushState: noop,
      control: noop,
      onState: unsubscribed,
      onControl: unsubscribed
    },
    getBootProgress: async () => readyBootProgress(),
    // The browser has no Desktop-owned child process to recycle. Ask the
    // connected gateway to restart itself, then wait for the replacement so
    // ModelSettings does not immediately retry against the stale process.
    recycleBackend: async profile => {
      await apiFetch<{ ok: boolean }>({
        method: 'POST',
        path: '/api/gateway/restart',
        profile: profile ?? undefined,
        timeoutMs: 10_000
      })
      await waitForRemoteRestart()

      return { ok: true }
    },
    getConnectionConfig: async () => toConnectionConfig(loadStoredConnection()),
    saveConnectionConfig: async input => toConnectionConfig(persistConnection(input)),
    applyConnectionConfig: async input => {
      const next = persistConnection(input)
      // Reconnecting the live socket in place is fiddly; a reload re-runs the
      // whole boot path against the new connection, which is exactly what the
      // desktop shell does on "Save and reconnect". Defer so this promise
      // resolves (and the UI can settle) before the navigation.
      setTimeout(() => window.location.reload(), 50)

      return toConnectionConfig(next)
    },
    testConnectionConfig: async input => {
      const remoteUrl = input?.remoteUrl ?? loadStoredConnection().remoteUrl
      const base = normalizeBase(remoteUrl)
      // Route by the gateway being tested (not the active one).
      const status = await fetchStatus(base, upstreamOriginFor(remoteUrl))

      return { baseUrl: base, ok: true, version: status?.version ?? null }
    },
    probeConnectionConfig: async remoteUrl => {
      const base = normalizeBase(remoteUrl)

      // A different-origin gateway is blocked by the browser (mixed content +
      // localhost-only CORS) before the fetch is meaningful. Report the real
      // reason via `error` so the UI explains it, instead of firing a doomed
      // request that surfaces as a generic "could not reach".
      const block = classifyGatewayReach(remoteUrl)

      if (block) {
        return { baseUrl: base, reachable: false, authMode: 'unknown', providers: [], version: null, error: block }
      }

      try {
        const status = await fetchStatus(base, upstreamOriginFor(remoteUrl))

        return {
          baseUrl: base,
          reachable: true,
          authMode: status?.auth_required ? 'oauth' : 'token',
          providers: (status?.auth_providers ?? []).map(name => ({ name, displayName: name })),
          version: status?.version ?? null,
          error: null
        }
      } catch (error) {
        return {
          baseUrl: base,
          reachable: false,
          authMode: 'unknown',
          providers: [],
          version: null,
          error: error instanceof Error ? error.message : String(error)
        }
      }
    },
    oauthLoginConnectionConfig: async remoteUrl => {
      const base = remoteUrl ? normalizeBase(remoteUrl) : baseUrl()
      const origin = remoteUrl ? upstreamOriginFor(remoteUrl) : activeUpstreamOrigin()

      // A cross-origin absolute URL can never hold a login session in the
      // browser (see isSameOrigin). A whitelisted gateway folds to the serving
      // origin (proxied), so it passes; a genuinely cross-origin one fails loudly
      // with guidance instead of stranding the user on the gateway's dashboard.
      if (!isSameOrigin(base)) {
        throw new Error(
          `This gateway (${base}) is on a different origin than the app, so the browser ` +
            'will not keep its login session after sign-in. Reach it on the same origin ' +
            'instead: whitelist it (HERMES_GATEWAY_URL or config.json) so the dev proxy ' +
            "folds it same-origin, or use a session token. Desktop can use an absolute URL; the browser can't."
        )
      }

      // Same-origin (incl. a whitelisted gateway folded through the dev proxy):
      // mirror the desktop popup so the app stays mounted. Sync the routing
      // cookie first so the IDP callback navigation reaches this gateway.
      syncDevGatewayCookie()

      return openOauthLoginPopup(base, origin)
    },
    oauthLogoutConnectionConfig: async remoteUrl => {
      const base = remoteUrl ? normalizeBase(remoteUrl) : baseUrl()
      const origin = remoteUrl ? upstreamOriginFor(remoteUrl) : activeUpstreamOrigin()
      await fetch(withGatewayRoute(`${base}/auth/logout`, origin), { method: 'POST', credentials: 'same-origin' })

      return { ok: true, connected: false }
    },
    profile: {
      get: async () => ({ profile: null }),
      // Web has no persistent "next-launch" profile; echo the current (null) one.
      remember: async name => ({ profile: name }),
      set: async name => ({ profile: name })
    },
    sshConfigHosts: async () => ({ hosts: [] }),
    sshResolveHost: async host => ({ hostname: host, identityFile: null, port: null, user: null }),
    // Hermes Cloud: no portal session exists in the browser; report signed-out.
    cloud: {
      status: async (): Promise<DesktopCloudStatus> => ({ portalBaseUrl: '', signedIn: false }),
      login: async (): Promise<DesktopCloudStatus & { ok: boolean }> => ({ portalBaseUrl: '', signedIn: false, ok: false }),
      logout: async (): Promise<DesktopCloudStatus & { ok: boolean }> => ({ portalBaseUrl: '', signedIn: false, ok: false }),
      discover: async (): Promise<DesktopCloudDiscoverResult> => ({ agents: [], needsOrgSelection: false }),
      agentSignIn: async (dashboardUrl: string): Promise<DesktopCloudAgentSignInResult> => ({ baseUrl: dashboardUrl, connected: false })
    },
    api: apiFetch,
    notify: webNotify,
    requestMicrophoneAccess: async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        stream.getTracks().forEach(track => track.stop())

        return true
      } catch {
        return false
      }
    },
    readFileDataUrl: async filePath => {
      if (isWebFileHandle(filePath)) {
        return webFileAsDataUrl(filePath)
      }

      throw new Error('local file access is unavailable in the web app')
    },
    readFileDataUrlForAttach: async filePath => {
      if (isWebFileHandle(filePath)) {
        return webFileAsDataUrl(filePath)
      }

      throw new Error('local file access is unavailable in the web app')
    },
    dataUrlReadMax: {
      get: async () => ({ defaultMaxMb: 25, maxBytes: 0, maxMb: 0 }),
      set: async maxMb => ({ defaultMaxMb: 25, maxBytes: maxMb * 1024 * 1024, maxMb })
    },
    readFileText: async filePath => {
      if (!isUnderPluginRoot(filePath)) {
        throw new Error('local file access is unavailable in the web app')
      }

      const res = await fetch(filePath)

      if (!res.ok) {throw new Error(`${res.status}: ${res.statusText}`)}

      const text = await res.text()

      return { path: filePath, text }
    },
    selectPaths: async options => {
      if (options?.directories) {
        // Folders have no single byte payload a remote gateway can stage
        // (`@folder:` refs point at a server-side path); keep the picker
        // file-only rather than emitting a ref to an unreadable handle.
        return []
      }

      const input = ensureFileInput()
      input.multiple = options?.multiple !== false
      input.webkitdirectory = false
      input.accept = acceptsFor(options?.filters)

      const files = await pickWithInput(input)

      return files.map(file => registerWebFile(file, file.name))
    },
    selectSavePath: async () => null,
    readClipboard,
    writeClipboard,
    saveImageFromUrl: async url => {
      // A browser can't hand bytes to the OS save dialog the way Electron's
      // main process does, so trigger a native anchor download instead. The
      // naive `window.open(url, '_blank', ...)` shipped before got popup
      // blocked (async bridge hop + cross-origin URL) and the browser landed
      // on about:blank#blocked — worse, it never actually saved the file.
      try {
        const response = await fetch(url)

        if (!response.ok) {
          return false
        }

        const blob = await response.blob()
        const objectUrl = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = objectUrl
        link.download = url.split('?')[0].split('/').filter(Boolean).pop() || 'image'
        link.rel = 'noopener noreferrer'
        document.body.appendChild(link)
        link.click()
        link.remove()
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000)

        return true
      } catch {
        return false
      }
    },
    saveImageBuffer: async (data, ext) => {
      const bytes = data instanceof Uint8Array ? (data as Uint8Array<ArrayBuffer>) : new Uint8Array(data)
      const extClean = ext.replace(/^\./, '').toLowerCase()
      const mime = extClean === 'jpg' ? 'image/jpeg' : `image/${extClean}`

      return registerWebFile(new Blob([bytes], { type: mime }), `image.${extClean}`)
    },
    saveClipboardImage: async () => {
      const blob = await clipboardImageAsFile()

      return blob ? registerWebFile(blob) : ''
    },
    savePastedText: async text => registerWebFile(new Blob([text], { type: 'text/plain' }), 'pasted-text.txt'),
    getPathForFile: file => registerWebFile(file, file.name),
    normalizePreviewTarget: async () => null,
    watchPreviewFile: async url => ({ id: '', path: url }),
    watchDirectory: async dir => ({ id: '', path: dir }),
    stopPreviewFileWatch: async () => true,
    setTitleBarTheme: noop,
    setNativeTheme: noop,
    setTranslucency: noop,
    setPreviewShortcutActive: noop,
    setActiveWork: noop,
    setKeepAwake: noop,
    openExternal: async url => {
      window.open(url, '_blank', 'noopener')
    },
    openPreviewInBrowser: async url => {
      window.open(url, '_blank', 'noopener')
    },
    fetchLinkTitle: async url => url,
    sanitizeWorkspaceCwd: async cwd => ({ cwd: cwd ?? '', sanitized: false }),
    settings: {
      getDefaultProjectDir: async () => ({ defaultLabel: '', dir: null, resolvedCwd: '' }),
      pickDefaultProjectDir: async () => ({ canceled: true, dir: null }),
      setDefaultProjectDir: async () => { throw new Error('A default local project directory is unavailable in the browser') }
    },
    revealLogs: async () => ({ ok: false, path: '' }),
    getRecentLogs: async () => ({ path: '', lines: [] }),
    reportRendererError: noop,
    gitRoot: async () => null,
    revealPath: async () => false,
    openDir: async () => ({ ok: false, error: 'local file access is unavailable in the web app' }),
    desktopPluginsRoot: async () => `${servingBase()}/desktop-plugins`,
    agentPluginsRoot: async () => `${servingBase()}/plugins`,
    renamePath: async () => {
      throw new Error('local file access is unavailable in the web app')
    },
    writeTextFile: async () => {
      throw new Error('local file access is unavailable in the web app')
    },
    trashPath: async () => false,
    readDir: async dir => {
      if (!isUnderPluginRoot(dir)) {
        return { entries: [], error: 'local file access is unavailable in the web app' }
      }

      const res = await fetch(`${dir}/.listing`)

      if (!res.ok) {return { entries: [], error: `${res.status}: ${res.statusText}` }}

      // {name,type} objects: the dev middleware (vite.config.ts) and nginx's
      // built-in autoindex (nginx.conf.template, production) both emit this
      // shape; only directory entries are listed.
      const raw = (await res.json()) as Array<{ name?: string; type?: string }>
      const names = raw
        .filter(e => e && e.type === 'directory' && e.name && e.name !== '.' && e.name !== '..')
        .map(e => e.name as string)

      return { entries: names.map(name => ({ name, path: `${dir}/${name}`, isDirectory: true })) }
    },
    onClosePreviewRequested: unsubscribed,
    onOpenFolderRequested: unsubscribed,
    onOpenUpdatesRequested: unsubscribed,
    onOpenFindBarRequested: unsubscribed,
    onDeepLink: unsubscribed,
    signalDeepLinkReady: async () => ({ ok: true }),
    onWindowStateChanged: unsubscribed,
    onFocusSession: unsubscribed,
    onNotificationAction: unsubscribed,
    onPreviewFileChanged: unsubscribed,
    onBackendExit: unsubscribed,
    onPowerResume: unsubscribed,
    onConnectionApplied: unsubscribed,
    getOnBattery: async () => false,
    onBatteryChanged: unsubscribed,
    onBootProgress: unsubscribed,
    getBootstrapState: async () => ({
      active: false,
      manifest: null,
      stages: {},
      error: null,
      log: [],
      startedAt: null,
      completedAt: null,
      setupChoice: null,
      unsupportedPlatform: null
    }),
    resetBootstrap: async () => ({ ok: true }),
    repairBootstrap: async () => ({ ok: true }),
    cancelBootstrap: async () => ({ ok: true, cancelled: true }),
    continueBootstrapLocal: async () => ({ ok: true }),
    onBootstrapEvent: unsubscribed,
    getVersion: async () => {
      // Frontend and backend versions have independent release lifecycles.
      let backendVersion = ''
      try {
        const status = await fetchStatus(baseUrl(), activeUpstreamOrigin())
        if (status?.version) {
          backendVersion = status.version
        }
      } catch {
        // Gateway unreachable → leave blank; the UI falls back to the
        // "version unavailable" state.
      }
      return {
        appVersion: `web-${buildInfo.wrapperRevision.slice(0, 12)}`,
        backendVersion,
        rendererRevision: buildInfo.rendererRevision,
        electronVersion: '',
        nodeVersion: '',
        platform: 'web',
        hermesRoot: ''
      }
    },
    getRemoteDisplayReason: async () => null,
    updates: {
      check: async () => ({ supported: false }),
      apply: async () => ({ ok: false }),
      getBranch: async () => ({ branch: '' }),
      setBranch: async () => ({ branch: '' }),
      onProgress: unsubscribed
    },
    uninstall: {
      summary: async () => {
        throw new Error('uninstall is unavailable in the web app')
      },
      run: async () => {
        throw new Error('uninstall is unavailable in the web app')
      }
    },
    themes: {
      fetchMarketplace: async () => {
        throw new Error('marketplace themes are unavailable in the web app')
      },
      searchMarketplace: async () => []
    },
    // Quick Entry needs an OS-level global hotkey, which a browser tab cannot
    // own; report it as disabled so Settings shows the toggle truthfully.
    quickEntry: {
      getSettings: async (): Promise<QuickEntryStatus> => ({ enabled: false, error: null, registered: false, shortcut: '' }),
      setSettings: async (): Promise<QuickEntryStatus> => ({ enabled: false, error: null, registered: false, shortcut: '' }),
      submit: (_payload: QuickEntrySubmitPayload): void => {},
      dismiss: noop,
      pushState: noop,
      onState: unsubscribed,
      onSubmit: unsubscribed,
      onShown: unsubscribed
    },
    findInPage: async () => ({ count: 0 }),
    stopFindInPage: async () => {},
    onFoundInPage: unsubscribed
  }

  // Desktop declares terminal as required, but browser consumers probe for it.
  // Keep native APIs absent; the checked WebBridge type covers every supported member.
  return bridge as unknown as Window['hermesDesktop']
}
