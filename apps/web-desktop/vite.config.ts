import { buildInfoPlugin } from '../../scripts/build-info.mjs'
import { defineConfig, loadEnv, type Plugin, type PreviewServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { createProxyServer, type ProxyServer } from 'http-proxy-3'
import crypto from 'node:crypto'
import fs from 'fs'
import path from 'path'
import os from 'os'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Socket } from 'node:net'
import { VitePWA } from 'vite-plugin-pwa'

// The desktop renderer ships a Vite config with everything this build needs
// (monorepo aliases, emojibase assets, chunking); this config reuses those
// patterns but points the entry at apps/desktop/src/main via src/entry.ts.
// The dynamic gateway proxy below is ported from hermes-ui (MIT) so dev-mode
// /api, /auth, /login and /api/ws route to a configured gateway same-origin.

// `hgui` symlinks a worktree's node_modules to the main checkout; Vite realpaths
// those before enforcing server.fs.allow. Whitelist the real locations.
const real = (p: string): string | null => {
  try {
    return fs.realpathSync(p)
  } catch {
    return null
  }
}

const fsAllow = [
  ...new Set(
    [
      path.resolve(__dirname, '..'),
      real(path.resolve(__dirname, 'node_modules')),
      real(path.resolve(__dirname, '../../node_modules'))
    ].filter((p): p is string => p !== null)
  )
]

// The dev-only render/state churn counters (apps/desktop/src/debug) must be
// imported STATICALLY above react-dom; alias the whole graph out of normal
// web-dev and production builds. The upstream diagnostics depend on `bippy`,
// which is intentionally not part of this wrapper's dependency set. Opt into
// that graph explicitly with VITE_PERF_PROBE=1 when it is available.
const debugEntry = (env: Record<string, string>) =>
  env.VITE_PERF_PROBE === '1'
    ? path.resolve(__dirname, '../desktop/src/debug/dev-only.ts')
    : path.resolve(__dirname, '../desktop/src/debug/dev-only.noop.ts')

// The emoji picker fetches emojibase JSON at runtime; serve the bundled
// emojibase-data package at a stable local path (same as desktop).
const emojibaseDir =
  real(path.resolve(__dirname, 'node_modules/emojibase-data')) ??
  real(path.resolve(__dirname, '../../node_modules/emojibase-data'))

const EMOJIBASE_PATH = /^[a-z-]+\/(data|messages|shortcodes\/emojibase)\.json$/

const emojibaseAssets = () => ({
  name: 'hermes:emojibase-assets',
  configureServer(server: {
    middlewares: { use: (route: string, handler: (req: any, res: any, next: () => void) => void) => void }
  }) {
    server.middlewares.use('/emojibase', (req, res, next) => {
      const rel = (req.url ?? '').split('?')[0].replace(/^\/+/, '')
      if (!emojibaseDir || !EMOJIBASE_PATH.test(rel)) return next()
      fs.readFile(path.join(emojibaseDir, rel), (err: unknown, buf: Buffer) => {
        if (err) return next()
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
        res.end(buf)
      })
    })
  },
  generateBundle(this: { emitFile: (asset: { type: 'asset'; fileName: string; source: Uint8Array }) => void }) {
    if (!emojibaseDir) return
    for (const rel of ['en/data.json', 'en/messages.json', 'en/shortcodes/emojibase.json']) {
      this.emitFile({
        type: 'asset',
        fileName: `emojibase/${rel}`,
        source: fs.readFileSync(path.join(emojibaseDir, rel))
      })
    }
  }
})

// The web bridge lists and loads installed desktop plugins at runtime from
// the Hermes home dir; serve both plugin roots over HTTP (dev + preview).
// HERMES_HOME overrides the default ~/.hermes location.
const hermesHome = process.env.HERMES_HOME ?? path.join(os.homedir(), '.hermes')

// Shared structural type for the dev AND preview middleware servers.
interface PluginsServerLike {
  middlewares: { use: (route: string, handler: (req: any, res: any, next: () => void) => void) => void }
}

