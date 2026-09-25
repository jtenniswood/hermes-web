import { compatibilityRegistryPlugin } from '../../scripts/compatibility-registry.mjs'
import { dependencyCompatibilityPlugin } from './src/upstream/dependency-compatibility'
import { browserPlugin, browserActivityNotificationsPlugin } from './src/upstream/browser-plugin'
import { rendererOverrides } from './src/upstream/overrides'
import { runtimeConfiguration, runtimeScripts, matchesGatewayRoute, type HostingConfiguration } from '../../scripts/runtime-config.mjs'
import { rendererAliases, compatibilityAliases, compatibilitySingletons } from '../../scripts/aliases.mjs'
import { buildInfoPlugin } from '../../scripts/build-info.mjs'
import { defineConfig, loadEnv, type Plugin, type PreviewServer } from 'vite'
import { rendererCompatibilityPlugin } from './src/upstream/transforms'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { createProxyServer, type ProxyServer } from 'http-proxy-3'
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
let hermesHome = process.env.HERMES_HOME ?? path.join(os.homedir(), '.hermes')

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

// A single configured target is shared by development, preview, and nginx.
let hosting: HostingConfiguration = runtimeConfiguration()

// Shared wiring for the dev AND preview servers (preview serves the built
// dist — the production bundle — which still needs same-origin /api routing).
interface ProxyServerLike {
  middlewares: PreviewServer['middlewares']
  httpServer?: PreviewServer['httpServer'] | null
  config: PreviewServer['config']
}

function attachDynamicProxy(server: ProxyServerLike): void {
  // Route HTTPS hostname-based gateways correctly (including Cloudflare
  // Tunnel) while retaining the app origin in forwarded metadata.
  const proxy: ProxyServer = createProxyServer({ changeOrigin: true, secure: true, ws: true })

  const preserveBrowserOrigin = (proxyReq: import('node:http').ClientRequest, req: IncomingMessage): void => {
    if (req.headers.host) {proxyReq.setHeader('X-Forwarded-Host', req.headers.host)}
    const encrypted = (req.socket as import('node:tls').TLSSocket).encrypted
    proxyReq.setHeader('X-Forwarded-Proto', req.headers['x-forwarded-proto'] ?? (encrypted ? 'https' : 'http'))
  }

  proxy.on('proxyReq', preserveBrowserOrigin)
  proxy.on('proxyReqWs', preserveBrowserOrigin)

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

  server.middlewares.use((req, res, next) => {
    const pathname = req.url?.split('?')[0]
    const scripts = runtimeScripts(hosting)
    if (pathname && Object.hasOwn(scripts, pathname.slice(1))) {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
      res.setHeader('Cache-Control', 'no-store')
      res.end(scripts[pathname.slice(1)])
      return
    }
    if (!matchesGatewayRoute(req.url)) return next()
    proxy.web(req, res, { target: hosting.target })
  })

  server.httpServer?.on('upgrade', (req, socket, head) => {
    if (!matchesGatewayRoute(req.url)) return
    proxy.ws(req, socket, head, { target: hosting.target })
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
  hosting = runtimeConfiguration({ HERMES_HOME: path.join(os.homedir(), '.hermes'), ...env, ...process.env })
  hermesHome = hosting.home
  const envAllowedHosts = (env.WEB_ALLOWED_HOSTS ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)

  // The browser shell is the only supported web entry point. Installing the
  // wrapper plugin unconditionally prevents a stale desktop build from being
  // shipped when a developer or deployment omits the legacy experience selector.
  return {
  base: './',
  plugins: [
    compatibilityRegistryPlugin(path.resolve(__dirname, '../..')),
    dependencyCompatibilityPlugin(__dirname),
    buildInfoPlugin(),
    rendererOverrides(__dirname),
    browserPlugin(__dirname),
    hermesDynamicProxy(),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
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
        importScripts: ['notifications-sw.js', 'update-coordinator-sw.js'],
        skipWaiting: false,
        clientsClaim: true,
        // Precache the whole app shell; the largest chunk (shiki) is ~19 MB,
        // so keep the per-file cap generous.
        globPatterns: ['index.html', 'hermes.png', 'assets/**/*.{js,css,woff,woff2,ttf,otf,png,svg,webp}'],
        // Generated by the running proxy/container, not by the frontend build.
        // Precaching the empty build-time file hides the configured gateway.
        globIgnores: ['**/gateway-config.js', '**/runtime-config.js', '**/build-info.json'],
        maximumFileSizeToCacheInBytes: 32 * 1024 * 1024,
        navigateFallback: 'index.html',
        // Never hijack the gateway: /api (REST + WS upgrade), /auth, /login
        // must always hit the network.
        navigateFallbackDenylist: [/^\/(?:api|auth|login|plugins)(?:\/|$)/, /^\/(?:runtime-config|gateway-config)\.js$/]
      },
      devOptions: {
        // Keep the SW off in dev so it can't shadow the Vite proxy.
        enabled: false
      }
    }),
    emojibaseAssets(),
    hermesPluginsAssets(),
    rendererCompatibilityPlugin(path.resolve(__dirname, '../desktop/src')),
    browserActivityNotificationsPlugin(__dirname)
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
      ...compatibilityAliases(__dirname).filter(alias => alias.find === '@/debug/dev-only'),
      ...rendererAliases(),
      ...compatibilityAliases(__dirname).filter(alias => alias.find !== '@/debug/dev-only')
    ],
    dedupe: compatibilitySingletons(__dirname)
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
