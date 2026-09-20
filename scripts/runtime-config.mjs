import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const proxyRoutes = ['/api', '/auth', '/login']
export function matchesGatewayRoute(url) {
  const pathname = new URL(url || '/', 'http://local.invalid').pathname
  return proxyRoutes.some(prefix => pathname === prefix || pathname.startsWith(prefix + '/'))
}

export function runtimeConfiguration(env = process.env) {
  const url = new URL(env.HERMES_GATEWAY_URL || 'http://127.0.0.1:9119')
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('HERMES_GATEWAY_URL must be an HTTP(S) origin without credentials, a path, query, or fragment')
  }
  const home = env.HERMES_HOME || '/data/hermes'
  const staticRoot = env.HERMES_STATIC_ROOT || '/usr/share/nginx/html'
  const stateDir = env.HERMES_STATE_DIR || '/tmp/hermes-nginx'
  for (const value of [home, staticRoot, stateDir]) {
    if (!path.isAbsolute(value) || /[\r\n\0"$\\]/.test(value)) throw new Error('Hosting paths must be absolute without control characters, quotes, dollars, or backslashes')
  }
  const port = Number(env.HERMES_PORT || '80')
  const host = env.HERMES_BIND || '0.0.0.0'
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !/^(?:localhost|[0-9a-fA-F:.]+)$/.test(host)) throw new Error('Invalid hosting bind address or port')
  const listen = `${host.includes(':') ? '[' + host + ']' : host}:${port}`
  const target = url.origin
  return {
    target, home, staticRoot, stateDir, listen,
    publicConfig: {
      version: 1,
      gateway: {
        id: createHash('sha256').update(target).digest('hex'),
        name: env.HERMES_GATEWAY_NAME || 'Hermes',
        legacyUrls: [target]
      },
      capabilities: { gatewaySelection: false, pluginAssets: true }
    }
  }
}

export function runtimeScripts(configuration) {
  const json = value => JSON.stringify(value).replace(/</g, '\\u003c')
  return {
    'runtime-config.js': `window.__HERMES_RUNTIME_CONFIG__ = ${json(configuration.publicConfig)};\n`,
    'gateway-config.js': `window.__HERMES_GATEWAY_WHITELIST__ = ${json([configuration.target])};\n`
  }
}

export function renderNginx(template, configuration) {
  const routes = proxyRoutes.map(prefix => `${prefix}(?:/|$)`).join('|')
  return template.replaceAll('${HERMES_GATEWAY_URL}', configuration.target)
    .replaceAll('${HERMES_HOME}', configuration.home)
    .replaceAll('${HERMES_STATIC_ROOT}', configuration.staticRoot)
    .replaceAll('${HERMES_STATE_DIR}', configuration.stateDir)
    .replaceAll('${HERMES_LISTEN}', configuration.listen)
    .replaceAll('${HERMES_PROXY_ROUTES}', routes)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const configuration = runtimeConfiguration()
    mkdirSync(configuration.stateDir, { recursive: true })
    const destination = process.env.HERMES_STATIC_ROOT || '/usr/share/nginx/html'
    for (const [name, source] of Object.entries(runtimeScripts(configuration))) writeFileSync(path.join(destination, name), source)
    writeFileSync(process.env.HERMES_NGINX_CONFIG || '/etc/nginx/nginx.conf', renderNginx(readFileSync(process.env.HERMES_NGINX_TEMPLATE || '/etc/nginx/hermes.conf.template', 'utf8'), configuration))
    for (const name of ['plugins', 'desktop-plugins']) {
      try { mkdirSync(path.join(configuration.home, name), { recursive: true }) } catch { /* Read-only plugin mounts are supported. */ }
    }
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