const hermesPluginsAssets = () => {
  const roots = [
    { prefix: '/desktop-plugins', dir: path.join(hermesHome, 'desktop-plugins') },
    { prefix: '/plugins', dir: path.join(hermesHome, 'plugins') }
  ]

  const attach = (server: PluginsServerLike): void => {
    for (const { prefix, dir } of roots) {
      server.middlewares.use(prefix, (req, res, next) => {
        const rel = (req.url ?? '').split('?')[0].replace(/^\/+/, '')

        if (rel === '.listing') {
          // Shape matches production: nginx.conf.template serves this same
          // endpoint via its built-in autoindex (JSON format), which emits
          // {name,type} objects rather than bare name strings — see the
          // `readDir` bridge code in web-bridge/bridge.ts.
          fs.readdir(dir, { withFileTypes: true }, (err: unknown, entries) => {
            if (err) {
              res.setHeader('Content-Type', 'application/json')
              res.end('[]')
              return
            }
            res.setHeader('Content-Type', 'application/json')
            res.end(
              JSON.stringify(
                entries.filter(e => e.isDirectory()).map(e => ({ name: e.name, type: 'directory' }))
              )
            )
          })
          return
        }

        const normalized = path.normalize(rel)

        if (!rel || normalized.startsWith('..') || path.isAbsolute(normalized)) {
          res.statusCode = 404
          res.end('not found')
          return
        }
        const file = path.join(dir, normalized)

        if (!file.startsWith(`${dir}${path.sep}`)) {
          res.statusCode = 403
          res.end('forbidden')
          return
        }
        fs.readFile(file, (err: unknown, buf: Buffer) => {
          if (err) {
            res.statusCode = 404
            res.end('not found')
            return
          }
          res.setHeader('Cache-Control', 'no-store')
          res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : 'application/octet-stream')
          res.end(buf)
        })
      })
    }
  }

  return {
    name: 'hermes:plugins-assets',
    configureServer(server: PluginsServerLike) {
      attach(server)
    },
    configurePreviewServer(server: PluginsServerLike) {
      attach(server)
    }
  }
}

