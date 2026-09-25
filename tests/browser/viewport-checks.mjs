import { expect } from '@playwright/test'

// Desktop automation does not open a software keyboard. Change only the
// visual viewport, leaving the layout viewport tall, as mobile browsers do.
export function viewportChecks(test, open) {
  test.describe('software keyboard viewport', () => {
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

    for (const scale of [100, 125, 150]) {
      test(`composer follows the keyboard at ${scale}% UI scale`, async ({ page }) => {
        await page.addInitScript(() => {
          const viewport = window.visualViewport
          const state = { height: 844, offsetTop: 0, scale: 1 }
          for (const key of Object.keys(state)) {
            Object.defineProperty(viewport, key, { configurable: true, get: () => state[key] })
          }
          window.setTestViewport = (next, event = 'resize') => {
            Object.assign(state, next)
            viewport.dispatchEvent(new Event(event))
          }
        })
        await open(page)
        await page.evaluate(percent => window.hermesDesktop.zoom.setPercent(percent), scale)
        const editor = page.locator('[contenteditable="true"]:visible').first()
        const surface = page.locator('[data-slot="composer-surface"]:visible')
        await editor.fill('Keep typing above the keyboard')

        const check = async (height, top = 0) => {
          await expect.poll(async () => {
            const box = await surface.boundingBox()
            return Math.abs(top + height - box.y - box.height - 8 * scale / 100)
          }).toBeLessThan(2)
          const bounds = await editor.boundingBox()
          expect(bounds.y).toBeGreaterThanOrEqual(top)
          expect(bounds.y + bounds.height).toBeLessThanOrEqual(top + height)
          expect(await surface.evaluate(element => {
            const box = element.getBoundingClientRect()
            return element.contains(document.elementFromPoint(box.x + box.width / 2, box.bottom - 3))
          }), 'composer controls are not clipped by an ancestor').toBe(true)
          await expect(editor).toBeFocused()
          await expect(editor).toHaveText('Keep typing above the keyboard')
        }
        await check(844)
        await page.evaluate(() => window.setTestViewport({ height: 440 }))
        expect(await page.evaluate(() => window.innerHeight)).toBe(844)
        await check(440)
        await page.evaluate(() => window.setTestViewport({ offsetTop: 48 }, 'scroll'))
        await check(440, 48)
        await page.evaluate(() => window.setTestViewport({ height: 844, offsetTop: 0 }))
        await check(844)

        // Pinch zoom magnifies the current layout without reflowing it.
        await page.evaluate(() => window.setTestViewport({ height: 422, scale: 2 }))
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
        await check(844)
        await page.evaluate(() => window.setTestViewport({ height: 844, scale: 1 }))
        await page.setViewportSize({ width: 844, height: 390 })
        await page.evaluate(() => window.setTestViewport({ height: 270 }))
        await check(270)
        await page.evaluate(() => window.setTestViewport({ height: 390 }))
        await check(390)
      })
    }

    test('retains dynamic viewport sizing without VisualViewport', async ({ page }) => {
      await page.addInitScript(() => Object.defineProperty(window, 'visualViewport', { value: undefined }))
      await open(page)
      await expect.poll(async () => {
        const box = await page.locator('.browser-shell').boundingBox()
        return Math.abs(box.height - 844)
      }).toBeLessThan(2)
    })
  })
}
