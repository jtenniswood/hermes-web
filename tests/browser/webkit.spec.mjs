import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { createPreviewGateway } from '../../scripts/preview/gateway.mjs'
import { getBrowserTarget } from './test-target.mjs'

test.describe.configure({ retries: 1, timeout: 90000 })
const { image, url } = getBrowserTarget()
test.skip(!image && !url && !process.env.CI, 'Set HERMES_TEST_IMAGE or HERMES_BROWSER_PREVIEW_URL to run browser image tests')

let gateway, container, origin

test.beforeAll(async () => {
  if (url) {
    origin = url
    return
  }
  gateway = createPreviewGateway()
  await new Promise(resolve => gateway.server.listen(0, '0.0.0.0', resolve))
  container = execFileSync('docker', ['run', '-d', '--rm', '--add-host', 'host.docker.internal:host-gateway', '-p', '127.0.0.1::80', '-e', `HERMES_GATEWAY_URL=http://host.docker.internal:${gateway.server.address().port}`, '-e', 'HERMES_GATEWAY_NAME=Preview workspace', image], { encoding: 'utf8' }).trim()
  const port = execFileSync('docker', ['port', container, '80/tcp'], { encoding: 'utf8' }).trim().split(':').at(-1)
  origin = `http://127.0.0.1:${port}`
  await expect.poll(async () => { try { return (await fetch(origin)).status } catch { return 0 } }).toBe(200)
})

test.afterAll(async () => {
  if (container) execFileSync('docker', ['stop', container], { stdio: 'ignore' })
  await gateway?.close()
})

const editor = page => page.locator('[contenteditable="true"]:visible').first()
const open = async page => {
  await page.goto(`${origin}/#/preview-week`)
  await expect(editor(page)).toBeVisible({ timeout: 30000 })
  await expect(page.getByText('Help me make a thoughtful plan.', { exact: true }).first()).toBeVisible({ timeout: 30000 })
}

test('WebKit starts cleanly and keeps drafts isolated while switching conversations', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await open(page)
  await expect(page.locator('.browser-chat-title')).toHaveCount(0)
  await editor(page).fill('session draft')
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click()
  await page.getByRole('tab', { name: 'Bots', exact: true }).click()
  await page.getByRole('button', { name: /Research · @/ }).click()
  await expect(editor(page)).toBeVisible()
  await expect(editor(page)).not.toHaveText('session draft')
  await editor(page).fill('bot draft')
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click()
  await page.getByRole('tab', { name: 'Sessions', exact: true }).click()
  await page.locator('.browser-sessions-pane button[data-slot="row-button"]').filter({ hasText: 'Plan a calmer working week' }).click()
  await expect(editor(page)).toHaveText('session draft')
})
