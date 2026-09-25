import { test, expect } from '@playwright/test'
import { createServer } from 'vite'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
let server, origin, cache
test.beforeAll(async () => {
  cache = mkdtempSync(path.join(tmpdir(), 'hermes-submit-scroll-'))
  server = await createServer({
    configFile: false, root, cacheDir: cache,
    server: { host: '127.0.0.1', port: 0, fs: { allow: [root, realpathSync(path.join(root, 'node_modules'))] } },
    optimizeDeps: { entries: ['tests/browser/fixtures/submit-scroll.html'], include: ['react', 'react-dom/client', 'use-stick-to-bottom'] }
  })
  await server.listen()
  origin = `http://127.0.0.1:${server.httpServer.address().port}`
})
test.afterAll(async () => {
  await server?.close()
  if (cache) rmSync(cache, { recursive: true, force: true })
})

async function geometry(page) {
  return page.evaluate(() => {
    const viewport = document.querySelector('[data-slot="aui_thread-viewport"]')
    const turns = [...document.querySelectorAll('[data-slot="aui_turn-pair"]')]
    const turn = turns.at(-1)
    const prompt = turn.querySelector('[data-slot="aui_user-message-root"]')
    const reply = turn.querySelector('[data-reply]')
    const scale = viewport.getBoundingClientRect().height / viewport.offsetHeight
    return {
      gap: (turn.getBoundingClientRect().top - viewport.getBoundingClientRect().top) / scale,
      empty: (turn.getBoundingClientRect().bottom - reply.getBoundingClientRect().bottom) / scale,
      replyBelowPrompt: reply.getBoundingClientRect().top >= prompt.getBoundingClientRect().bottom,
      scrollTop: viewport.scrollTop,
      distanceFromBottom: viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop,
      previousMinimums: turns.slice(0, -1).map(element => element.style.minHeight)
    }
  })
}

for (const [width, height, scale] of [[1100, 800, 1], [390, 844, 1.25]]) {
  test(`submitted prompt reserves space and follows growing replies at ${width}px`, async ({ page }) => {
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.setViewportSize({ width, height })
    await page.goto(`${origin}/tests/browser/fixtures/submit-scroll.html`)
    const editor = page.locator('[contenteditable]')
    await expect(editor).toBeVisible()
    await page.evaluate(value => document.documentElement.style.setProperty('--scale', String(value)), scale)

    // Enter sends directly; clicking Send fires a native submit event.
    for (const method of ['Send', 'Enter']) {
      await editor.fill(`A new question via ${method}`)
      if (method === 'Enter') await editor.press('Enter')
      else await page.getByRole('button', { name: 'Send', exact: true }).click()

      await expect.poll(async () => Math.abs((await geometry(page)).gap - 12)).toBeLessThan(2)
      const initial = await geometry(page)
      expect(initial.empty).toBeGreaterThan(200)
      expect(initial.replyBelowPrompt).toBe(true)
      expect(initial.previousMinimums.every(value => value === '')).toBe(true)

      await page.evaluate(() => window.growReply(140))
      await expect.poll(async () => (await geometry(page)).empty).toBeLessThan(initial.empty - 100)
      await expect.poll(async () => Math.abs((await geometry(page)).gap - 12)).toBeLessThan(2)

      await page.evaluate(() => window.completeReply())
      await expect(page.locator('[data-slot="aui_user-message-root"]').last()).toHaveAttribute('data-message-id', /^saved-/)
      await expect.poll(async () => Math.abs((await geometry(page)).gap - 12)).toBeLessThan(2)

      await page.setViewportSize({ width, height: height - 100 })
      await expect.poll(async () => Math.abs((await geometry(page)).gap - 12)).toBeLessThan(2)
      await page.setViewportSize({ width, height })
      await expect.poll(async () => Math.abs((await geometry(page)).gap - 12)).toBeLessThan(2)

      // Content eventually fills the reservation; the normal scroll owner
      // then keeps the newest output in view without retaining a blank tail.
      await page.evaluate(() => window.growReply(1400))
      await expect.poll(async () => (await geometry(page)).empty).toBeLessThan(2)
      await expect.poll(async () => (await geometry(page)).distanceFromBottom).toBeLessThan(3)
    }

    await page.mouse.move(width / 2, 200)
    await page.mouse.wheel(0, -300)
    await expect.poll(async () => (await geometry(page)).distanceFromBottom).toBeGreaterThan(200)
    const readingTop = (await geometry(page)).scrollTop
    await page.evaluate(() => window.growReply(1700))
    await expect.poll(async () => (await geometry(page)).distanceFromBottom).toBeGreaterThan(400)
    expect((await geometry(page)).scrollTop).toBeCloseTo(readingTop, 0)

    await page.evaluate(() => window.switchConversation())
    await expect(page.locator('[data-slot="aui_turn-pair"]')).toHaveCount(1)
    expect(await page.locator('[data-slot="aui_turn-pair"]').evaluate(turn => turn.style.minHeight)).toBe('')
    expect(errors).toEqual([])
  })
}
