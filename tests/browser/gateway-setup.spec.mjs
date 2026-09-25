import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { createPreviewGateway } from '../../scripts/preview/gateway.mjs'
import { getBrowserTarget } from './test-target.mjs'

const { image, url } = getBrowserTarget()
test.skip(!image && !url && !process.env.CI, 'Set HERMES_TEST_IMAGE or HERMES_BROWSER_PREVIEW_URL')
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
let gateway, container, origin

test.beforeAll(async () => {
  if (url) { origin = url; return }
  if (!image) throw new Error('HERMES_TEST_IMAGE is required in CI')
  gateway = createPreviewGateway()
  await new Promise(resolve => gateway.server.listen(0, '0.0.0.0', resolve))
  container = execFileSync('docker', ['run', '-d', '--rm', '--add-host', 'host.docker.internal:host-gateway', '-p', '127.0.0.1::80', '-e', `HERMES_GATEWAY_URL=http://host.docker.internal:${gateway.server.address().port}`, image], { encoding: 'utf8' }).trim()
  const port = execFileSync('docker', ['port', container, '80/tcp'], { encoding: 'utf8' }).trim().split(':').at(-1)
  origin = `http://127.0.0.1:${port}`
  await expect.poll(async () => { try { return (await fetch(origin)).status } catch { return 0 } }).toBe(200)
})
test.afterAll(async () => {
  if (container) execFileSync('docker', ['stop', container], { stdio: 'ignore' })
  await gateway?.close()
})

for (const scale of [100, 125, 150]) {
  test(`remote gateway sign-in stays reachable with the keyboard at ${scale}% scale`, async ({ page, context }, testInfo) => {
    await page.addInitScript(() => {
      const viewport = window.visualViewport
      const state = { height: 844, offsetTop: 0 }
      for (const key of Object.keys(state)) Object.defineProperty(viewport, key, { get: () => state[key] })
      window.setGatewayTestViewport = next => {
        Object.assign(state, next)
        viewport.dispatchEvent(new Event('resize'))
      }
    })
    // Expired authentication must expose the real boot-recovery form.
    await page.route('**/api/auth/ws-ticket', route => route.fulfill({ status: 401, body: 'Sign in required' }))
    await page.route('**/api/auth/me', route => route.fulfill({ status: 401 }))
    await page.route('**/api/status', route => route.fulfill({ json: { auth_required: true, auth_providers: ['basic'] } }))
    await context.route('**/login', route => route.fulfill({ contentType: 'text/html', body: '<h1>Gateway sign-in</h1>' }))
    await page.goto(origin)
    await page.getByRole('button', { name: 'Gateway settings', exact: true }).click({ timeout: 30000 })
    await page.evaluate(percent => window.hermesDesktop.zoom.setPercent(percent), scale)
    const form = page.getByRole('region', { name: 'Gateway connection' })
    await expect(form.getByRole('heading', { name: 'Remote gateway', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /Use local gateway|Hermes Cloud|Connect via SSH/ })).toHaveCount(0)
    await expect(form.getByRole('textbox', { name: 'Remote URL' })).toHaveCount(0)

    const assertReachable = async (control, height, top = 0) => {
      await control.scrollIntoViewIfNeeded()
      await expect.poll(async () => {
        const box = await control.boundingBox()
        return box.y >= top && box.y + box.height <= top + height && box.x >= 0 && box.x + box.width <= page.viewportSize().width + 1
      }).toBe(true)
      expect(await control.evaluate(element => {
        const box = element.getBoundingClientRect()
        return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2))
      }), 'control is not clipped or covered').toBe(true)
    }
    await assertReachable(form.getByRole('button', { name: 'Sign in', exact: true }), 844)
    await page.screenshot({ path: testInfo.outputPath('gateway-setup-phone.png') })
    await form.getByLabel('Sign-in method').selectOption('token')
    const token = form.getByLabel('Session token', { exact: true })
    await token.fill('synthetic-session-token')
    await page.evaluate(() => window.setGatewayTestViewport({ height: 300, offsetTop: 48 }))
    await assertReachable(token, 300, 48)
    await assertReachable(form.getByRole('button', { name: 'Save and reconnect' }), 300, 48)
    await assertReachable(form.getByRole('button', { name: 'Test connection' }), 300, 48)
    await form.getByRole('button', { name: 'Test connection' }).click()
    await expect(form.getByRole('status')).toHaveText('The configured gateway is reachable.')
    await assertReachable(form.getByRole('button', { name: 'Sign out', exact: true }), 300, 48)
    await page.screenshot({ path: testInfo.outputPath('gateway-keyboard.png') })

    await form.getByLabel('Sign-in method').selectOption('oauth')
    await assertReachable(form.getByRole('button', { name: 'Sign in', exact: true }), 300, 48)
    const popupReady = page.waitForEvent('popup')
    await form.getByRole('button', { name: 'Sign in', exact: true }).click()
    const popup = await popupReady
    await expect(popup.getByRole('heading', { name: 'Gateway sign-in' })).toBeVisible()
    await popup.close()
    await expect(form.getByRole('status')).toContainText('Sign-in did not complete')

    await page.setViewportSize({ width: 844, height: 390 })
    await page.evaluate(() => window.setGatewayTestViewport({ height: 270, offsetTop: 0 }))
    await assertReachable(form.getByRole('button', { name: 'Sign in', exact: true }), 270)
    await form.getByLabel('Sign-in method').selectOption('token')
    await expect(token).toHaveValue('synthetic-session-token')
    await assertReachable(form.getByRole('button', { name: 'Save and reconnect' }), 270)
    await form.getByRole('button', { name: 'Save and reconnect' }).click()
    await expect(page.locator('[contenteditable="true"]:visible').first()).toBeVisible({ timeout: 30000 })
    expect(await page.evaluate(async () => (await window.hermesDesktop.getConnectionConfig()).remoteAuthMode)).toBe('token')
  })
}
