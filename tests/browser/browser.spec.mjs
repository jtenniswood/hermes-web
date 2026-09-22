import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { createPreviewGateway } from '../../scripts/preview/gateway.mjs'
import { getBrowserTarget } from './test-target.mjs'
import { installBrowserErrorCollector } from './error-collector.mjs'

// This suite exercises the browser shell only. The old desktop/browser
// selector was removed, so every test must start through the same production
// entry point users receive from Docker and the dev server.
// Exercise real capture APIs without touching the machine's physical microphone.
test.use({ actionTimeout: 15000, launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } })
test.describe.configure({ retries: 1, timeout: 90000 })
const { image: browserImage, url: browserUrl } = getBrowserTarget()
// Local runs may intentionally omit a built image; CI must fail clearly rather
// than silently report this suite as skipped when it is part of the required
// production-image verification.
test.skip(!browserImage && !browserUrl && !process.env.CI, 'Set HERMES_TEST_IMAGE or HERMES_BROWSER_PREVIEW_URL to run browser image tests')

let gateway, container, origin

test.beforeAll(async () => {
  if (browserUrl) {
    origin = browserUrl
    return
  }
  if (!browserImage) throw new Error('HERMES_TEST_IMAGE or HERMES_BROWSER_PREVIEW_URL is required in CI')
  gateway = createPreviewGateway()
  await new Promise(resolve => gateway.server.listen(0, '0.0.0.0', resolve))
  container = execFileSync('docker', [
    'run', '-d', '--rm', '--add-host', 'host.docker.internal:host-gateway',
    '-p', '127.0.0.1::80',
    '-e', `HERMES_GATEWAY_URL=http://host.docker.internal:${gateway.server.address().port}`,
    '-e', 'HERMES_GATEWAY_NAME=Preview workspace',
    browserImage
  ], { encoding: 'utf8' }).trim()
  const port = execFileSync('docker', ['port', container, '80/tcp'], { encoding: 'utf8' }).trim().split(':').at(-1)
  origin = `http://127.0.0.1:${port}`
  await expect.poll(async () => {
    try { return (await fetch(origin)).status } catch { return 0 }
  }).toBe(200)
})

test.afterAll(async () => {
  if (container) execFileSync('docker', ['stop', container], { stdio: 'ignore' })
  await gateway?.close()
})

const editor = page => page.locator('[contenteditable="true"]:visible').first()
const openNavigation = async page => {
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click()
  await expect(page.locator('.browser-navigation.is-open')).toBeVisible()
  // Let the drawer transition finish before interacting with controls near its
  // bottom edge; Playwright otherwise can sample the transformed position.
  await page.waitForTimeout(200)
}
const open = async (page, session = 'preview-week') => {
  await page.goto(`${origin}/#/${session}`)
  // A cold Vite graph can race the first document module request. A single
  // reload exercises the same startup-recovery path users get after a stale
  // chunk and keeps this behavior test deterministic.
  try {
    await expect(editor(page)).toBeVisible({ timeout: 12000 })
  } catch {
    await page.reload()
    await expect(editor(page)).toBeVisible({ timeout: 30000 })
  }
  await expect(page.getByText('Help me make a thoughtful plan.', { exact: true }).first()).toBeVisible({ timeout: 30000 })
}

