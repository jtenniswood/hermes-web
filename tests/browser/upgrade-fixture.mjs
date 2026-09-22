import { waitForBrowserNetwork } from './network-readiness.mjs'
import { test as base, expect } from '@playwright/test'
import { createServer, request } from 'node:http'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createPreviewGateway } from '../../scripts/preview/gateway.mjs'
import { requireBrowserImage } from './test-target.mjs'
import { installUpdateDiagnostics } from './update-diagnostics.mjs'
import { installWorkerDiagnostics } from './worker-diagnostics.mjs'

const baseline = JSON.parse(readFileSync(new URL('../fixtures/upgrade-baseline.json', import.meta.url), 'utf8'))
const docker = args => execFileSync('docker', args, { encoding: 'utf8' }).trim()

export const test = base.extend({
  // Docker adds/removes host network interfaces. Launch after both images are
  // ready, so a reused Chromium network service cannot abort the first load.
  context: async ({ upgradeApp, playwright, browserName, contextOptions, viewport }, use, testInfo) => {
    const browser = await playwright[browserName].launch({ headless: true })
    try {
      const readiness = await waitForBrowserNetwork(browser, upgradeApp.origin)
      await testInfo.attach('fixture-network-readiness', { body: JSON.stringify(readiness), contentType: 'application/json' })
      const context = await browser.newContext({ ...contextOptions, viewport })
      const workerDiagnostics = installWorkerDiagnostics(context)
      const diagnostics = await installUpdateDiagnostics(context)
      try { await use(context) } finally {
        await testInfo.attach('update-protocol', { body: JSON.stringify(diagnostics(), null, 2), contentType: 'application/json' })
        await testInfo.attach('update-workers', { body: JSON.stringify(await workerDiagnostics(), null, 2), contentType: 'application/json' })
        await context.close()
      }
    } finally { await browser.close() }
  },
  page: async ({ upgradeApp, context }, use) => {
    void upgradeApp
    const errors = []
    context.on('page', tab => tab.on('pageerror', error => errors.push(error.message)))
    const page = await context.newPage()
    await use(page)
    await page.close()
    expect(errors, 'Unhandled browser exceptions during upgrade').toEqual([])
  },
  upgradeApp: async ({}, use, testInfo) => {
    const gateway = createPreviewGateway({ strict: true, delay: 10000 })
    const containers = [], sockets = new Set()
    let servingPort, proxy
    try {
      await new Promise(resolve => gateway.server.listen(0, '0.0.0.0', resolve))
      const startImage = async (image, platform) => {
        const container = docker(['run', '-d', '--rm', ...(platform ? ['--platform', platform] : []), '--add-host', 'host.docker.internal:host-gateway', '-p', '127.0.0.1::80', '-e', `HERMES_GATEWAY_URL=http://host.docker.internal:${gateway.server.address().port}`, image])
        containers.push(container)
        const port = Number(docker(['port', container, '80/tcp']).split(':').at(-1))
        await expect.poll(async () => { try { return (await fetch(`http://127.0.0.1:${port}/build-info.json`)).status } catch { return 0 } }).toBe(200)
        const imageId = docker(['inspect', '--format', '{{.Image}}', container])
        return { reference: image, image: imageId, platform: docker(['image', 'inspect', '--format', '{{.Os}}/{{.Architecture}}', imageId]), port, build: await (await fetch(`http://127.0.0.1:${port}/build-info.json`)).json() }
      }
      const previous = await startImage(baseline.image, baseline.platform)
      const candidate = await startImage(requireBrowserImage())
      expect(previous.build.wrapperRevision).toBe(baseline.wrapperRevision)
      expect(previous.build.rendererRevision).toBe(baseline.rendererRevision)
      expect(candidate.build.wrapperRevision).toMatch(/^[a-f0-9]{40}$/)
      expect(candidate.build.rendererRevision).toMatch(/^[a-f0-9]{40}$/)
      expect(candidate.build.wrapperRevision).not.toBe(previous.build.wrapperRevision)
      expect(candidate.image).not.toBe(previous.image)
      servingPort = previous.port
      // A stable browser origin switches between the actual nginx images.
      // Existing sockets keep flowing through the previous image to the same
      // gateway, as they do during a rolling deployment.
      proxy = createServer((incoming, outgoing) => {
        const upstream = request({ hostname: '127.0.0.1', port: servingPort, path: incoming.url, method: incoming.method, headers: incoming.headers }, response => {
          outgoing.writeHead(response.statusCode, response.headers)
          response.pipe(outgoing)
        })
        upstream.on('error', error => { if (!outgoing.headersSent) outgoing.writeHead(502); outgoing.end(error.message) })
        incoming.pipe(upstream)
      })
      proxy.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
      proxy.on('upgrade', (incoming, client, head) => {
        const upstream = request({ hostname: '127.0.0.1', port: servingPort, path: incoming.url, method: incoming.method, headers: incoming.headers })
        upstream.on('upgrade', (response, socket, upstreamHead) => {
          sockets.add(socket); socket.on('close', () => sockets.delete(socket))
          client.write(`HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\n${response.rawHeaders.reduce((lines, item, index, headers) => index % 2 ? lines : `${lines}${item}: ${headers[index + 1]}\r\n`, '')}\r\n`)
          if (upstreamHead.length) client.write(upstreamHead)
          if (head.length) socket.write(head)
          client.pipe(socket).pipe(client)
          client.on('error', () => socket.destroy())
          socket.on('error', () => client.destroy())
        })
        upstream.on('response', response => { response.resume(); client.destroy() })
        upstream.on('error', () => client.destroy())
        upstream.end()
      })
      await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve))
      const origin = `http://127.0.0.1:${proxy.address().port}`
      await testInfo.attach('upgrade-image-identities', { body: JSON.stringify({ previous, candidate, gateway: 'synthetic-preview-v1', baselineVerification: baseline.verificationRun }, null, 2), contentType: 'application/json' })
      await use({ ...gateway, origin, previous, candidate, publishCandidate: () => { servingPort = candidate.port }, publishPrevious: () => { servingPort = previous.port } })
    } finally {
      gateway.controls.releaseAll()
      for (const socket of sockets) socket.destroy()
      if (proxy) await new Promise(resolve => proxy.close(resolve))
      for (const container of containers) docker(['stop', container])
      await gateway.close()
      await testInfo.attach('upgrade-gateway-operations', { body: JSON.stringify(gateway.controls.calls, (_key, value) => typeof value === 'string' && value.length > 1000 ? `${value.slice(0, 200)}…` : value), contentType: 'application/json' })
    }
    gateway.controls.assertExpected()
  }
})
