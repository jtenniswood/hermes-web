import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer as createHttpServer, request } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { createServer, preview } from 'vite'
import ts from 'typescript'

const root = fileURLToPath(new URL('../', import.meta.url))

test('configured remote gateways survive page startup in dev and preview', async t => {
  const gateway = createHttpServer((req, res) => {
    const pathname = new URL(req.url, 'http://gateway.test').pathname
    if (pathname === '/login') { res.setHeader('Set-Cookie', 'session=fixture; Path=/; HttpOnly; SameSite=Lax'); res.end('sign-in'); return }
    if (pathname === '/auth/me') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ authenticated: req.headers.cookie === 'session=fixture' })); return }
    assert.equal(pathname, '/api/status')
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ auth_required: true, auth_providers: ['basic'] }))
  })
  gateway.listen(0, process.env.HERMES_TEST_IMAGE ? '0.0.0.0' : '127.0.0.1')
  await once(gateway, 'listening')
  gateway.on('upgrade', (req, socket) => {
    assert.equal(req.url, '/api/ws?ticket=test-ticket')
    socket.end('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n')
  })
  t.after(() => new Promise(resolve => gateway.close(resolve)))
  const target = `http://127.0.0.1:${gateway.address().port}`
  const previous = process.env.HERMES_GATEWAY_URL
  process.env.HERMES_GATEWAY_URL = target
  t.after(() => {
    if (previous === undefined) delete process.env.HERMES_GATEWAY_URL
    else process.env.HERMES_GATEWAY_URL = previous
  })

  const dist = await mkdtemp(path.join(tmpdir(), 'hermes-proxy-test-'))
  t.after(() => rm(dist, { recursive: true, force: true }))
  const home = path.join(dist, 'hermes-home')
  await mkdir(path.join(home, 'plugins/sample'), { recursive: true })
  await mkdir(path.join(home, 'desktop-plugins'), { recursive: true })
  await writeFile(path.join(home, 'plugins/sample/main.js'), 'export const fixture = true;')
  const previousHome = process.env.HERMES_HOME
  process.env.HERMES_HOME = home
  t.after(() => { if (previousHome === undefined) delete process.env.HERMES_HOME; else process.env.HERMES_HOME = previousHome })
  const fallback = await readFile(path.join(root, 'public/gateway-config.js'), 'utf8')
  await writeFile(path.join(dist, 'gateway-config.js'), fallback)
  await writeFile(path.join(dist, 'runtime-config.js'), '')
  await writeFile(path.join(dist, 'index.html'), '<script src="/gateway-config.js"></script><script src="/runtime-config.js"></script>')

  for (const mode of ['dev', 'preview', ...(process.env.HERMES_TEST_IMAGE ? ['nginx'] : [])]) {
    await t.test(mode, async t => {
      const config = {
        root,
        configFile: path.join(root, 'vite.config.ts'),
        logLevel: 'silent',
        build: { outDir: dist },
        server: { host: '127.0.0.1', port: 0, strictPort: false, preTransformRequests: false },
        preview: { host: '127.0.0.1', port: 0, strictPort: false }
      }
      let origin
      let configuredTarget = target
      if (mode === 'nginx') {
        configuredTarget = `http://host.docker.internal:${gateway.address().port}`
        const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8' }).trim()
        const id = docker('run', '-d', '--add-host', 'host.docker.internal:host-gateway', '-p', '127.0.0.1::80', '-e', `HERMES_GATEWAY_URL=${configuredTarget}`, '-v', `${home}:/data/hermes:ro`, process.env.HERMES_TEST_IMAGE)
        t.after(() => { docker('rm', '-f', id) })
        const binding = JSON.parse(docker('inspect', id))[0].NetworkSettings.Ports['80/tcp'][0]
        origin = `http://127.0.0.1:${binding.HostPort}`
        let ready = false
        for (let attempt = 0; attempt < 40; attempt++) {
          try { if ((await fetch(origin)).ok) { ready = true; break } } catch {}
          await new Promise(resolve => setTimeout(resolve, 250))
        }
        assert.ok(ready, 'nginx did not start')
      } else {
        const server = mode === 'dev' ? await createServer(config) : await preview(config)
        t.after(async () => {
          if (mode === 'dev') await server.close()
          else await new Promise(resolve => server.httpServer.close(resolve))
        })
        if (mode === 'dev') await server.listen()
        origin = `http://127.0.0.1:${server.httpServer.address().port}`
      }
      const html = await (await fetch(origin)).text()
      const context = vm.createContext({ window: {} })
      // Execute classic scripts in page order to catch the old config overwrite.
      for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
        if (match[1].includes('type="module"')) continue
        const src = /src="([^"]+)"/.exec(match[1])?.[1]
        const code = src ? await (await fetch(new URL(src, origin))).text() : match[2]
        vm.runInContext(code, context)
      }
      assert.deepEqual(Array.from(context.window.__HERMES_GATEWAY_WHITELIST__), [configuredTarget])
      assert.equal((await fetch(`${origin}/gateway-config.js?v=2`)).headers.get('cache-control'), 'no-store')

      // Exercise the browser's actual routing helpers with the served config.
      context.window.location = new URL(origin)
      context.localStorage = { getItem: () => null }
      context.document = {}
      context.URL = URL
      const runtimeSource = await readFile(path.join(root, 'src/platform/runtime.ts'), 'utf8')
      const runtimeCompiled = ts.transpileModule(runtimeSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
      context.exports = {}
      vm.runInContext(runtimeCompiled, context)
      const runtime = context.exports
      assert.equal(runtime.runtimeConfig().capabilities.gatewaySelection, false)
      assert.equal((await fetch(`${origin}/runtime-config.js`)).headers.get('cache-control'), 'no-store')
      const source = await readFile(path.join(root, 'src/web-bridge/gateways.ts'), 'utf8')
      const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
      context.exports = {}
      context.require = () => runtime
      vm.runInContext(compiled, context)
      const routing = context.exports
      assert.equal(routing.classifyGatewayReach(configuredTarget), null)
      assert.equal(routing.normalizeBase(configuredTarget), origin)
      const url = routing.withGatewayRoute(`${routing.normalizeBase(configuredTarget)}/api/status`, routing.upstreamOriginFor(configuredTarget))
      const status = await (await fetch(url)).json()
      assert.deepEqual(status, { auth_required: true, auth_providers: ['basic'] })
      assert.deepEqual(await (await fetch(`${origin}/api/status?__hgw=http://unconfigured.invalid`)).json(), status)
      const login = await fetch(`${origin}/login`)
      assert.match(login.headers.get('set-cookie'), /^session=fixture;/)
      assert.deepEqual(await (await fetch(`${origin}/auth/me`, { headers: { Cookie: 'session=fixture' } })).json(), { authenticated: true })
      const listing = await (await fetch(`${origin}/plugins/.listing`)).json()
      assert.ok(listing.some(entry => entry.name === 'sample' && entry.type === 'directory'))
      assert.equal(await (await fetch(`${origin}/plugins/sample/main.js`)).text(), 'export const fixture = true;')
      const wsUrl = routing.withGatewayRoute(`${origin}/api/ws?ticket=test-ticket`, target)
      await new Promise((resolve, reject) => {
        const upgrade = request(wsUrl, { headers: { Connection: 'Upgrade', Upgrade: 'websocket' } })
        upgrade.on('error', reject)
        upgrade.on('response', response => {
          response.resume()
          reject(new Error(`Expected WebSocket upgrade, received ${response.statusCode}`))
        })
        upgrade.on('upgrade', (response, socket) => {
          socket.destroy()
          assert.equal(response.statusCode, 101)
          resolve()
        })
        upgrade.end()
      })
      // An HTTPS page still reaches the HTTP gateway through its own proxy.
      context.window.location = new URL('https://web.example.test')
      assert.equal(routing.classifyGatewayReach(configuredTarget), null)
      assert.equal(routing.normalizeBase(configuredTarget), 'https://web.example.test')
      assert.equal(routing.classifyGatewayReach('http://unconfigured.example.test'), 'server-configured')
    })
  }
})