test.describe('browser microphone', () => {
  test('records once permission is granted and releases the mic after transcription', async ({ page }) => {
    let audio
    await page.route(/\/api\/audio\/transcribe(?:\?|$)/, async route => {
      audio = route.request().postDataJSON()
      await route.fulfill({ json: { ok: true, transcript: 'A recorded browser draft' } })
    })
    await page.addInitScript(() => {
      window.micRequests = 0
      window.micStreams = []
      const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
      navigator.mediaDevices.getUserMedia = async constraints => {
        window.micRequests++
        const stream = await getUserMedia(constraints)
        window.micStreams.push(stream)
        return stream
      }
    })
    await open(page)
    expect(await page.evaluate(() => window.micRequests)).toBe(0)
    expect(await page.evaluate(async () => (await navigator.permissions.query({ name: 'microphone' })).state)).toBe('prompt')
    // Chromium's fake permission UI accepts the first-use request from this click.
    await page.getByRole('button', { name: 'Voice dictation', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Stop dictation', exact: true })).toBeVisible()
    expect(await page.evaluate(() => window.micRequests)).toBe(1)
    expect(await page.evaluate(() => window.micStreams[0].getAudioTracks()[0].readyState)).toBe('live')
    // Let the real MediaRecorder accumulate an audio chunk before stopping.
    await page.waitForTimeout(500)
    await page.getByRole('button', { name: 'Stop dictation', exact: true }).click()
    await expect(editor(page)).toContainText('A recorded browser draft')
    expect(audio.data_url).toMatch(/^data:audio\/.+;base64,.+/)
    expect(audio.mime_type).toMatch(/^audio\//)
    expect(await page.evaluate(() => window.micStreams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')))).toBe(true)
    await expect(page.getByText('Voice recording failed', { exact: true })).toBeHidden()
  })

  test('denied permission explains how to enable access and allows retry', async ({ page }) => {
    await page.addInitScript(() => {
      const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
      let denied = true
      navigator.mediaDevices.getUserMedia = async constraints => {
        if (denied) {
          denied = false
          throw new DOMException('Permission denied', 'NotAllowedError')
        }
        return getUserMedia(constraints)
      }
    })
    await open(page)
    await page.getByRole('button', { name: 'Voice dictation', exact: true }).click()
    await expect(page.getByText(/Allow microphone access for this site in your browser settings/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Voice dictation', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: 'Voice dictation', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Stop dictation', exact: true })).toBeVisible()
  })

  test('HTTP explains the secure connection requirement before requesting permission', async ({ page }) => {
    test.skip(!container, 'Uses the isolated Docker preview on a non-localhost HTTP origin')
    await page.goto(`${origin.replace('127.0.0.1', '0.0.0.0')}/#/preview-week`)
    await expect(editor(page)).toBeVisible({ timeout: 30000 })
    expect(await page.evaluate(() => window.isSecureContext)).toBe(false)
    await page.getByRole('button', { name: 'Voice dictation', exact: true }).click()
    await expect(page.getByText(/Microphone recording requires HTTPS or localhost/)).toBeVisible()
    await expect(page.getByText('This runtime does not support microphone recording.', { exact: true })).toBeHidden()
  })
})

test('fresh startup restores chat, registrations, bots, and avatar-backed profiles', async ({ page }) => {
  const browserErrors = installBrowserErrorCollector(page)
  await open(page)
  await expect(page.locator('.browser-chat-title')).toHaveCount(0)
  await expect(page.locator('[data-browser-conversation-kind="session"]')).toHaveCount(1)
  await expect(page.locator('.browser-upstream-workspace [data-zone-tabstrip]')).toHaveCount(0)
  await expect(page.locator('.browser-main header[class*="h-(--titlebar-height)"]')).toBeHidden()
  await page.getByRole('tab', { name: 'Bots', exact: true }).click()
  await expect(page.getByRole('button', { name: /Research · @/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Writer · @/ })).toBeVisible()

  await page.getByRole('button', { name: /Research · @/ }).click()
  await expect(editor(page)).toBeVisible()
  await expect(page.locator('.browser-chat-title')).toHaveCount(0)
  await expect(page.locator('[data-browser-conversation-kind="bot"]')).toHaveCount(1)
  await expect(page).toHaveURL(/#\/preview-research$/)
  await expect(page.locator('[data-tree-tab^="session-tile:"]')).toHaveCount(0)

  await page.getByRole('tab', { name: 'Sessions', exact: true }).click()
  await page.getByRole('button', { name: 'Plan a calmer working week', exact: true }).click()
  await expect(editor(page)).toBeVisible()
  await expect(page.locator('[data-browser-conversation-kind="session"]')).toHaveCount(1)
  browserErrors.assertClean()
})

test('cold startup renders the production entry without a concealment reload', async ({ page }) => {
  const browserErrors = installBrowserErrorCollector(page)
  await page.goto(`${origin}/#/preview-week`)
  await expect(editor(page)).toBeVisible({ timeout: 30000 })
  await expect(page.getByText('Help me make a thoughtful plan.', { exact: true }).first()).toBeVisible({ timeout: 30000 })
  browserErrors.assertClean()
})

test('empty chat stays centered as the available panel space changes', async ({ page }, testInfo) => {
  await page.goto(`${origin}/#/`)
  const intro = page.locator('[data-slot="aui_intro"]')
  await expect(intro).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  for (const [width, height, scale] of [[1440, 960, 125], [1000, 700, 150], [800, 600, 200], [390, 844, 125]]) {
    await page.setViewportSize({ width, height })
    await page.evaluate(percent => window.hermesDesktop.zoom.setPercent(percent), scale)
    await expect.poll(async () => intro.evaluate(el => {
      const viewport = el.closest('[data-slot="aui_thread-viewport"]').getBoundingClientRect()
      const group = el.firstElementChild.getBoundingClientRect()
      const title = el.querySelector('.wordmark > :not([aria-hidden]) > span').getBoundingClientRect()
      return Math.max(
        Math.abs(title.x + title.width / 2 - viewport.x - viewport.width / 2),
        Math.abs(group.y + group.height / 2 - viewport.y - viewport.height / 2),
        viewport.left - title.left, title.right - viewport.right,
        viewport.top - group.top, group.bottom - viewport.bottom
      )
    })).toBeLessThan(2)
    await page.screenshot({ path: testInfo.outputPath(`empty-chat-${width}-${scale}.png`) })
  }
})

for (const width of [390, 1440]) {
  test(`composer stays at the bottom while idle, running, and reconnecting at ${width}px`, async ({ page }) => {
    let disconnect = false
    const sockets = []
    await page.routeWebSocket(/\/ws/, socket => {
      if (disconnect) socket.close()
      else { socket.connectToServer(); sockets.push(socket) }
    })
    await page.setViewportSize({ width, height: 960 })
    await open(page)
    const surface = page.locator('[data-slot="composer-surface"]')
    const checkBottom = async scale => {
      await expect.poll(async () => {
        const box = await surface.boundingBox()
        return Math.abs(960 - box.y - box.height - 8 * scale / 100)
      }).toBeLessThan(2)
      await expect(page.locator('.browser-status')).toBeHidden()
    }
    for (const scale of [100, 125, 150]) {
      await page.evaluate(percent => window.hermesDesktop.zoom.setPercent(percent), scale)
      await checkBottom(scale)
    }
    await editor(page).fill('Check composer bottom spacing')
    await editor(page).press('Enter')
    await expect(surface.getByRole('button', { name: 'Stop', exact: true })).toBeVisible()
    await expect(page.locator('.browser-chat-toolbar [role="status"]')).toHaveCount(0)
    await expect(page.locator('.browser-running-status')).toHaveCount(0)
    await checkBottom(150)
    disconnect = true
    for (const socket of sockets) socket.close()
    await expect(editor(page)).toHaveAttribute('data-placeholder', 'Reconnecting to Hermes…')
    await checkBottom(150)
  })
}

for (const width of [390, 1440]) {
  for (const scale of [100, 125, 150]) {
    test(`composer tooltips fit beside their controls at ${width}px and ${scale}%`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 960 })
      await page.emulateMedia({ colorScheme: 'dark' })
      await open(page)
      await page.evaluate(percent => window.hermesDesktop.zoom.setPercent(percent), scale)
      for (const [label, name] of [['model', /^Model ·/], ['voice', /Start voice conversation/]]) {
        const control = page.getByRole('button', { name })
        await control.hover()
        const tooltip = page.locator('[data-slot="tooltip-content"]', { hasText: name })
        await expect(tooltip).toBeVisible()
        await expect.poll(async () => tooltip.evaluate(el => {
          const rect = el.getBoundingClientRect(), css = getComputedStyle(el)
          const scale = Number(getComputedStyle(document.documentElement).getPropertyValue('--web-ui-scale')) || 1
          return rect.height / (parseFloat(css.lineHeight) * scale)
        })).toBeLessThan(4)
        const tipBox = await tooltip.boundingBox(), controlBox = await control.boundingBox()
        expect(tipBox.x).toBeGreaterThanOrEqual(0)
        expect(tipBox.x + tipBox.width).toBeLessThanOrEqual(width)
        expect(tipBox.y).toBeGreaterThanOrEqual(0)
        expect(Math.abs(tipBox.y + tipBox.height - controlBox.y)).toBeLessThan(24)
        await expect.poll(async () => {
          const arrow = await tooltip.locator('[data-slot="tooltip-arrow"]').boundingBox()
          return Math.abs(arrow.x + arrow.width / 2 - controlBox.x - controlBox.width / 2)
        }).toBeLessThan(2)
        const arrowBox = await tooltip.locator('[data-slot="tooltip-arrow"]').boundingBox()
        expect(arrowBox.x).toBeGreaterThanOrEqual(tipBox.x)
        expect(arrowBox.x + arrowBox.width).toBeLessThanOrEqual(tipBox.x + tipBox.width)
        await page.screenshot({ path: testInfo.outputPath(`${label}-tooltip.png`) })
        await page.mouse.move(0, 0)
        await expect(tooltip).toBeHidden()
      }
    })
  }
}

for (const width of [390, 1440]) {
  test(`pinned section can be hidden and restored without unpinning at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 })
    await open(page)
    await page.getByRole('button', { name: 'Chat actions', exact: true }).click()
    const unpin = page.getByRole('menuitem', { name: 'Unpin', exact: true })
    if (await unpin.count()) {
      await unpin.click()
      await page.getByRole('button', { name: 'Chat actions', exact: true }).click()
    }
    await expect(page.locator('.browser-pinned-section')).toHaveCount(0)
    await page.getByRole('menuitem', { name: 'Pin', exact: true }).click()
    if (width === 390) await openNavigation(page)
    const section = page.locator('.browser-pinned-section')
    const heading = section.getByRole('button', { name: /Pinned/ }).first()
    await expect(section).toBeVisible()
    await heading.click({ button: 'right' })
    await expect(page.getByRole('menuitem', { name: 'Hide pinned section', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    if (width === 390) await expect(page.locator('.browser-navigation')).toHaveClass(/is-open/)
    await expect(section).toBeVisible()
    await heading.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Hide pinned section', exact: true }).click()
    await expect(section).toBeHidden()
    await page.reload()
    await expect(editor(page)).toBeVisible()
    if (width === 390) await openNavigation(page)
    await expect(section).toBeHidden()
    // The remaining section header is a restore target while Pinned is hidden.
    await page.locator('.browser-sessions-pane').getByRole('button', { name: 'Sessions', exact: true }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Show pinned section', exact: true }).click()
    await expect(section).toBeVisible()
    if (!await section.locator('[data-row-actions]').count()) await heading.click()
    const row = section.locator('[data-row-actions]').first()
    await expect(row).toBeVisible()
    await row.click({ button: 'right' })
    await expect(page.getByRole('menuitem', { name: 'Unpin', exact: true })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Hide pinned section', exact: true })).toHaveCount(0)
    // Restore the shared preview fixture after checking the nested row menu.
    await page.getByRole('menuitem', { name: 'Unpin', exact: true }).click()
    await expect(section).toHaveCount(0)
    await page.reload()
    await expect(editor(page)).toBeVisible()
    await expect(section).toHaveCount(0)
  })
}

test('chat actions open from the title toolbar', async ({ page }) => {
  await open(page)
  const trigger = page.getByRole('button', { name: 'Chat actions', exact: true })
  await expect(trigger).toBeVisible()
  await expect(page.locator('.browser-chat-toolbar .browser-actions').getByRole('button').first()).toHaveAccessibleName('Chat actions')
  await trigger.click()
  const menu = page.locator('[role="menu"]:visible').last()
  await expect(menu.getByText(/Rename/)).toBeVisible()
  await expect(menu.getByText(/Open in new tab/)).toHaveCount(0)
  await expect(menu.getByText(/New window/)).toHaveCount(0)
})

test('settings and command center use one upstream overlay and preserve the chat', async ({ page }) => {
  await open(page)
  const chat = editor(page)
  await chat.fill('Keep this draft while checking settings')
  await page.getByRole('button', { name: 'Open settings menu', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click()
  await expect(page.getByText('Appearance', { exact: true }).first()).toBeVisible()
  await expect(page.locator('[data-overlay-surface]')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(chat).toContainText('Keep this draft while checking settings')

  await page.getByRole('button', { name: 'Open settings menu', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Gateway', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Gateway', exact: true })).toBeVisible()
})

test('approval mode keeps the selected profile mode and toolbar icon synchronized', async ({ page }) => {
  await open(page)
  const control = page.locator('.browser-approval-control button')
  await expect(control).toBeVisible()
  const initialIcon = await control.locator('svg').getAttribute('class')
  expect(initialIcon).toContain('brain')
  await control.click()
  const menu = page.locator('[role="menu"]:visible').last()
  await expect(menu.getByText('Approval mode', { exact: true })).toBeVisible()
  await expect(menu.getByText('Ask when needed', { exact: true })).toBeVisible()
  await expect(menu.getByRole('menuitemradio', { name: /Smart/ })).toHaveAttribute('aria-checked', 'true')
  const heading = menu.locator('[data-slot="dropdown-menu-label"]')
  await expect(heading).toHaveCount(1)
  await expect(heading.locator('xpath=following-sibling::*[1]')).not.toHaveAttribute('data-slot', 'dropdown-menu-separator')
  await menu.getByRole('menuitemradio', { name: /Manual/ }).click()
  await expect.poll(() => control.locator('svg').getAttribute('class')).toContain('shield-lock')
  await control.click()
  await expect(page.locator('[role="menu"]:visible').last().getByRole('menuitemradio', { name: /Manual/ })).toHaveAttribute('aria-checked', 'true')
})

test('browser settings omit desktop-only keybinds', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: 'Open settings menu', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click()
  await page.getByText('Keyboard Shortcuts', { exact: true }).click()
  await expect(page.getByText('Toggle sessions sidebar', { exact: true })).toBeVisible()
  for (const label of ['Toggle HUD mode', 'Toggle terminal', 'New terminal', 'Open browser', 'New session tab']) {
    await expect(page.getByText(label, { exact: true })).toHaveCount(0)
  }
})

test('browser workspace panels open and close without losing a draft', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await open(page)
  await editor(page).fill('Keep my draft while using panels')
  await expect(page.getByRole('button', { name: 'Open panels', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Open settings menu', exact: true }).click()
  await page.getByRole('dialog', { name: 'Settings and workspace', exact: true }).getByRole('button', { name: 'files', exact: true }).click()
  const close = page.getByRole('button', { name: 'Close files panel', exact: true })
  await expect(close).toBeVisible()
  await close.click()
  await expect(close).toBeHidden()
  await expect(editor(page)).toContainText('Keep my draft while using panels')
})

for (const width of [390, 1440]) {
  test(`chat toolbar toggles navigation without losing the draft at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 })
    await open(page)
    await editor(page).fill('Keep this draft while toggling the sidebar')
    const toggle = page.locator('.browser-chat-toolbar .browser-menu')
    const navigation = page.locator('#browser-navigation')
    const resizer = page.getByRole('separator', { name: 'Resize navigation panel', exact: true })
    await expect(toggle).toBeVisible()
    if (width === 390) await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(navigation).toBeVisible()
    const originalWidth = (await navigation.boundingBox()).width
    const originalChatWidth = (await page.locator('.browser-main').boundingBox()).width
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(navigation).toBeHidden()
    await expect(resizer).toBeHidden()
    if (width === 1440) expect((await page.locator('.browser-main').boundingBox()).width).toBeGreaterThan(originalChatWidth)
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(navigation).toBeVisible()
    expect((await navigation.boundingBox()).width).toBeCloseTo(originalWidth, 0)
    await expect(editor(page)).toContainText('Keep this draft while toggling the sidebar')
    await expect(page.locator('.browser-chat-title')).toHaveCount(0)
    if (width === 390) {
      await page.keyboard.press('Escape')
      await expect(navigation).toBeHidden()
      await expect(toggle).toBeFocused()
    } else {
      await expect(resizer).toBeVisible()
    }
  })

  test(`search and disclosure form one navigation list at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 960 })
    await page.emulateMedia({ colorScheme: 'dark' })
    await open(page)
    if (width === 390) await openNavigation(page)
    const search = page.locator('.browser-sessions-pane div:has(> input[placeholder="Search"])')
    const scheduled = page.getByRole('button', { name: 'Scheduled jobs', exact: true })
    const toggle = page.locator('.browser-navigation-section-trigger')
    const extras = page.getByRole('group', { name: 'More controls', exact: true })
    for (const scale of [100, 125, 150]) {
      await page.evaluate(percent => window.hermesDesktop.zoom.setPercent(percent), scale)
      await page.mouse.move(width - 1, 0)
      const searchBox = await search.boundingBox(), scheduledBox = await scheduled.boundingBox()
      expect(Math.abs(searchBox.x - scheduledBox.x)).toBeLessThan(2)
      expect(Math.abs(searchBox.width - scheduledBox.width)).toBeLessThan(2)
      expect(searchBox.y - scheduledBox.y - scheduledBox.height).toBeGreaterThanOrEqual(-1)
      expect(searchBox.y - scheduledBox.y - scheduledBox.height).toBeLessThan(4)
      const scheduledColor = await scheduled.evaluate(el => getComputedStyle(el).color)
      await expect(search.locator('input')).toHaveCSS('color', scheduledColor)
      expect(await search.locator('input').evaluate(el => getComputedStyle(el, '::placeholder').color)).toBe(scheduledColor)
      const iconColor = await scheduled.locator('.codicon').evaluate(el => getComputedStyle(el).color)
      await expect(search.locator('svg')).toHaveCSS('color', iconColor)
      expect(await toggle.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeLessThan(await scheduled.evaluate(el => parseFloat(getComputedStyle(el).fontSize)))
      await toggle.click()
      await expect(toggle).toHaveAccessibleName('Less')
      await expect(extras.getByRole('button', { name: 'Capabilities', exact: true })).toBeVisible()
      const listBox = await extras.boundingBox(), lessBox = await toggle.boundingBox()
      expect(listBox.y).toBeGreaterThanOrEqual(searchBox.y + searchBox.height - 1)
      expect(Math.abs((listBox.y - searchBox.y - searchBox.height) - (searchBox.y - scheduledBox.y - scheduledBox.height))).toBeLessThan(1)
      expect(lessBox.y).toBeGreaterThanOrEqual(listBox.y + listBox.height - 1)
      if (scale === 125) await page.screenshot({ path: testInfo.outputPath('expanded-navigation.png') })
      // Focusing search must leave the disclosure expanded, unlike a popup menu.
      await search.locator('input').click()
      await expect(toggle).toHaveAccessibleName('Less')
      await toggle.click()
      await expect(toggle).toHaveAccessibleName('More')
      await expect(extras).toBeHidden()
      const moreBox = await toggle.boundingBox()
      expect(moreBox.y - searchBox.y - searchBox.height).toBeLessThan(10)
    }
  })
}

test('None grouping shows all sessions without subheaders and survives reload', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.route(/\/api\/(?:profiles\/)?sessions(?:\/sidebar)?(?:\?|$)/, async route => {
    const response = await route.fetch()
    const data = await response.json()
    const sessions = data.recents?.sessions ?? data.sessions ?? []
    for (const session of sessions) {
      if (session.id === 'preview-idea') session.last_active = session.started_at = session.created_at = Math.floor(Date.now() / 1000) - 40 * 86400
    }
    await route.fulfill({ response, json: data })
  })
  await open(page)
  const sidebar = page.locator('.browser-sessions-pane')
  const dividers = sidebar.locator('.group\\/workspace > button[aria-expanded]')
  const olderSession = sidebar.getByText('Explore a product idea', { exact: true }).first()
  const chooseGrouping = async name => {
    await page.getByRole('button', { name: 'Filters', exact: true }).click()
    await page.getByRole('menuitem', { name: /^Grouping/ }).hover()
    const option = page.getByRole('menuitemradio', { name, exact: true })
    await option.click()
    await expect(option).toHaveAttribute('aria-checked', 'true')
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
  }
  for (const allProfiles of [false, true]) {
    if (allProfiles) await page.getByRole('button', { name: 'All profiles', exact: true }).click()
    await expect(dividers.first()).toBeVisible()
    // None must reveal sessions from collapsed groups, not just hide their labels.
    if (await dividers.first().getAttribute('aria-expanded') === 'true') await dividers.first().click()
    await expect(olderSession).toBeHidden()
    await chooseGrouping('None')
    await expect(dividers).toHaveCount(0)
    await expect(olderSession).toBeVisible()
    await expect(sidebar.getByRole('button', { name: 'Sessions', exact: true })).toBeVisible()
    await page.reload()
    await expect(editor(page)).toBeVisible()
    await expect(olderSession).toBeVisible()
    await expect(dividers).toHaveCount(0)
    await page.getByRole('button', { name: 'Filters', exact: true }).click()
    await expect(page.getByRole('menuitem', { name: 'Grouping None', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await chooseGrouping('Updated')
    await expect(dividers.first()).toBeVisible()
  }
})

for (const width of [390, 1440]) {
  test(`Bots keeps filters beside the rightmost add button at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 960 })
    await open(page)
    await page.waitForLoadState('networkidle')
    if (width === 390) await openNavigation(page)
    await page.getByRole('tab', { name: 'Bots', exact: true }).click()
    const filter = page.getByRole('button', { name: /^Filter roster/ })
    const add = page.getByRole('button', { name: 'New bot or group chat', exact: true })
    await expect(filter).toBeVisible()
    await expect(add).toBeVisible()
    const checkOrder = async () => {
      const f = await filter.boundingBox(), a = await add.boundingBox()
      expect(Math.abs(f.y + f.height / 2 - a.y - a.height / 2)).toBeLessThan(2)
      expect(f.x + f.width).toBeLessThanOrEqual(a.x)
      expect(await add.evaluate(el => el.parentElement.lastElementChild === el)).toBe(true)
    }
    await checkOrder()
    await filter.click()
    const surface = page.getByRole(width === 390 ? 'dialog' : 'menu', { name: 'Filter Bots', exact: true })
    await expect(surface.getByText('Show', { exact: true })).toBeVisible()
    await expect(surface.getByText('Filter by time', { exact: true })).toBeVisible()
    await expect(surface.getByRole(width === 390 ? 'checkbox' : 'menuitemcheckbox', { name: 'Show hidden bots', exact: true })).toBeVisible()
    await surface.getByRole(width === 390 ? 'radio' : 'menuitemradio', { name: 'Group chats only', exact: true }).click()
    await page.keyboard.press('Escape')
    await expect(filter).toBeFocused()
    await expect(filter).toHaveAccessibleName('Filter roster, 1 active')
    await filter.click()
    await surface.getByRole(width === 390 ? 'button' : 'menuitem', { name: 'Clear filters', exact: true }).click()
    await page.keyboard.press('Escape')
    await expect(filter).toHaveAccessibleName('Filter roster')
    await expect(surface).toHaveCount(0)
    await expect(filter).toBeFocused()
    await expect(add).toBeVisible()
    await checkOrder()
    await add.click()
    await expect(page.getByRole(width === 390 ? 'button' : 'menuitem', { name: 'New bot', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await page.screenshot({ path: testInfo.outputPath('bots-toolbar.png') })
  })

  test(`Bot menus omit the new-chat shortcut at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 })
    await open(page)
    if (width === 390) await openNavigation(page)
    await page.getByRole('tab', { name: 'Bots', exact: true }).click()
    const bot = page.getByRole('button', { name: /Research · @/ }).first()
    await expect(bot).toBeVisible()
    await bot.click({ button: 'right' })
    const menu = page.getByRole(width === 390 ? 'dialog' : 'menu', { name: 'Actions for Research', exact: true })
    await expect(menu).toBeVisible()
    await expect(menu.getByRole(width === 390 ? 'button' : 'menuitem', { name: 'Open Bot Chat', exact: true })).toHaveCount(0)
    await expect(menu.getByRole(width === 390 ? 'button' : 'menuitem', { name: 'New chat with this bot', exact: true })).toHaveCount(0)
    await page.keyboard.press('Escape')
  })

  test(`activity toasts move from Bots to a persistent settings toggle at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 })
    await open(page)
    if (width === 390) await openNavigation(page)
    await page.getByRole('tab', { name: 'Bots', exact: true }).click()
    await expect(page.getByRole('button', { name: /Research · @/ })).toBeVisible()
    await expect(page.locator('.browser-pane button:has(.codicon-bell), .browser-pane button:has(.codicon-bell-slash)')).toHaveCount(0)
    if (width === 390) await page.getByRole('button', { name: 'Hide navigation', exact: true }).click()
    const settings = page.getByRole('button', { name: 'Open settings menu', exact: true })
    await settings.click()
    await expect(page.getByText('Notifications', { exact: true })).toBeVisible()
    const toggle = page.getByRole(width === 390 ? 'checkbox' : 'menuitemcheckbox', { name: 'Activity toasts', exact: true })
    await expect(toggle).toBeVisible()
    const initial = await toggle.getAttribute('aria-checked')
    await toggle.click()
    await settings.click()
    await expect(toggle).toHaveAttribute('aria-checked', initial === 'true' ? 'false' : 'true')
    await page.keyboard.press('Escape')
    await page.reload()
    await expect(editor(page)).toBeVisible()
    await settings.click()
    await expect(toggle).toHaveAttribute('aria-checked', initial === 'true' ? 'false' : 'true')
    await toggle.focus()
    await page.keyboard.press('Enter')
    await settings.click()
    await expect(toggle).toHaveAttribute('aria-checked', initial)
  })
}

