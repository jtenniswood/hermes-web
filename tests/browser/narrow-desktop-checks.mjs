import { expect } from '@playwright/test'

export function narrowDesktopChecks(test, open) {
  test('narrow desktop preserves scale and mouse menus while hiding navigation', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await open(page)
    await page.evaluate(() => window.hermesDesktop.zoom.setPercent(150))
    const editor = page.locator('[contenteditable="true"]:visible').first()
    const navigation = page.locator('#browser-navigation')
    const settings = page.getByRole('button', { name: 'Open settings menu', exact: true })
    await editor.fill('Keep my desktop draft through resizing')
    const initialSize = await settings.boundingBox()
    await settings.click()
    const settingsMenu = page.getByRole('menu', { name: 'Settings and workspace', exact: true })
    const initialRow = await settingsMenu.getByRole('menuitem', { name: 'Settings', exact: true }).boundingBox()
    await page.keyboard.press('Escape')

    for (const width of [767, 600, 390]) {
      await page.setViewportSize({ width, height: 900 })
      await expect(navigation).toBeHidden()
      await expect(editor).toHaveText('Keep my desktop draft through resizing')
      expect((await settings.boundingBox()).height).toBeCloseTo(initialSize.height, 1)
      expect(await page.evaluate(async () => (await window.hermesDesktop.zoom.get()).percent)).toBe(150)
      await settings.click()
      await expect(settingsMenu).toBeVisible()
      expect((await settingsMenu.getByRole('menuitem', { name: 'Settings', exact: true }).boundingBox()).height).toBeCloseTo(initialRow.height, 1)
      expect((await settingsMenu.boundingBox()).width).toBeLessThan(width)
      await expect(page.locator('.browser-action-sheet')).toHaveCount(0)
      await page.keyboard.press('Escape')

      await page.getByRole('button', { name: 'Open navigation', exact: true }).click()
      await expect(navigation).toBeVisible()
      await page.getByRole('tablist', { name: 'Navigation', exact: true }).click({ button: 'right' })
      const contextMenu = page.getByRole('menu', { name: 'Navigation tabs', exact: true })
      await expect(contextMenu).toBeVisible()
      await expect(contextMenu.getByRole('group', { name: 'Tabs', exact: true }).getByRole('menuitemcheckbox', { name: 'Sessions', exact: true })).toBeChecked()
      expect((await contextMenu.boundingBox()).width).toBeLessThan(width)
      await page.keyboard.press('Escape')

      await page.getByRole('button', { name: 'Filters', exact: true }).click()
      const parent = page.locator('[data-slot="dropdown-menu-content"]').last()
      await parent.getByRole('menuitem', { name: 'Ordering', exact: true }).hover()
      await expect(page.locator('[data-slot="dropdown-menu-sub-content"]')).toBeVisible()
      await expect(parent).toBeVisible()
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')
      await expect(navigation).toBeHidden()
      await expect(editor).toHaveText('Keep my desktop draft through resizing')
    }

    await page.setViewportSize({ width: 1280, height: 900 })
    await expect(navigation).toBeVisible()
    await page.getByRole('button', { name: 'Hide navigation', exact: true }).click()
    await page.setViewportSize({ width: 600, height: 900 })
    await page.setViewportSize({ width: 1280, height: 900 })
    await expect(navigation).toBeHidden()
  })
}