// Bot Mode can request the same canonical chat from both the row click and its
// roster activity refresh. The renderer intentionally supersedes an older
// session open, so let those same-bot requests share one promise instead of
// turning the expected cancellation into a visible error. Different bots keep
// the renderer's normal latest-selection cancellation behavior.
const hermesBotOpenRaceFix = (): Plugin => ({
  name: 'hermes:bot-open-race-fix',
  transform(code, id) {
    const normalizedId = id.replaceAll('\\', '/').split('?')[0]

    if (normalizedId.endsWith('/apps/desktop/src/sdk/index.ts') || normalizedId.endsWith('/desktop/src/sdk/index.ts')) {
      const retryableMarker = code.indexOf('const retryable')
      const throwError = retryableMarker < 0 ? -1 : code.indexOf('throw error', retryableMarker)
      const patched =
        throwError < 0
          ? code
          : `${code.slice(0, throwError)}if (options.workspaceMode === 'bots' && error instanceof Error && error.message === 'Session open was superseded by a newer selection.') {\n              return\n            }\n            ${code.slice(throwError)}`

      const webPatched = patched.replace(
        /if \(!openingStillCurrent\(\)\) \{/g,
        "if (!openingStillCurrent() && !(window.__HERMES_WEB_BRIDGE__ && options.workspaceMode === 'bots')) {"
      )

      if (patched === code) {
        throw new Error('Bot Mode cancellation override no longer matches the SDK source')
      }

      return { code: webPatched, map: null }
    }

    if (
      normalizedId.endsWith('/apps/desktop/src/store/gateway.ts') ||
      normalizedId.endsWith('/desktop/src/store/gateway.ts')
    ) {
      const agentStart = code.indexOf('export async function ensureGatewayForAgent')
      const scopeMarker = 'const scope = registryBackendScopeKey(connectionId, profile)'
      const scopeMarkerStart = agentStart < 0 ? -1 : code.indexOf(scopeMarker, agentStart)
      const agentPatched =
        scopeMarkerStart < 0
          ? code
          : `${code.slice(0, scopeMarkerStart + scopeMarker.length)}
  if (window.__HERMES_WEB_BRIDGE__) {
    return !signal?.aborted
  }
${code.slice(scopeMarkerStart + scopeMarker.length)}`

      if (agentStart < 0 || scopeMarkerStart < 0) {
        throw new Error('Web agent activation fast path no longer matches the renderer source')
      }

      const patched = agentPatched.replace(
        /async function sharedPrimaryRoute[\s\S]*?\{/,
        `$&
  if (window.__HERMES_WEB_BRIDGE__) {
    return true
  }`
      )

      if (patched === agentPatched) {
        throw new Error('Web shared-primary route no longer matches the renderer source')
      }

      return { code: patched, map: null }
    }

    if (
      normalizedId.endsWith('/apps/desktop/src/store/profile.ts') ||
      normalizedId.endsWith('/desktop/src/store/profile.ts')
    ) {
      const selectStart = code.indexOf('function selectProfile')
      const targetMarker = 'const target = normalizeProfileKey(name)'
      const targetStart = selectStart < 0 ? -1 : code.indexOf(targetMarker, selectStart)
      const targetEnd = targetStart < 0 ? -1 : targetStart + targetMarker.length
      const patched =
        targetStart < 0
          ? code
          : `${code.slice(0, targetEnd)}
  if (window.__HERMES_WEB_BRIDGE__) {
    window.__HERMES_WEB_ACTIVE_PROFILE__ = target
    $activeGatewayProfile.set(target)
    return
  }
${code.slice(targetEnd)}`

      if (selectStart < 0 || targetStart < 0) {
        if (code.includes('__HERMES_WEB_ACTIVE_PROFILE__ = target')) {
          return { code, map: null }
        }

        throw new Error('Web profile selection scope no longer matches the renderer source')
      }

      return { code: patched, map: null }
    }

    if (
      normalizedId.endsWith('/apps/desktop/src/plugins/hermes-bots/roster-actions.ts') ||
      normalizedId.endsWith('/desktop/src/plugins/hermes-bots/roster-actions.ts')
    ) {
      const withoutStaleFront = code.replace(/const fronted = focusExistingBotTab\(bot\)/, 'const fronted = null')
      const notifyStart = withoutStaleFront.lastIndexOf('notifyBotOpenFailure(error, bot,')
      const lineStart = notifyStart < 0 ? -1 : withoutStaleFront.lastIndexOf('\n', notifyStart) + 1
      const patched =
        lineStart < 0
          ? withoutStaleFront
          : `${withoutStaleFront.slice(0, lineStart)}      if (error instanceof Error && error.message === 'Session open was superseded by a newer selection.') {
        return false
      }

${withoutStaleFront.slice(lineStart)}`

      return { code: patched, map: null }
    }

    if (
      normalizedId.endsWith('/apps/desktop/src/app/session/hooks/use-session-list-actions.ts') ||
      normalizedId.endsWith('/desktop/src/app/session/hooks/use-session-list-actions.ts')
    ) {
      const patched = code
        .replaceAll(
          'sidebarProfileForScope(profileScopeRef.current)',
          "sidebarProfileForScope(window.__HERMES_WEB_BRIDGE__ ? (window.__HERMES_WEB_ACTIVE_PROFILE__ ?? profileScopeRef.current) : profileScopeRef.current)"
        )
        .replaceAll(
          'sidebarProfileForScope(profileScope)',
          "sidebarProfileForScope(window.__HERMES_WEB_BRIDGE__ ? (window.__HERMES_WEB_ACTIVE_PROFILE__ ?? profileScope) : profileScope)"
        )
        .replaceAll(
          'gatewayActivationEpoch() !== activationEpoch',
          '!window.__HERMES_WEB_BRIDGE__ && gatewayActivationEpoch() !== activationEpoch'
        )
        .replaceAll(
          'gatewayActivationEpoch() === activationEpoch',
          '(window.__HERMES_WEB_BRIDGE__ || gatewayActivationEpoch() === activationEpoch)'
        )
      const refreshed = patched.replace(
          /const loadMoreSessions\s*=\s*useCallback\(async\s*\(\)\s*=>\s*\{/,
          `  useEffect(() => {
    if (window.__HERMES_WEB_BRIDGE__) {
      void refreshSessions().catch(() => undefined)
    }
  }, [profileScope, refreshSessions])

  const loadMoreSessions = useCallback(async () => {`
      )

      if (refreshed === patched) {
        throw new Error('Web profile session refresh hook no longer matches the renderer source')
      }

      return { code: refreshed, map: null }
    }

    if (
      !normalizedId.endsWith('/apps/desktop/src/plugins/hermes-bots/canonical-chat.ts') &&
      !normalizedId.endsWith('/desktop/src/plugins/hermes-bots/canonical-chat.ts')
    ) {
      return null
    }

    // The desktop shell activates a profile-scoped agent before Bot Mode RPCs.
    // The web bridge already rides one shared gateway socket, so that extra
    // registry activation can create a second, non-landing socket and leave
    // the click waiting forever. Keep the web path on the shared socket.
    const botCode = code.replace(
      /if \(!route && typeof host\.ensureAgent === ['"]function['"]\) \{/,
      'if (false) {'
    )
    const webScopedBotCode = botCode.replace(
      /const \{ bot, name, route \} = botOwner\(owner\);?\s+const ownerKey = botWorkspaceOwnerKey\(bot\);?/,
      `let { bot, name, route } = botOwner(owner)
  if (window.__HERMES_WEB_BRIDGE__ && !route) {
    route = { connectionId: 'web-single', mode: 'remote', profile: name, targetProfile: name }
  }
  const ownerKey = botWorkspaceOwnerKey(bot)`
    )

    if (webScopedBotCode === botCode) {
      throw new Error('Bot Mode web owner route no longer matches the renderer source')
    }
    const webCanonicalLookup = webScopedBotCode
      .replace(
        'awaitHydration: true,',
        'awaitHydration: window.__HERMES_WEB_BRIDGE__ ? false : true,'
      )
      .replace(
        /res = await requestForBot\(bot, ['"]session\.list['"], \{\s*profile: backendTargetProfile\(route, name\),\s*title: CANONICAL_CHAT_TITLE,\s*limit: PROFILE_SESSION_LIST_LIMIT,\s*include_hidden: true\s*\}\)/,
        `res = await (async () => {
          const desktop = typeof window !== 'undefined' ? window.hermesDesktop : null
          const api = desktop?.api

          if (window.__HERMES_WEB_BRIDGE__ && bot?.canonical_session?.id) {
            return {
              sessions: [{
                ...bot.canonical_session,
                title: CANONICAL_CHAT_TITLE
              }]
            }
          }

          if (window.__HERMES_WEB_BRIDGE__ && typeof api === 'function') {
            const response = await api({
              path: '/api/profiles/sessions?limit=200&offset=0&min_messages=0&archived=exclude&order=created&include_hidden=true&title=Bot%20Chat',
              profile: backendTargetProfile(route, name)
            })

            return Array.isArray(response) ? { sessions: response } : response
          }

          return requestForBot(bot, 'session.list', {
            profile: backendTargetProfile(route, name),
            title: CANONICAL_CHAT_TITLE,
            limit: PROFILE_SESSION_LIST_LIMIT,
            include_hidden: true
          })
        })()`
      )
    const startMatch = /(?:export\s+)?async function openBotCanonicalChat\s*\(/.exec(webCanonicalLookup)
    const start = startMatch?.index ?? -1
    const end = start < 0 ? -1 : webCanonicalLookup.slice(start).search(/(?:export\s+)?async function prepareBotSource/) + start
    if (start < 0 || end < start) {
      return null
    }

    const functionSource = webCanonicalLookup
      .slice(start, end)
      .replace(/(?:export\s+)?async function openBotCanonicalChat\s*\(/, 'async function openBotCanonicalChatImpl(')
    const wrapper = `${functionSource}\n\nexport async function openBotCanonicalChat(owner, openingStillCurrent = null) {\n  const { key } = botOwner(owner)\n  const pending = canonicalChatOpens.get(key)\n\n  if (pending) {\n    return pending\n  }\n\n  const run = openBotCanonicalChatImpl(owner, null)\n  canonicalChatOpens.set(key, run)\n  const clear = () => {\n    if (canonicalChatOpens.get(key) === run) {\n      canonicalChatOpens.delete(key)\n    }\n  }\n  run.then(clear, clear)\n\n  return run\n}\n`
    const transformed = `${webCanonicalLookup.slice(0, start)}const canonicalChatOpens = new Map()\n\n${wrapper}${webCanonicalLookup.slice(end)}`

    const guarded = transformed.replace(
      `  if (pending) {
    return pending
  }`,
      `  if (pending) {
    try {
      return await pending
    } catch (error) {
      const current = typeof openingStillCurrent === 'function' && openingStillCurrent()
      const superseded = /superseded by a newer selection/i.test(String(error?.message || error))

      if (!current || !superseded) {
        throw error
      }
    }
  }`
    )

    const retried = guarded.replace(
      `  const run = openBotCanonicalChatImpl(owner, null)
  canonicalChatOpens.set(key, run)`,
      `  const run = openBotCanonicalChatImpl(owner, null).catch(async error => {
    const superseded = /superseded by a newer selection/i.test(String(error?.message || error))

    if (!superseded) {
      throw error
    }

    return openBotCanonicalChatImpl(owner, null)
  })
  canonicalChatOpens.set(key, run)`
    )

    if (retried === guarded) {
      throw new Error('Bot Mode open-race guard no longer matches the generated wrapper')
    }

    if (retried === code) {
      throw new Error('Bot Mode open-race override no longer matches the renderer source')
    }

    return { code: retried, map: null }
  }
})

// --- Dynamic dev proxy (ported from hermes-ui, MIT) --------------------------
let GATEWAY = process.env.HERMES_GATEWAY_URL ?? 'http://127.0.0.1:9119'

// Optional repo-root config.json (git-ignored) whose `gateways` array whitelists
// additional gateway URLs for the dev proxy.
function readLocalConfig(): { gateways?: unknown } | null {
  const file = path.resolve(__dirname, '..', '..', 'config.json')

  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`[hermes] ignoring unreadable config.json: ${(error as Error).message}`)
    }

    return null
  }
}

function configGatewayUrls(config: { gateways?: unknown } | null): string[] {
  const raw = config?.gateways

  if (!Array.isArray(raw)) {return []}

  return raw
    .map(entry => (typeof entry === 'string' ? entry : (entry as { url?: unknown })?.url))
    .filter((url): url is string => typeof url === 'string' && url.trim() !== '')
    .map(url => url.trim())
}

function envGatewayUrls(): string[] {
  return (process.env.HERMES_GATEWAY_WHITELIST ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
}

const LOCAL_CONFIG = readLocalConfig()

let TARGETS = new Map<string, string>()
let GATEWAY_WHITELIST: string[] = []
let DEFAULT_TARGET = 'http://127.0.0.1:9119'

function configureGateway(gateway: string | undefined, extraGateways: string[] = []): void {
  GATEWAY = gateway ?? 'http://127.0.0.1:9119'
  TARGETS = new Map<string, string>()

  for (const url of [GATEWAY, ...configGatewayUrls(LOCAL_CONFIG), ...envGatewayUrls(), ...extraGateways]) {
    try {
      const origin = new URL(url).origin

      if (!TARGETS.has(origin)) {TARGETS.set(origin, url)}
    } catch {
      // skip non-absolute / unparseable entries
    }
  }

  GATEWAY_WHITELIST = [...TARGETS.keys()]

  try {
    new URL(GATEWAY)
    DEFAULT_TARGET = GATEWAY
  } catch {
    DEFAULT_TARGET = 'http://127.0.0.1:9119'
  }
}

configureGateway(GATEWAY)

const PROXY_PREFIXES = ['/api', '/auth', '/login']
const ROUTE_COOKIE = 'hermes_dev_gateway'
const ROUTE_PARAM = '__hgw'
const TARGET_ORIGIN = Symbol('hermesTargetOrigin')

function matchesPrefix(url: string | undefined): boolean {
  if (!url) {return false}

  return PROXY_PREFIXES.some(p => url === p || url.startsWith(`${p}/`) || url.startsWith(`${p}?`))
}

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) {return undefined}

  for (const part of header.split(';')) {
    const eq = part.indexOf('=')

    if (eq === -1) {continue}

    if (part.slice(0, eq).trim() === name) {return decodeURIComponent(part.slice(eq + 1).trim())}
  }

  return undefined
}

function validOrigin(raw: null | string | undefined): string | undefined {
  if (!raw) {return undefined}

  try {
    const origin = new URL(raw).origin

    return TARGETS.has(origin) ? origin : undefined
  } catch {
    return undefined
  }
}

function resolveOrigin(req: IncomingMessage): string {
  const parsed = req.url ? new URL(req.url, 'http://x') : null

  return (
    validOrigin(parsed?.searchParams.get(ROUTE_PARAM)) ??
    validOrigin(readCookie(req.headers.cookie, ROUTE_COOKIE)) ??
    new URL(DEFAULT_TARGET).origin
  )
}

function targetTag(origin: string): string {
  return crypto.createHash('sha256').update(origin).digest('hex').slice(0, 8)
}

function rewriteCookieHeader(header: string | undefined, tag: string): string | undefined {
  if (!header) {return undefined}

  const suffix = `__hg_${tag}`
  const kept: string[] = []

  for (const part of header.split(';')) {
    const eq = part.indexOf('=')

    if (eq === -1) {continue}
    const name = part.slice(0, eq).trim()

    if (name === ROUTE_COOKIE) {continue}

    if (name.endsWith(suffix)) {kept.push(`${name.slice(0, -suffix.length)}=${part.slice(eq + 1).trim()}`)}
  }

  return kept.length ? kept.join('; ') : undefined
}

function namespaceSetCookie(cookie: string, tag: string): string {
  const segments = cookie.split(';')
  const first = segments[0]
  const eq = first.indexOf('=')

  if (eq === -1) {return cookie}
  const name = first.slice(0, eq).trim()
  const value = first.slice(eq + 1)
  const attrs = segments.slice(1).filter(s => !/^\s*domain=/i.test(s))

  return [`${name}__hg_${tag}=${value}`, ...attrs].join(';')
}

function stripRouteParam(req: IncomingMessage): void {
  if (!req.url || !req.url.includes(ROUTE_PARAM)) {return}
  const u = new URL(req.url, 'http://x')
  u.searchParams.delete(ROUTE_PARAM)
  req.url = u.pathname + u.search
}

// Shared wiring for the dev AND preview servers (preview serves the built
// dist — the production bundle — which still needs same-origin /api routing).
interface ProxyServerLike {
  middlewares: PreviewServer['middlewares']
  httpServer?: PreviewServer['httpServer'] | null
  config: PreviewServer['config']
}

function attachDynamicProxy(server: ProxyServerLike): void {
  const proxy: ProxyServer = createProxyServer({ changeOrigin: false, secure: false, ws: true })

  proxy.on('proxyRes', (proxyRes, req) => {
    const setCookie = proxyRes.headers['set-cookie']

    if (!setCookie) {return}
    const origin = (req as unknown as Record<symbol, string>)[TARGET_ORIGIN]

    if (!origin) {return}
    const tag = targetTag(origin)
    proxyRes.headers['set-cookie'] = setCookie.map(c => namespaceSetCookie(c, tag))
  })

  proxy.on('error', (err, _req, resOrSocket) => {
    server.config.logger.error(`[hermes-proxy] ${err.message}`, { timestamp: true })

    if (resOrSocket && 'writeHead' in resOrSocket) {
      const res = resOrSocket as ServerResponse

      if (!res.headersSent) {res.writeHead(502, { 'content-type': 'text/plain' })}
      res.end('gateway proxy error')
    } else if (resOrSocket) {
      ;(resOrSocket as Socket).destroy()
    }
  })

  const route = (req: IncomingMessage): string => {
    const origin = resolveOrigin(req)
    const cookie = rewriteCookieHeader(req.headers.cookie, targetTag(origin))

    if (cookie === undefined) {
      delete req.headers.cookie
    } else {
      req.headers.cookie = cookie
    }
    stripRouteParam(req)
    ;(req as unknown as Record<symbol, string>)[TARGET_ORIGIN] = origin

    return TARGETS.get(origin) ?? DEFAULT_TARGET
  }

  server.middlewares.use((req, res, next) => {
    // Serve runtime config from the same proxy in both dev and preview.
    // Preview does not run transformIndexHtml, and an injected head script in
    // dev was overwritten by the public gateway-config.js loaded after it.
    if (req.url?.split('?')[0] === '/gateway-config.js') {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
      res.setHeader('Cache-Control', 'no-store')
      res.end(`window.__HERMES_GATEWAY_WHITELIST__ = ${JSON.stringify(GATEWAY_WHITELIST).replace(/</g, '\\u003c')};\n`)

      return
    }

    if (!matchesPrefix(req.url)) {return next()}
    proxy.web(req, res, { target: route(req) })
  })

  server.httpServer?.on('upgrade', (req, socket, head) => {
    if (!req.url || !req.url.startsWith('/api')) {return}
    proxy.ws(req, socket, head, { target: route(req) })
  })
}

function hermesDynamicProxy(): Plugin {
  return {
    name: 'hermes-dev-dynamic-proxy',
    configureServer(server) {
      attachDynamicProxy(server)
    },
    configurePreviewServer(server) {
      attachDynamicProxy(server)
    }
  }
}

export default defineConfig(({ command, mode }) => {
  // Extra hostnames allowed past Vite's Host check, from apps/web-desktop/.env
  // (WEB_ALLOWED_HOSTS, comma-separated) — e.g. Tailscale names, LAN hostnames.
  const env = loadEnv(mode, __dirname, '')
  configureGateway(
    process.env.HERMES_GATEWAY_URL ?? env.HERMES_GATEWAY_URL,
    (process.env.HERMES_GATEWAY_WHITELIST ?? env.HERMES_GATEWAY_WHITELIST ?? '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
  )
  const envAllowedHosts = (env.WEB_ALLOWED_HOSTS ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)

  return {
  base: './',
  plugins: [
    buildInfoPlugin(),
    hermesDynamicProxy(),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // We register the SW ourselves from src/pwa/register.ts.
      injectRegister: null,
      manifest: {
        name: 'Hermes',
        short_name: 'Hermes',
        description: 'A UI for the Hermes agent.',
        display: 'standalone',
        // Hash-routed SPA at the domain root.
        start_url: '.',
        scope: '.',
        background_color: '#111111',
        theme_color: '#0a0a0a',
        icons: [
          { src: 'hermes.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'hermes.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'hermes.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        // Add click/focus handling to service-worker notifications while
        // keeping the normal generated Workbox precache behavior.
        importScripts: ['notifications-sw.js'],
        // Precache the whole app shell; the largest chunk (shiki) is ~19 MB,
        // so keep the per-file cap generous.
        globPatterns: ['**/*.{js,css,html,woff,woff2,ttf,otf,eot,png,jpg,jpeg,svg,gif,webp,ico}'],
        // Generated by the running proxy/container, not by the frontend build.
        // Precaching the empty build-time file hides the configured gateway.
        globIgnores: ['**/gateway-config.js'],
        maximumFileSizeToCacheInBytes: 32 * 1024 * 1024,
        navigateFallback: 'index.html',
        // Never hijack the gateway: /api (REST + WS upgrade), /auth, /login
        // must always hit the network.
        navigateFallbackDenylist: [/^\/api/, /^\/auth/, /^\/login/]
      },
      devOptions: {
        // Keep the SW off in dev so it can't shadow the Vite proxy.
        enabled: false
      }
    }),
    emojibaseAssets(),
    hermesPluginsAssets(),
    hermesBotOpenRaceFix()
  ],
  css: {
    postcss: { plugins: [] }
  },
  build: {
    chunkSizeWarningLimit: 25000,
    rolldownOptions: {
      output: {
        advancedChunks: {
          groups: [
            { name: 'vendor-react', test: /node_modules[\\/](react|react-dom|scheduler|react-router)[\\/]/ },
            {
              name: 'vendor-md',
              test: /node_modules[\\/](property-information|hast-util-[^\\/]+|mdast-util-[^\\/]+|micromark[^\\/]*|unist-util-[^\\/]+|vfile[^\\/]*|unified|stringify-entities|space-separated-tokens|comma-separated-tokens|zwitch|html-void-elements|devlop|style-to-js|style-to-object|clsx)[\\/]/
            },
            {
              name: 'vendor-util',
              test: /node_modules[\\/](lodash-es|es-toolkit|uuid|dayjs|d3-array|d3-color|d3-force|d3-interpolate|d3-time[^\\/]*|dompurify|stylis)[\\/]/
            },
            {
              name: 'mermaid',
              test: /node_modules[\\/](mermaid|cytoscape|dagre|khroma|elkjs|d3|d3-[^\\/]+|@mermaid-js)[\\/]/
            },
            {
              name: 'shiki',
              test: /node_modules[\\/](shiki|@shikijs|react-shiki|@streamdown[\\/]code|oniguruma-to-es|oniguruma-parser|regex(-[^\\/]+)?)[\\/]/
            },
            { name: 'katex', test: /node_modules[\\/]katex[\\/]/ }
          ]
        }
      }
    }
  },
  resolve: {
    // The renderer sources are SYMLINKED from the pinned nix input in dev
    // (nix develop); realpathing them would make Vite look for node_modules
    // under the read-only store path and fail to resolve bare imports.
    preserveSymlinks: true,
    alias: [
      { find: '@/debug/dev-only', replacement: debugEntry(process.env as Record<string, string>) },
      {
        find: '@/store/titlebar-app-actions',
        replacement: path.resolve(__dirname, 'src/overrides/titlebar-app-actions.ts')
      },
      { find: '@hermes/plugin-sdk', replacement: path.resolve(__dirname, '../desktop/src/sdk/index.ts') },
      { find: '@hermes/shared/billing', replacement: path.resolve(__dirname, '../shared/src/billing-types.ts') },
      { find: '@hermes/shared', replacement: path.resolve(__dirname, '../shared/src') },
      { find: '@', replacement: path.resolve(__dirname, '../desktop/src') },
      {
        find: 'react/jsx-dev-runtime',
        replacement: path.resolve(__dirname, '../../node_modules/react/jsx-dev-runtime.js')
      },
      {
        find: 'react/jsx-runtime',
        replacement: path.resolve(__dirname, '../../node_modules/react/jsx-runtime.js')
      },
      {
        find: 'react-dom',
        replacement: path.resolve(__dirname, '../../node_modules/react-dom')
      },
      {
        find: 'react',
        replacement: path.resolve(__dirname, '../../node_modules/react')
      },
      // driver.js's exports field doesn't expose the .iife subpath that
      // preview-tour.ts fetches (as ?raw) for the guest-page tour engine; alias
      // it straight to the on-disk file so the web build resolves it.
      {
        find: /^driver\.js\/dist\/driver\.js\.iife\.js(\?raw)?$/,
        // Keep the ?raw query ($1) so the file is imported as raw text (the
        // guest-page tour injects the IIFE payload), not parsed as a module.
        replacement:
          path.resolve(
            __dirname,
            '../../node_modules/driver.js/dist/driver.js.iife.js'
          ) + '$1'
      }
    ],
    dedupe: ['react', 'react-dom', 'react-router']
  },
  server: {
    host: '0.0.0.0',
    port: 5174,
    strictPort: true,
    allowedHosts: [...envAllowedHosts, 'prod-server', 'hermes-web.emu-nessie.ts.net', '.ts.net'],
    fs: {
      allow: fsAllow
    }
  },
  preview: {
    host: '0.0.0.0',
    port: 4174
  }
  }
})