for (const width of [390, 1440]) {
  for (const scale of [100, 150]) {
    test(`settings actions retain drafts and transfer modal focus at ${width}px and ${scale}%`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 960 })
      await open(page)
      await page.evaluate(value => window.hermesDesktop.zoom.setPercent(value), scale)
      await editor(page).fill('Keep this settings actions draft')
      const trigger = page.getByRole('button', { name: 'Open settings menu', exact: true })
      const surface = page.getByRole(width === 390 ? 'dialog' : 'menu', { name: 'Settings and workspace', exact: true })
      const role = width === 390 ? 'button' : 'menuitem'
      await trigger.click()
      await expect(surface.locator('.browser-action-group-label')).toHaveText(['Notifications', 'Panels', 'Systems', 'Workspace'])
      for (const name of ['Settings', 'Gateway', 'Command center', 'Webhooks', 'Profiles', 'Agents']) {
        await expect(surface.getByRole(role, { name, exact: true })).toHaveCount(1)
      }
      await page.screenshot({ path: testInfo.outputPath('settings-actions.png') })
      const bounds = await surface.boundingBox()
      expect(bounds.x).toBeGreaterThanOrEqual(-1)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1)
      expect(bounds.y).toBeGreaterThanOrEqual(0)
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(961)
      await page.keyboard.press('Escape')
      await expect(surface).toHaveCount(0)
      await expect(trigger).toBeFocused()
      await trigger.click()
      await surface.getByRole(role, { name: 'Settings', exact: true }).click()
      await expect(page.getByText('Appearance', { exact: true }).first()).toBeVisible()
      const overlay = page.locator('[data-overlay-surface]')
      await expect(overlay).toHaveCount(1)
      await expect(surface).toHaveCount(0)
      await expect.poll(() => overlay.evaluate(el => el.contains(document.activeElement))).toBe(true)
      const focusable = 'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])'
      await overlay.evaluate((el, selector) => Array.from(el.querySelectorAll(selector)).filter(node => node.getClientRects().length && !node.closest('[hidden],[inert],[aria-disabled="true"]')).at(-1).focus(), focusable)
      await page.keyboard.press('Tab')
      await expect.poll(() => overlay.evaluate((el, selector) => document.activeElement === Array.from(el.querySelectorAll(selector)).find(node => node.getClientRects().length && !node.closest('[hidden],[inert],[aria-disabled="true"]')), focusable)).toBe(true)
      await page.keyboard.press('Shift+Tab')
      await expect.poll(() => overlay.evaluate((el, selector) => document.activeElement === Array.from(el.querySelectorAll(selector)).filter(node => node.getClientRects().length && !node.closest('[hidden],[inert],[aria-disabled="true"]')).at(-1), focusable)).toBe(true)
      await page.keyboard.press('Escape')
      await expect(overlay).toHaveCount(0)
      await expect(trigger).toBeFocused()
      await expect(editor(page)).toHaveText('Keep this settings actions draft')
      await page.keyboard.press('Control+l')
      await expect(editor(page)).toBeFocused()
      await expect(page).toHaveURL(/#\/preview-week$/)
      await trigger.click()
      await surface.getByRole(role, { name: 'Gateway', exact: true }).click()
      const gateway = page.getByRole('dialog', { name: 'Gateway', exact: true })
      await expect(gateway.getByRole('heading', { name: 'Gateway', exact: true })).toBeFocused()
      await page.keyboard.press('Escape')
      await expect(gateway).toHaveCount(0)
      await expect(trigger).toBeFocused()
      await expect(editor(page)).toHaveText('Keep this settings actions draft')
    })
  }
}

test('desktop panel actions follow upstream visibility when reopening settings', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 })
  await open(page)
  await editor(page).fill('Keep this pane toggle draft')
  const trigger = page.getByRole('button', { name: 'Open settings menu', exact: true })
  const surface = page.getByRole('menu', { name: 'Settings and workspace', exact: true })
  const files = surface.getByRole('menuitemcheckbox', { name: 'files', exact: true })
  await trigger.click()
  const initiallyOpen = (await files.getAttribute('aria-checked')) === 'true'
  await files.click()
  await trigger.click()
  await expect(files).toHaveAttribute('aria-checked', String(!initiallyOpen))
  await files.click()
  await trigger.click()
  await expect(files).toHaveAttribute('aria-checked', String(initiallyOpen))
  await page.keyboard.press('Escape')
  await expect(editor(page)).toHaveText('Keep this pane toggle draft')
})

test('settings menu consolidates workspace and gateway controls', async ({ page }) => {
  await open(page)
  await expect(page.getByRole('button', { name: 'Open workspace', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Gateway ready', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Open settings menu', exact: true }).click()
  const menu = page.getByRole('menu', { name: 'Settings and workspace', exact: true })
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Starmap', exact: true })).toHaveCount(0)
  await expect(menu.locator('.browser-action-group-label')).toHaveText(['Notifications', 'Panels', 'Systems', 'Workspace'])
  for (const label of ['Command center', 'Webhooks', 'Profiles', 'Agents', 'Settings', 'Gateway']) {
    await expect(menu.getByRole('menuitem', { name: label, exact: true })).toBeVisible()
  }
  await expect(page.getByRole('tab', { name: 'Tools', exact: true })).toHaveCount(0)
})

for (const width of [390, 1440]) {
  test(`gateway opens as a modal from the settings menu at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 960 })
    await page.emulateMedia({ colorScheme: 'dark' })
    await open(page)
    await editor(page).fill('Keep my draft while checking the gateway')
    const settings = page.getByRole('button', { name: 'Open settings menu', exact: true })
    await settings.click()
    await page.screenshot({ path: testInfo.outputPath('settings-menu.png') })
    await page.getByRole(width === 390 ? 'button' : 'menuitem', { name: 'Gateway', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Gateway', exact: true })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('Connected', { exact: true })).toBeVisible()
    await expect(page.getByRole(width === 390 ? 'dialog' : 'menu', { name: 'Settings and workspace', exact: true })).toBeHidden()
    await expect(dialog.getByRole('heading', { name: 'Gateway' })).toBeFocused()
    await page.waitForTimeout(250)
    const bounds = await dialog.boundingBox()
    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width)
    expect(Math.abs(bounds.x + bounds.width / 2 - width / 2)).toBeLessThan(2)
    expect(Math.abs(bounds.y + bounds.height / 2 - 480)).toBeLessThan(2)
    await page.screenshot({ path: testInfo.outputPath('gateway-modal.png') })
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(settings).toBeFocused()
    await expect(editor(page)).toContainText('Keep my draft while checking the gateway')
    await settings.click()
    await page.getByRole(width === 390 ? 'button' : 'menuitem', { name: 'Gateway', exact: true }).click()
    await page.keyboard.press('Tab')
    expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true)
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(dialog).toBeHidden()
  })
}

for (const width of [390, 1440]) {
  for (const scale of [100, 150]) {
    test(`navigation tab actions preserve selection and drafts at ${width}px and ${scale}%`, async ({ page }) => {
      await page.setViewportSize({ width, height: 960 })
      await open(page)
      await page.evaluate(value => window.hermesDesktop.zoom.setPercent(value), scale)
      await editor(page).fill('Keep this draft while arranging navigation')
      if (width === 390) await openNavigation(page)
      const trigger = page.getByRole('button', { name: 'Navigation tabs', exact: true })
      const surface = page.getByRole(width === 390 ? 'dialog' : 'menu', { name: 'Navigation tabs', exact: true })
      const check = name => surface.getByRole(width === 390 ? 'checkbox' : 'menuitemcheckbox', { name, exact: true })
      if (width === 1440) await page.getByRole('tablist', { name: 'Navigation', exact: true }).click({ button: 'right' })
      else await trigger.click()
      await expect(check('Sessions')).toBeChecked()
      await check('Sessions').click()
      await expect(surface).toBeVisible()
      await expect(check('Sessions')).not.toBeChecked()
      await expect(check('Bots')).toBeDisabled()
      await expect(page.getByRole('tab', { name: 'Bots', exact: true, includeHidden: true })).toHaveAttribute('aria-selected', 'true')
      await expect(page.getByRole('tab', { name: 'Sessions', exact: true, includeHidden: true })).toHaveCount(0)
      await check('Sessions').click()
      await check('Bots').click()
      await expect(check('Sessions')).toBeDisabled()
      await expect(page.getByRole('tab', { name: 'Sessions', exact: true, includeHidden: true })).toHaveAttribute('aria-selected', 'true')
      const bounds = await surface.boundingBox()
      expect(bounds.x).toBeGreaterThanOrEqual(-1)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1)
      expect(bounds.y).toBeGreaterThanOrEqual(0)
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(961)
      await page.keyboard.press('Escape')
      await expect(surface).toHaveCount(0)
      await expect(trigger).toBeFocused()
      if (width === 390) {
        await expect(page.locator('.browser-navigation.is-open')).toBeVisible()
        await page.getByRole('button', { name: 'Hide navigation', exact: true }).click()
      }
      await expect(page).toHaveURL(/#\/preview-week$/)
      await expect(editor(page)).toHaveText('Keep this draft while arranging navigation')
      await page.reload()
      await expect(editor(page)).toBeVisible()
      if (width === 390) await openNavigation(page)
      await expect(page.getByRole('tab', { name: 'Sessions', exact: true, includeHidden: true })).toHaveAttribute('aria-selected', 'true')
      await expect(page.getByRole('tab', { name: 'Bots', exact: true, includeHidden: true })).toHaveCount(0)
      await trigger.click()
      await check('Bots').click()
      if (width === 390) await surface.getByRole('button', { name: 'Done', exact: true }).click()
      else await page.keyboard.press('Escape')
      await expect(surface).toHaveCount(0)
      await expect(trigger).toBeFocused()
      await page.getByRole('tab', { name: 'Sessions', exact: true, includeHidden: true }).focus()
      await page.keyboard.press('ArrowRight')
      await expect(page.getByRole('tab', { name: 'Bots', exact: true, includeHidden: true })).toBeFocused()
      await page.keyboard.press('ArrowLeft')
      await expect(page.getByRole('tab', { name: 'Sessions', exact: true, includeHidden: true })).toBeFocused()
      if (width === 390) await page.getByRole('button', { name: 'Hide navigation', exact: true }).click()
      await expect(editor(page)).toHaveText('Keep this draft while arranging navigation')
    })
  }
}

test('navigation resizing follows the pointer at UI scale and persists keyboard changes', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 })
  await open(page)
  await page.evaluate(() => window.hermesDesktop.zoom.setPercent(150))
  await editor(page).fill('Keep this draft while resizing')
  const navigation = page.locator('#browser-navigation')
  const resizer = page.getByRole('separator', { name: 'Resize navigation panel', exact: true })
  const before = await navigation.boundingBox(), handle = await resizer.boundingBox()
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await page.mouse.down()
  await page.mouse.move(handle.x + handle.width / 2 + 90, handle.y + handle.height / 2, { steps: 10 })
  await page.mouse.up()
  expect((await navigation.boundingBox()).width - before.width).toBeCloseTo(90, 0)
  await resizer.focus()
  await page.keyboard.press('End')
  await expect(resizer).toHaveAttribute('aria-valuenow', '560')
  await page.keyboard.press('ArrowRight')
  await expect(resizer).toHaveAttribute('aria-valuenow', '560')
  await page.keyboard.press('Home')
  await expect(resizer).toHaveAttribute('aria-valuenow', '224')
  await page.keyboard.press('ArrowRight')
  await expect(resizer).toHaveAttribute('aria-valuenow', '240')
  await page.reload()
  await expect(editor(page)).toHaveText('Keep this draft while resizing')
  await expect(resizer).toHaveAttribute('aria-valuenow', '240')
})

test('profile context menus stay beside their originating profile', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 })
  await open(page)
  const profile = page.locator('.browser-profile-choice[draggable="true"]').first()
  await expect(profile).toBeVisible()
  const origin = await profile.boundingBox()
  await profile.click({ button: 'right' })
  const menu = page.getByRole('menu', { name: 'Profile actions', exact: true })
  await expect(menu).toBeVisible()
  const position = await menu.boundingBox()
  expect(origin).not.toBeNull()
  expect(position).not.toBeNull()
  expect(Math.abs(position.x - origin.x)).toBeLessThan(120)
  expect(Math.abs(position.y - origin.y)).toBeLessThan(140)
})

test('profiles can reorder and hide the default Hermes profile', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 })
  await open(page)
  const hermes = page.getByRole('button', { name: 'Hermes', exact: true })
  const writer = page.getByRole('button', { name: 'Writer', exact: true })
  await hermes.hover()
  await expect(page.locator('[data-slot="tooltip-content"]', { hasText: 'Hermes' })).toBeVisible()
  await expect(hermes).toHaveAttribute('draggable', 'true')
  const writerSize = await writer.evaluate(el => ({ width: el.clientWidth, height: el.clientHeight }))
  await hermes.dragTo(writer, { targetPosition: { x: writerSize.width * .8, y: writerSize.height / 2 } })
  const profileOrder = await page.locator('.browser-profile-choice[draggable="true"]').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')))
  expect(profileOrder).toEqual(['Research', 'Writer', 'Hermes'])

  await hermes.click({ button: 'right' })
  const menu = page.getByRole('menu', { name: 'Profile actions', exact: true })
  await expect(menu.getByRole('menuitem', { name: 'Hide profile', exact: true })).toBeVisible()
  await menu.getByRole('menuitem', { name: 'Hide profile', exact: true }).click()
  await expect(hermes).toHaveCount(0)

  await page.locator('.browser-profile-rail').click({ button: 'right' })
  await page.getByRole('menu', { name: 'Profile actions', exact: true }).getByRole('menuitem', { name: 'Show hidden', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Hermes', exact: true })).toBeVisible()
})

for (const width of [1440]) {
  test(`profile gap drops stay stable and persist at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 })
    await open(page)
    if (width === 390) await openNavigation(page)
    const profiles = page.locator('.browser-profile-choice[draggable="true"]')
    const rail = page.locator('.browser-profile-rail')
    const marker = rail.locator('.browser-profile-drop-indicator')
    const names = () => profiles.evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')))
    const beginDrag = async (source, x, y) => {
      const bounds = await source.boundingBox()
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
      await page.mouse.down()
      await page.mouse.move(x, y, { steps: 12 })
      await page.mouse.move(x, y)
    }
    let expected
    for (const scale of [100, 125, 150]) {
      await page.evaluate(percent => window.hermesDesktop.zoom.setPercent(percent), scale)
      const original = await names()
      const first = await profiles.nth(0).boundingBox(), second = await profiles.nth(1).boundingBox()
      const gapX = (first.x + first.width + second.x) / 2
      const y = second.y + second.height / 2
      await beginDrag(profiles.nth(2), second.x + second.width * .2, y)
      await expect(marker).toBeVisible()
      // A preview must not shift the avatar or change which side the pointer is on.
      expect((await profiles.nth(1).boundingBox()).x).toBeCloseTo(second.x, 1)
      await page.mouse.move(gapX, y)
      await page.mouse.move(gapX, y)
      await expect(marker).toBeVisible()
      await page.mouse.up()
      expected = [original[0], original[2], original[1]]
      await expect.poll(names).toEqual(expected)
      await expect(marker).toHaveCount(0)

      // Reverse direction into the leading gap, then cancel a further drag.
      const all = await page.getByRole('button', { name: 'All profiles', exact: true }).boundingBox()
      const leading = await profiles.first().boundingBox()
      await beginDrag(profiles.last(), (all.x + all.width + leading.x) / 2, y)
      await expect(marker).toBeVisible()
      await page.mouse.up()
      expected = [original[1], original[0], original[2]]
      await expect.poll(names).toEqual(expected)
      const end = await page.locator('.browser-profile-drop-end').boundingBox()
      // Aim inside the visible trailing space at every UI scale.
      await beginDrag(profiles.first(), Math.min(end.x + end.width / 2, width - 2), y)
      await expect(marker).toBeVisible()
      await page.keyboard.press('Escape')
      await page.mouse.up()
      await expect(marker).toHaveCount(0)
      expect(await names()).toEqual(expected)
    }
    await page.reload()
    await expect(editor(page)).toBeVisible()
    if (width === 390) await openNavigation(page)
    await expect.poll(names).toEqual(expected)
  })

  test(`profile end drop shows an indicator and saves the order at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 960 })
    await open(page)
    if (width === 390) await openNavigation(page)
    const source = page.getByRole('button', { name: 'Hermes', exact: true })
    const writer = page.getByRole('button', { name: 'Writer', exact: true })
    const end = page.locator('.browser-profile-drop-end')
    const indicator = end.locator('.browser-profile-drop-indicator')
    const from = await source.boundingBox(), last = await writer.boundingBox(), target = await end.boundingBox()
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    // Both the trailing half of the last avatar and the empty space after it
    // must preview the same insertion position.
    await page.mouse.move(last.x + last.width * .8, last.y + last.height / 2, { steps: 10 })
    await page.mouse.move(last.x + last.width * .8, last.y + last.height / 2)
    await expect(indicator).toBeVisible()
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 5 })
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2)
    await expect(indicator).toBeVisible()
    const marker = await indicator.boundingBox()
    expect(marker.x).toBeGreaterThanOrEqual(last.x + last.width)
    await page.screenshot({ path: testInfo.outputPath('profile-end-indicator.png') })
    await page.mouse.up()
    await expect(indicator).toHaveCount(0)
    const order = page.locator('.browser-profile-choice[draggable="true"]')
    expect(await order.evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')))).toEqual(['Research', 'Writer', 'Hermes'])
    await page.reload()
    await expect(editor(page)).toBeVisible()
    if (width === 390) await openNavigation(page)
    expect(await order.evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')))).toEqual(['Research', 'Writer', 'Hermes'])
  })
}

for (const width of [390, 1440]) {
  for (const scale of [100, 150]) {
    test(`profile actions preserve drafts and focus at ${width}px and ${scale}%`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 960 })
      await open(page)
      await page.evaluate(percent => window.hermesDesktop.zoom.setPercent(percent), scale)
      await editor(page).fill('Keep this profile actions draft')
      if (width === 390) await openNavigation(page)
      const trigger = page.getByRole('button', { name: 'Profile actions', exact: true })
      const surface = page.getByRole(width === 390 ? 'dialog' : 'menu', { name: 'Profile actions', exact: true })
      const actionRole = width === 390 ? 'button' : 'menuitem'
      await trigger.click()
      await expect(surface.getByRole(actionRole, { name: 'Show hidden', exact: true })).toBeDisabled()
      await page.screenshot({ path: testInfo.outputPath('profile-actions.png') })
      const bounds = await surface.boundingBox()
      expect(bounds.x).toBeGreaterThanOrEqual(-1)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1)
      expect(bounds.y).toBeGreaterThanOrEqual(0)
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(961)
      if (width === 390) {
        expect(bounds.y + bounds.height).toBeGreaterThan(950)
        // The sheet traps Tab; its Escape must leave navigation open.
        await surface.getByRole('button', { name: 'Cancel', exact: true }).focus()
        await page.keyboard.press('Tab')
        await expect(surface.getByRole('button', { name: 'Hide Hermes', exact: true })).toBeFocused()
      }
      await page.keyboard.press('Escape')
      await expect(surface).toHaveCount(0)
      await expect(trigger).toBeFocused()
      await trigger.click()
      await surface.getByRole(actionRole, { name: 'Hide Writer', exact: true }).click()
      await expect(page.locator('[data-profile-key="writer"]')).toHaveCount(0)
      await expect(trigger).toBeFocused()
      await trigger.click()
      await surface.getByRole(actionRole, { name: 'Show hidden', exact: true }).click()
      await expect(page.locator('[data-profile-key="writer"]')).toBeVisible()
      await expect(trigger).toBeFocused()
      if (width === 390) await page.getByRole('button', { name: 'Hide navigation', exact: true }).click()
      else {
        await trigger.click()
        await editor(page).click()
        await expect(editor(page)).toBeFocused()
      }
      await expect(editor(page)).toHaveText('Keep this profile actions draft')
    })
  }
}

test.describe('touch profile controls', () => {
  test.use({ hasTouch: true })
  test('profile actions work with taps without changing the conversation', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await open(page)
    await editor(page).fill('Keep the touch draft')
    await page.getByRole('button', { name: 'Open navigation', exact: true }).tap()
    const trigger = page.getByRole('button', { name: 'Profile actions', exact: true })
    const sheet = page.getByRole('dialog', { name: 'Profile actions', exact: true })
    await trigger.tap()
    await sheet.getByRole('button', { name: 'Hide Research', exact: true }).tap()
    await expect(page.locator('[data-profile-key="research"]')).toHaveCount(0)
    await trigger.tap()
    await sheet.getByRole('button', { name: 'Show hidden', exact: true }).tap()
    await expect(page.locator('[data-profile-key="research"]')).toBeVisible()
    await page.getByRole('button', { name: 'Hide navigation', exact: true }).tap()
    await expect(page).toHaveURL(/#\/preview-week$/)
    await expect(editor(page)).toHaveText('Keep the touch draft')
  })
})

test('phone profiles retain saved desktop order and reject drag operations', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('hermes.desktop.profileOrder', JSON.stringify(['writer', 'default', 'research'])))
  await page.setViewportSize({ width: 390, height: 844 })
  await open(page)
  await openNavigation(page)
  const profiles = page.locator('[data-profile-key]')
  const names = () => profiles.evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')))
  await expect.poll(names).toEqual(['Writer', 'Hermes', 'Research'])
  for (const profile of await profiles.all()) await expect(profile).toHaveAttribute('draggable', 'false')
  // Even a synthetic drag cannot call the reorder command on a phone.
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer())
  await profiles.first().dispatchEvent('dragstart', { dataTransfer })
  await page.locator('.browser-profile-rail').dispatchEvent('drop', { dataTransfer, clientX: 350 })
  expect(await names()).toEqual(['Writer', 'Hermes', 'Research'])
  await expect(page.locator('.browser-profile-drop-indicator')).toHaveCount(0)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hermes.desktop.profileOrder')))).toEqual(['writer', 'default', 'research'])
  await page.setViewportSize({ width: 1440, height: 960 })
  for (const profile of await profiles.all()) await expect(profile).toHaveAttribute('draggable', 'true')
  expect(await names()).toEqual(['Writer', 'Hermes', 'Research'])
})

test('full-page browser routes open as modals and return to the chat', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await open(page)
  await openNavigation(page)
  await page.getByRole('button', { name: 'More', exact: true }).click()
  await page.getByRole('group', { name: 'More controls', exact: true }).getByRole('button', { name: 'Capabilities', exact: true }).click()
  await expect(page).toHaveURL(/#\/skills$/)
  await expect(page.locator('[data-overlay-surface]:visible').filter({ hasText: 'Skills' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(/#\/preview-week$/)
  await expect(editor(page)).toBeVisible()
})

for (const [width, scale] of [[390, 100], [390, 150], [1440, 100], [1440, 150]]) {
  test(`tool modals retain the mounted composer and unsent attachments at ${width}px and ${scale}%`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 })
    await open(page)
    await page.evaluate(value => window.hermesDesktop.zoom.setPercent(value), scale)
    await editor(page).fill('Keep the same composer and its attachment')
    await editor(page).evaluate(node => { window.modalComposer = node })
    await page.getByRole('button', { name: 'Add context', exact: true }).click()
    const picker = page.waitForEvent('filechooser')
    await page.getByRole('menuitem', { name: 'Files…', exact: true }).click()
    await (await picker).setFiles({ name: 'modal-draft.txt', mimeType: 'text/plain', buffer: Buffer.from('Keep this unsent file through tool navigation.') })
    const attachment = page.getByRole('button', { name: 'Remove modal-draft.txt', exact: true })
    await expect(attachment).toBeVisible()
    for (const [label, path] of [['Capabilities', 'skills'], ['Messaging', 'messaging'], ['Artifacts', 'artifacts']]) {
      if (width === 390) await openNavigation(page)
      const extras = page.getByRole('group', { name: 'More controls', exact: true })
      if (!await extras.isVisible()) await page.getByRole('button', { name: 'More', exact: true }).click()
      await extras.getByRole('button', { name: label, exact: true }).click()
      await expect(page).toHaveURL(new RegExp('#/' + path + '$'))
      await expect(page.locator('[data-overlay-surface]')).toHaveCount(1)
      expect(await page.evaluate(() => window.modalComposer.isConnected)).toBe(true)
      await expect(page.locator('[aria-label="Message"][contenteditable="true"]')).toHaveCount(1)
      await expect(page.locator('.browser-upstream-workspace')).toHaveAttribute('inert', '')
      await expect(page.locator('[data-slot="composer-attachments"]').getByText('modal-draft.txt', { exact: true })).toHaveCount(1)
      await page.keyboard.press('Escape')
      await expect(page).toHaveURL(/#\/preview-week$/)
      await expect(editor(page)).toHaveText('Keep the same composer and its attachment')
      expect(await editor(page).evaluate(node => node === window.modalComposer)).toBe(true)
      await expect(attachment).toBeVisible()
    }
    await page.getByRole('button', { name: 'Open settings menu', exact: true }).click()
    await page.getByRole(width === 390 ? 'button' : 'menuitem', { name: 'Settings', exact: true }).click()
    await expect(page.getByText('Appearance', { exact: true }).first()).toBeVisible()
    expect(await page.evaluate(() => window.modalComposer.isConnected)).toBe(true)
    await page.keyboard.press('Escape')
    await expect(attachment).toBeVisible()
    expect(await editor(page).evaluate(node => node === window.modalComposer)).toBe(true)
    await editor(page).focus()
    await page.keyboard.press('Control+k')
    await expect(page.getByRole('combobox')).toBeFocused()
    expect(await page.evaluate(() => window.modalComposer.isConnected)).toBe(true)
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-overlay-surface]')).toHaveCount(0)
    await expect(editor(page)).toBeFocused()
    await expect(attachment).toBeVisible()
    expect(await editor(page).evaluate(node => node === window.modalComposer)).toBe(true)
  })
}

test('tool modals preserve an active microphone recording until explicit stop', async ({ page }) => {
  let audio
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.route(/\/api\/audio\/transcribe(?:\?|$)/, async route => {
    audio = route.request().postDataJSON()
    await route.fulfill({ json: { ok: true, transcript: 'Recorded across a tool modal' } })
  })
  await page.addInitScript(() => {
    window.modalStreams = []
    const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    navigator.mediaDevices.getUserMedia = async constraints => {
      const stream = await capture(constraints)
      window.modalStreams.push(stream)
      return stream
    }
  })
  await open(page)
  await editor(page).evaluate(node => { window.modalComposer = node })
  await page.getByRole('button', { name: 'Voice dictation', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Stop dictation', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'More', exact: true }).click()
  await page.getByRole('group', { name: 'More controls', exact: true }).getByRole('button', { name: 'Capabilities', exact: true }).click()
  await expect(page.locator('[data-overlay-surface]')).toHaveCount(1)
  expect(await page.evaluate(() => window.modalComposer.isConnected)).toBe(true)
  expect(await page.evaluate(() => window.modalStreams.length === 1 && window.modalStreams[0].getAudioTracks()[0].readyState === 'live')).toBe(true)
  expect(audio).toBeUndefined()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Stop dictation', exact: true }).click()
  await expect(editor(page)).toContainText('Recorded across a tool modal')
  expect(audio.data_url).toMatch(/^data:audio\/.+;base64,.+/)
  expect(await page.evaluate(() => window.modalStreams[0].getTracks().every(track => track.readyState === 'ended'))).toBe(true)
  expect(await editor(page).evaluate(node => node === window.modalComposer)).toBe(true)
})

test('tool modal history preserves query state and cold entry closes to a usable chat', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 })
  await open(page)
  await page.goto(`${origin}/#/preview-week?keep=query#anchor`)
  await expect(editor(page)).toBeVisible()
  await editor(page).fill('Keep this history draft')
  await editor(page).evaluate(node => { window.modalComposer = node })
  await page.getByRole('button', { name: 'More', exact: true }).click()
  await page.getByRole('group', { name: 'More controls', exact: true }).getByRole('button', { name: 'Capabilities', exact: true }).click()
  await expect(page).toHaveURL(/#\/skills$/)
  await page.goBack()
  await expect(page).toHaveURL(/#\/preview-week\?keep=query#anchor$/)
  expect(await editor(page).evaluate(node => node === window.modalComposer)).toBe(true)
  await page.goForward()
  await expect(page.locator('[data-overlay-surface]')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(/#\/preview-week\?keep=query#anchor$/)
  await expect(editor(page)).toHaveText('Keep this history draft')
  expect(await editor(page).evaluate(node => node === window.modalComposer)).toBe(true)
  await page.goto(`${origin}/#/skills`)
  // Hash navigation keeps the document alive; reload proves cold route entry.
  await page.reload()
  await expect(page.locator('[data-overlay-surface]')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(/#\/$/)
  await expect(editor(page)).toBeEditable()
})

test('startup chunk recovery retries once and keeps the selected route', async ({ page }) => {
  let failed = false
  await page.route('**/assets/entry-*.js', async route => {
    if (!failed) { failed = true; await route.abort('failed') } else await route.continue()
  })
  await open(page, 'preview-idea')
  expect(failed).toBe(true)
  await expect(page).toHaveURL(/#\/preview-idea$/)
  await expect(page.getByText('A useful starting point', { exact: false })).toBeVisible()
})

test('entry failure leaves the independent recovery surface visible', async ({ page }) => {
  await page.route('**/assets/entry-*.js', route => route.abort('failed'))
  await page.goto(`${origin}/#/preview-week`, { waitUntil: 'domcontentloaded' })
  await expect(page.locator('.hermes-startup-recovery')).toBeVisible({ timeout: 10000 })
  await expect(page.getByRole('heading', { name: 'Hermes could not load the browser interface.' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible()
})

test('bundled emoji data is available to browser pickers', async ({ request }) => {
  const response = await request.get(`${origin}/emojibase/en/data.json`)
  expect(response.ok()).toBe(true)
  const data = await response.json()
  expect(data.some(emoji => emoji.hexcode === '1F600')).toBe(true)
  for (const file of ['messages.json', 'shortcodes/emojibase.json']) {
    const resource = await request.get(`${origin}/emojibase/en/${file}`)
    expect(resource.ok()).toBe(true)
    expect(Object.keys(await resource.json()).length).toBeGreaterThan(0)
  }
})

for (const width of [390, 1440]) {
  for (const scale of [100, 150]) {
    test(`Bots shared actions preserve filters, focus, and drafts at ${width}px and ${scale}%`, async ({ page }, testInfo) => {
      const errors = installBrowserErrorCollector(page)
      await page.setViewportSize({ width, height: 960 })
      await open(page)
      await page.evaluate(value => window.hermesDesktop.zoom.setPercent(value), scale)
      await editor(page).fill('Keep my draft while arranging Bots')
      if (width === 390) await openNavigation(page)
      await page.getByRole('tab', { name: 'Bots', exact: true }).click()
      const filter = page.getByRole('button', { name: /^Filter roster/ })
      const surface = page.getByRole(width === 390 ? 'dialog' : 'menu', { name: 'Filter Bots', exact: true })
      const radio = width === 390 ? 'radio' : 'menuitemradio'
      await filter.click()
      await expect(surface.getByRole(radio, { name: 'Bots and group chats', exact: true })).toHaveAttribute('aria-checked', 'true')
      await surface.getByRole(radio, { name: 'Bots and group chats', exact: true }).focus()
      if (width === 390) await page.keyboard.press('End')
      else {
        await page.keyboard.press('ArrowDown')
        await expect(surface.getByRole(radio, { name: 'Bots only', exact: true })).toBeFocused()
        await page.keyboard.press('ArrowDown')
        await expect(surface.getByRole(radio, { name: 'Group chats only', exact: true })).toBeFocused()
        await page.keyboard.press('Enter')
      }
      await expect(surface.getByRole(radio, { name: 'Group chats only', exact: true })).toHaveAttribute('aria-checked', 'true')
      await surface.getByRole(radio, { name: 'Active now', exact: true }).click()
      await page.keyboard.press('Escape')
      await expect(filter).toHaveAccessibleName('Filter roster, 2 active')
      await expect(surface).toHaveCount(0)
      await expect(filter).toBeFocused()
      await filter.click()
      await expect(surface.getByRole(radio, { name: 'Group chats only', exact: true })).toHaveAttribute('aria-checked', 'true')
      await expect(surface.getByRole(radio, { name: 'Active now', exact: true })).toHaveAttribute('aria-checked', 'true')
      await surface.getByRole(width === 390 ? 'button' : 'menuitem', { name: 'Clear filters', exact: true }).click()
      await expect(surface.getByRole(radio, { name: 'Bots and group chats', exact: true })).toHaveAttribute('aria-checked', 'true')
      await expect(surface.getByRole(radio, { name: 'Any activity', exact: true })).toHaveAttribute('aria-checked', 'true')
      await page.screenshot({ path: testInfo.outputPath('bots-filters.png') })
      const box = await surface.boundingBox()
      expect(box.x).toBeGreaterThanOrEqual(-1)
      expect(box.x + box.width).toBeLessThanOrEqual(width + 1)
      expect(box.y).toBeGreaterThanOrEqual(-1)
      expect(box.y + box.height).toBeLessThanOrEqual(961)
      await page.keyboard.press('Escape')
      await expect(filter).toBeFocused()
      await expect(filter).toHaveAccessibleName('Filter roster')
      await expect(page.getByRole('button', { name: /Research · @/ })).toBeVisible()
      const add = page.getByRole('button', { name: 'New bot or group chat', exact: true })
      for (const title of ['New bot', 'New group chat', 'New section']) {
        await add.click()
        const create = page.getByRole(width === 390 ? 'dialog' : 'menu', { name: 'New bot or group chat', exact: true })
        await create.getByRole(width === 390 ? 'button' : 'menuitem', { name: title, exact: true }).click()
        const dialog = page.getByRole('dialog', { name: title, exact: true })
        await expect(dialog).toBeVisible()
        const fitsViewport = async () => {
          const bounds = await dialog.boundingBox()
          return bounds && bounds.x >= -1 && bounds.y >= -1 && bounds.x + bounds.width <= width + 1 && bounds.y + bounds.height <= 961
        }
        await expect.poll(fitsViewport, { message: `${title} fits the scaled viewport` }).toBe(true)
        if (title === 'New bot') {
          await dialog.getByRole('button', { name: 'Advanced', exact: true }).click()
          await expect.poll(fitsViewport, { message: 'Advanced Bot settings fit the scaled viewport' }).toBe(true)
          await page.screenshot({ path: testInfo.outputPath('bot-creation.png') })
        }
        await expect(create).toHaveCount(0)
        await expect.poll(() => dialog.evaluate(el => el.contains(document.activeElement))).toBe(true)
        await page.keyboard.press('Escape')
        await expect(dialog).toHaveCount(0)
        await expect(add).toBeFocused()
      }
      if (width === 390) await expect(page.locator('.browser-navigation.is-open')).toBeVisible()
      await page.getByRole('tab', { name: 'Sessions', exact: true }).click()
      if (width === 390) await page.getByRole('button', { name: 'Hide navigation', exact: true }).click()
      await expect(editor(page)).toHaveText('Keep my draft while arranging Bots')
      await expect(page).toHaveURL(/#\/preview-week$/)
      errors.assertClean()
    })
  }
}

test.describe('touch Bots controls', () => {
  test.use({ hasTouch: true })
  test('Bots filters and creation controls work with taps', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await open(page)
    await editor(page).fill('Keep this touch Bots draft')
    await page.getByRole('button', { name: 'Open navigation', exact: true }).tap()
    await page.getByRole('tab', { name: 'Bots', exact: true }).tap()
    const filter = page.getByRole('button', { name: /^Filter roster/ })
    await filter.tap()
    const sheet = page.getByRole('dialog', { name: 'Filter Bots', exact: true })
    await sheet.getByRole('radio', { name: 'Bots only', exact: true }).tap()
    await sheet.getByRole('button', { name: 'Done', exact: true }).tap()
    await expect(filter).toHaveAccessibleName('Filter roster, 1 active')
    await filter.tap()
    await sheet.getByRole('checkbox', { name: 'Show hidden bots', exact: true }).tap()
    await expect(sheet.getByRole('checkbox', { name: 'Show hidden bots', exact: true })).toHaveAttribute('aria-checked', 'true')
    await sheet.getByRole('button', { name: 'Done', exact: true }).tap()
    const add = page.getByRole('button', { name: 'New bot or group chat', exact: true })
    await add.tap()
    await page.getByRole('dialog', { name: 'New bot or group chat', exact: true }).getByRole('button', { name: 'New section', exact: true }).tap()
    const dialog = page.getByRole('dialog', { name: 'New section', exact: true })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).tap()
    await expect(add).toBeFocused()
    await page.getByRole('button', { name: 'Hide navigation', exact: true }).tap()
    await expect(editor(page)).toHaveText('Keep this touch Bots draft')
    await expect(page).toHaveURL(/#\/preview-week$/)
  })
})

test('hidden Bot visibility commands update the existing session-only preference', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 })
  await open(page)
  await page.getByRole('tab', { name: 'Bots', exact: true }).click()
  const filter = page.getByRole('button', { name: 'Filter roster', exact: true })
  const toggle = page.getByRole('menuitemcheckbox', { name: 'Show hidden bots', exact: true })
  await filter.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('Escape')
  await page.getByRole('tab', { name: 'Sessions', exact: true }).click()
  await page.getByRole('tab', { name: 'Bots', exact: true }).click()
  await filter.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('Escape')
  await page.reload()
  await expect(filter).toBeVisible({ timeout: 30000 })
  await filter.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
})

for (const width of [390, 1440]) {
  for (const scale of [100, 150]) {
    test(`roster row actions preserve touch access, sections, focus, and drafts at ${width}px and ${scale}%`, async ({ page }, testInfo) => {
      const errors = installBrowserErrorCollector(page)
      await page.setViewportSize({ width, height: 960 })
      await open(page)
      await page.evaluate(value => window.hermesDesktop.zoom.setPercent(value), scale)
      await editor(page).fill('Keep my draft while organizing rows')
      if (width === 390) await openNavigation(page)
      await page.getByRole('tab', { name: 'Bots', exact: true }).click()
      const trigger = page.getByRole('button', { name: 'Actions for Research', exact: true })
      const surface = page.getByRole(width === 390 ? 'dialog' : 'menu', { name: 'Actions for Research', exact: true })
      const item = (name) => surface.getByRole(width === 390 ? 'button' : 'menuitem', { name, exact: true })
      await trigger.click()
      await expect(item('Pin to top')).toBeVisible()
      await item('Pin to top').click()
      await trigger.click()
      await expect(item('Unpin')).toBeVisible()
      await item('Unpin').click()
      await trigger.focus()
      await page.keyboard.press('Shift+F10')
      await expect(surface).toBeVisible()
      const box = await surface.boundingBox()
      expect(box.x).toBeGreaterThanOrEqual(-1)
      expect(box.x + box.width).toBeLessThanOrEqual(width + 1)
      expect(box.y).toBeGreaterThanOrEqual(-1)
      expect(box.y + box.height).toBeLessThanOrEqual(961)
      await page.screenshot({ path: testInfo.outputPath('roster-actions.png') })
      await page.keyboard.press('Escape')
      await expect(trigger).toBeFocused()
      for (const [action, title] of [['Edit…', 'Edit profile'], ['Manage groups…', 'Manage groups'], ['Delete', 'Delete bot and profile?']]) {
        await trigger.click()
        await item(action).click()
        const dialog = page.getByRole('dialog', { name: title, exact: true })
        await expect(dialog).toBeVisible()
        await expect(surface).toHaveCount(0)
        const bounds = await dialog.boundingBox()
        expect(bounds.x).toBeGreaterThanOrEqual(-1)
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1)
        expect(bounds.y).toBeGreaterThanOrEqual(-1)
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(961)
        await page.keyboard.press('Escape')
        await expect(dialog).toHaveCount(0)
        await expect(trigger).toBeFocused()
      }
      await trigger.click()
      await item('New section…').click()
      const create = page.getByRole('dialog', { name: 'New section', exact: true })
      await create.getByRole('textbox').fill('Row work')
      await create.getByRole('button', { name: 'Create', exact: true }).click()
      const section = page.locator('.browser-roster-action-row[data-section-id]').filter({ has: page.getByRole('button', { name: 'Actions for Row work', exact: true }) })
      await expect(section).toBeVisible()
      await expect(trigger).toBeFocused()
      await expect(section.locator('..').getByRole('button', { name: /Research · @/ })).toBeVisible()
      await section.getByRole('button', { name: 'Actions for Row work', exact: true }).click()
      const sectionActions = page.getByRole(width === 390 ? 'dialog' : 'menu', { name: 'Actions for Row work', exact: true })
      await sectionActions.getByRole(width === 390 ? 'button' : 'menuitem', { name: 'Rename', exact: true }).click()
      const rename = page.getByRole('dialog', { name: 'Rename section', exact: true })
      await rename.getByRole('textbox').fill('Renamed work')
      await rename.getByRole('button', { name: 'Save', exact: true }).click()
      const renamed = page.getByRole('button', { name: 'Actions for Renamed work', exact: true })
      await expect(renamed).toBeFocused()
      await renamed.click()
      await page.getByRole(width === 390 ? 'dialog' : 'menu', { name: 'Actions for Renamed work', exact: true }).getByRole(width === 390 ? 'button' : 'menuitem', { name: 'Delete', exact: true }).click()
      await expect(renamed).toHaveCount(0)
      await expect(page.getByRole('tab', { name: 'Bots', exact: true })).toBeFocused()
      await expect(trigger).toBeVisible()
      await page.getByRole('tab', { name: 'Sessions', exact: true }).click()
      if (width === 390) await page.getByRole('button', { name: 'Hide navigation', exact: true }).click()
      await expect(editor(page)).toHaveText('Keep my draft while organizing rows')
      await expect(page).toHaveURL(/#\/preview-week$/)
      errors.assertClean()
    })
  }
}
