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
  await expect(page.getByRole('main', { name: 'Conversation and workspace' })).toBeHidden()
  await expect(page.getByRole('dialog', { name: 'Navigation' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Back to chat', exact: true })).toBeFocused()
  // Let the full-page transition finish before measuring touch targets.
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

test('phone navigation and action sheets keep touch targets usable across UI scale', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await open(page)
  const expectTouchTarget = async (name, control, minSize = 44) => {
    const bounds = await control.boundingBox()
    expect(bounds, `${name} is visible`).not.toBeNull()
    expect(bounds.width, `${name} width`).toBeGreaterThanOrEqual(minSize)
    expect(bounds.height, `${name} height`).toBeGreaterThanOrEqual(minSize)
  }
  const trigger = page.getByRole('button', { name: 'Open navigation', exact: true })
  for (const scale of [50, 75, 100, 125, 150]) {
    await page.evaluate(percent => window.hermesDesktop.zoom.setPercent(percent), scale)
    for (const [name, control] of [
      ['Add context', page.getByRole('button', { name: 'Add context', exact: true })],
      ['Model', page.getByRole('button', { name: /^Model/ })],
      ['Voice conversation', page.getByRole('button', { name: /^Start voice conversation/ })]
    ]) {
      await expectTouchTarget(`${name} at ${scale}%`, control)
      const bounds = await control.boundingBox()
      expect(bounds.x + bounds.width, `${name} remains within 390px`).toBeLessThanOrEqual(391)
    }
    const approval = page.locator('.browser-approval-control > button:visible')
    if (await approval.count()) await expectTouchTarget(`Approval control at ${scale}%`, approval.first())
    const messageAction = page.locator('.browser-main :has(> button[aria-label="Branch in new chat"])').first()
    await expect(messageAction, `Message actions exist at ${scale}%`).toHaveCount(1)
    await expect(messageAction, `Message actions are directly available by touch at ${scale}%`).toBeVisible()
    for (const label of ['Branch in new chat', 'Copy', 'Read aloud', 'Refresh']) {
      const action = messageAction.getByRole('button', { name: label, exact: true })
      if (await action.count()) await expectTouchTarget(`${label} message action at ${scale}%`, action)
    }
    for (const label of ['Copy path', 'New branch']) {
      const action = page.locator(`.browser-main .status-row button[aria-label="${label}"]`)
      await expect(action, `${label} exists at ${scale}%`).toHaveCount(1)
      await expect(action, `${label} is available without hover at ${scale}%`).toBeVisible()
      await expectTouchTarget(`${label} at ${scale}%`, action.first())
    }
    await trigger.click()
    const nav = page.getByRole('dialog', { name: 'Navigation' })
    await expect(nav).toBeVisible()
    await expect(page.getByRole('main', { name: 'Conversation and workspace' })).toBeHidden()
    if (scale === 50) {
      const backToChat = page.getByRole('button', { name: 'Back to chat', exact: true })
      await expect(backToChat).toBeFocused()
      await page.keyboard.press('Shift+Tab')
      await expect.poll(() => nav.evaluate(element => element.contains(document.activeElement))).toBe(true)
      await page.keyboard.press('Tab')
      await expect(backToChat).toBeFocused()
    }
    for (const [name, control] of [
      ['Back to chat', page.getByRole('button', { name: 'Back to chat', exact: true })],
      ['Sessions tab', page.getByRole('tab', { name: 'Sessions', exact: true })],
      ['Sessions section toggle', nav.locator('.browser-sessions-pane [data-browser-section-label]').first()],
      ['Profile actions', page.getByRole('button', { name: 'Profile actions', exact: true })]
    ]) {
      await expectTouchTarget(`${name} at ${scale}%`, control)
    }
    for (const [name, controls] of [
      ['Navigation action', nav.locator('.browser-navigation-body [data-sidebar="menu-button"]:visible')],
      ['Session row', nav.locator('.browser-sessions-pane button[data-slot="row-button"]:visible')],
      ['Session search', nav.locator('.browser-sessions-pane .browser-session-search:visible')],
      ['New session', nav.locator('.browser-sessions-pane button[aria-label="New session"]:visible')],
      ['Session filters', nav.locator('.browser-sessions-pane button[aria-label="Filters"]:visible')],
      ['Session reorder handle', nav.locator('.browser-sessions-pane [class*="group/handle"]:visible')]
    ]) {
      const targets = await controls.all()
      expect(targets.length, `${name} exists at ${scale}%`).toBeGreaterThan(0)
      for (const [index, control] of targets.entries()) await expectTouchTarget(`${name} ${index + 1} at ${scale}%`, control)
    }
    const profileActions = page.getByRole('button', { name: 'Profile actions', exact: true })
    await profileActions.click()
    const sheet = page.getByRole('dialog', { name: 'Profile actions', exact: true })
    await expect(sheet).toBeVisible()
    const bounds = await sheet.boundingBox()
    expect(bounds.x).toBeGreaterThanOrEqual(-1)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(391)
    expect(bounds.y + bounds.height).toBeGreaterThanOrEqual(840)
    const option = sheet.getByRole('button', { name: 'Hide Research', exact: true })
    await expectTouchTarget(`Sheet option at ${scale}%`, option)
    await page.keyboard.press('Escape')
    await expect(nav).toBeVisible()
    await page.getByRole('button', { name: 'Back to chat', exact: true }).click()
    await expect(page.getByRole('main', { name: 'Conversation and workspace' })).toBeVisible()
  }
})

test('phone navigation and contextual sheets stay tappable at 320px and 200% UI scale', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 })
  await open(page)
  await page.evaluate(percent => window.hermesDesktop.zoom.setPercent(percent), 200)
  await editor(page).fill('Check the phone composer controls')
  for (const [name, control] of [
    ['Add context', page.getByRole('button', { name: 'Add context', exact: true })],
    ['Queue message', page.getByRole('button', { name: 'Queue message', exact: true })],
    ['Send', page.getByRole('button', { name: 'Send', exact: true })]
  ]) {
    const bounds = await control.boundingBox()
    expect(bounds.width, `${name} target width at 200%`).toBeGreaterThanOrEqual(44)
    expect(bounds.height, `${name} target height at 200%`).toBeGreaterThanOrEqual(44)
    expect(bounds.x + bounds.width, `${name} remains within the viewport`).toBeLessThanOrEqual(321)
  }
  const toolbar = await page.locator('.browser-chat-toolbar button').evaluateAll(buttons => buttons
    .map(button => button.getBoundingClientRect().toJSON())
    .filter(rect => rect.width && rect.height)
    .sort((a, b) => a.left - b.left))
  for (let index = 1; index < toolbar.length; index++) {
    expect(toolbar[index - 1].right, 'toolbar controls do not overlap').toBeLessThanOrEqual(toolbar[index].left)
  }
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click()
  await expect(page.locator('.browser-navigation')).toBeVisible()
  await expect(page.locator('.browser-main')).toBeHidden()
  expect((await page.locator('.browser-navigation').boundingBox()).width).toBe(320)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320)
  await page.getByRole('button', { name: 'Back to chat', exact: true }).click()
  await page.getByRole('button', { name: 'Chat actions', exact: true }).click()
  const sheet = page.locator('[data-slot="dropdown-menu-content"]:visible').last()
  await expect(sheet).toBeVisible()
  const bounds = await sheet.boundingBox()
  expect(bounds.x).toBe(0)
  expect(bounds.width).toBe(320)
  expect(bounds.y + bounds.height).toBe(700)
})

for (const mode of [
  { name: 'narrow mouse', viewport: { width: 390, height: 844 }, touch: false },
  { name: 'phone touch', viewport: { width: 390, height: 844 }, touch: true },
  { name: 'landscape touch', viewport: { width: 844, height: 390 }, touch: true }
]) {
  test(`${mode.name} submenus open on activation and replace the parent sheet`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: mode.viewport, isMobile: mode.touch, hasTouch: mode.touch })
    const page = await context.newPage()
    const activate = locator => mode.touch ? locator.tap() : locator.click()
    try {
      await open(page)
      await activate(page.getByRole('button', { name: 'Open navigation', exact: true }))
      await expect(page.getByRole('dialog', { name: 'Navigation', exact: true })).toBeVisible()
      const filters = page.getByRole('button', { name: 'Filters', exact: true })
      await activate(filters)
      const parent = page.locator('[data-slot="dropdown-menu-content"]').last()
      const submenu = page.locator('[data-slot="dropdown-menu-sub-content"]')
      const ordering = parent.getByRole('menuitem', { name: 'Ordering', exact: true })
      await ordering.hover()
      // Radix's hover-open delay is 100 ms; wait beyond it to catch regressions.
      await page.waitForTimeout(300)
      await expect(submenu).toHaveCount(0)
      await activate(ordering)
      await expect(submenu).toBeVisible()
      await expect(parent).toBeHidden()
      await expect.poll(() => submenu.evaluate(el => el.contains(document.activeElement))).toBe(true)
      await expect(page.getByRole('menu')).toHaveCount(1)
      const bounds = await submenu.boundingBox()
      expect(bounds.x).toBe(0)
      expect(bounds.width).toBe(mode.viewport.width)
      expect(Math.round(bounds.y + bounds.height)).toBe(mode.viewport.height)
      await activate(submenu.getByRole('menuitemradio', { name: 'Created', exact: true }))
      await expect(submenu.getByRole('menuitemradio', { name: 'Created', exact: true })).toHaveAttribute('aria-checked', 'true')
      await expect(parent).toBeHidden()
      await page.keyboard.press('Escape')
      await expect(parent).toHaveCount(0)
      await expect(submenu).toHaveCount(0)
      await expect(filters).toBeFocused()
      await activate(filters)
      await activate(parent.getByRole('menuitem', { name: 'Ordering', exact: true }))
      await expect(submenu.getByRole('menuitemradio', { name: 'Created', exact: true })).toHaveAttribute('aria-checked', 'true')
      await page.keyboard.press('ArrowLeft')
      await expect(parent).toBeVisible()
      await expect(ordering).toBeFocused()
      await page.keyboard.press('ArrowRight')
      await expect(submenu).toBeVisible()
      await expect(parent).toBeHidden()
      await page.keyboard.press('Escape')
      await expect(submenu).toHaveCount(0)
      await expect(parent).toHaveCount(0)
      await expect(filters).toBeFocused()
    } finally { await context.close() }
  })
}

test('desktop submenus still open on hover beside their parent menu', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await open(page)
  await page.getByRole('button', { name: 'Filters', exact: true }).click()
  const parent = page.locator('[data-slot="dropdown-menu-content"]').last()
  await parent.getByRole('menuitem', { name: 'Ordering', exact: true }).hover()
  const submenu = page.locator('[data-slot="dropdown-menu-sub-content"]')
  await expect(submenu).toBeVisible()
  await expect(parent).toBeVisible()
  await expect(page.getByRole('menu')).toHaveCount(2)
  await page.keyboard.press('Escape')
})

test('phone long code and tables scroll inside the response at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 })
  await page.route(/\/api\/sessions\/preview-week\/messages/, async route => {
    const response = await route.fetch()
    const payload = await response.json()
    payload.messages.push({
      id: 'phone-long-content',
      role: 'assistant',
      timestamp: Date.now(),
      content: `## Long response overflow check\n\n${'A readable response paragraph. '.repeat(40)}\n\n\`\`\`js\nconst data = "${'x'.repeat(500)}"\n\`\`\`\n\n| Column one | Column two |\n| --- | --- |\n| ${'wide content '.repeat(14)} | value |`
    })
    await route.fulfill({ response, json: payload })
  })
  await open(page)
  const response = page.locator('.aui-md').filter({ hasText: 'Long response overflow check' }).last()
  await expect(response).toBeVisible()
  const codeScroller = response.locator('.aui-shiki .shiki').first()
  const tableScroller = response.locator('.aui-md-table')
  await expect.poll(() => codeScroller.evaluate(el => getComputedStyle(el).overflowX)).toBe('auto')
  await expect.poll(() => codeScroller.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true)
  await expect.poll(() => tableScroller.evaluate(el => getComputedStyle(el).overflowX)).toBe('auto')
  await expect.poll(() => tableScroller.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320)
})

test('phone reselecting the highlighted session returns to the chat and preserves its draft', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const page = await context.newPage()
  try {
    await open(page)
    await editor(page).fill('Keep this draft when returning to the same chat')
    const navigation = page.locator('#browser-navigation')
    const main = page.getByRole('main', { name: 'Conversation and workspace' })
    for (const activation of ['touch', 'keyboard']) {
      await page.getByRole('button', { name: 'Open navigation', exact: true }).tap()
      await expect(navigation).toBeVisible()
      const row = navigation.getByRole('button', { name: 'Plan a calmer working week', exact: true }).first()
      await expect(row).toBeVisible()
      if (activation === 'touch') await row.tap()
      else await row.press('Enter')
      await expect(navigation).toBeHidden()
      await expect(main).toBeVisible()
      await expect(main).toBeFocused()
      await expect(page.locator('[data-browser-conversation-id]')).toHaveAttribute('data-browser-conversation-id', 'preview-week')
      await expect(editor(page)).toHaveText('Keep this draft when returning to the same chat')
    }
  } finally { await context.close() }
})

test('phone session-row actions stay open without resuming the row', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const page = await context.newPage()
  await open(page)
  await page.getByRole('button', { name: 'Chat actions', exact: true }).tap()
  let addedPin = false
  if (await page.getByRole('menuitem', { name: 'Pin', exact: true }).count()) {
    await page.getByRole('menuitem', { name: 'Pin', exact: true }).tap()
    addedPin = true
  } else {
    await page.keyboard.press('Escape')
  }
  await openNavigation(page)
  const section = page.locator('.browser-pinned-section')
  await expect(section).toBeVisible()
  if (!await section.locator('[data-row-actions]').count()) await section.getByRole('button', { name: /Pinned/ }).first().click()
  const row = section.locator('[data-row-actions]').first()
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: 'Session actions', exact: true }).tap()
  const sheet = page.locator('[data-slot="dropdown-menu-content"]:visible').last()
  await expect(sheet).toBeVisible()
  await expect(sheet.getByRole('menuitem', { name: /Rename/ })).toBeVisible()
  const bounds = await sheet.boundingBox()
  expect(bounds.x).toBe(0)
  expect(bounds.width).toBe(390)
  expect(bounds.y + bounds.height).toBe(844)
  await page.keyboard.press('Escape')
  await expect(row).toBeVisible()
  await expect(page.locator('.browser-navigation.is-open')).toBeVisible()
  await expect(row.getByRole('button', { name: 'Session actions', exact: true })).toBeFocused()
  if (addedPin) {
    await page.getByRole('button', { name: 'Back to chat', exact: true }).click()
    await page.getByRole('button', { name: 'Chat actions', exact: true }).tap()
    await page.getByRole('menuitem', { name: 'Unpin', exact: true }).tap()
  }
  await context.close()
})

test('short touch landscape uses phone surfaces while a taller touch tablet keeps split navigation', async ({ browser }) => {
  const phoneContext = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true })
  const phone = await phoneContext.newPage()
  await open(phone)
  expect(await phone.evaluate(() => matchMedia('(pointer:coarse) and (max-height:27rem)').matches)).toBe(true)
  const composerBounds = await phone.locator('[data-slot="composer-dock"]:not([data-popped-out])').boundingBox()
  expect(composerBounds.y).toBeGreaterThanOrEqual(0)
  expect(composerBounds.y + composerBounds.height).toBeLessThanOrEqual(391)
  await expect(editor(phone)).toBeVisible()
  await openNavigation(phone)
  expect(await phone.locator('.browser-navigation').boundingBox()).toMatchObject({ x: 0, y: 0, width: 844, height: 390 })
  await phone.getByRole('button', { name: 'Back to chat', exact: true }).tap()
  await phone.getByRole('button', { name: 'Chat actions', exact: true }).tap()
  const menu = phone.locator('[data-slot="dropdown-menu-content"]:visible').last()
  await expect(menu).toBeVisible()
  const menuBounds = await menu.boundingBox()
  expect(menuBounds.x).toBe(0)
  expect(menuBounds.width).toBe(844)
  expect(menuBounds.y + menuBounds.height).toBe(390)
  await phone.keyboard.press('Escape')
  await phoneContext.close()

  const tabletContext = await browser.newContext({ viewport: { width: 1024, height: 768 }, isMobile: true, hasTouch: true })
  const tablet = await tabletContext.newPage()
  await open(tablet)
  expect(await tablet.evaluate(() => matchMedia('(pointer:coarse) and (max-height:27rem)').matches)).toBe(false)
  await expect(tablet.locator('.browser-navigation')).toBeVisible()
  await expect(tablet.getByRole('main', { name: 'Conversation and workspace' })).toBeVisible()
  await expect(tablet.getByRole('dialog', { name: 'Navigation' })).toHaveCount(0)
  await tabletContext.close()
})

for (const width of [390, 1440]) {
  test(`settings menu opens the backend updater at ${width}px`, async ({ page }) => {
    await page.route(/\/api\/hermes\/update\/check(?:\?|$)/, route => route.fulfill({ json: {
      current_version: 'synthetic-preview-v1', behind: 0, update_available: false, can_apply: true, commits: []
    } }))
    await page.setViewportSize({ width, height: 960 })
    await open(page)
    await expect(page.locator('.browser-navigation')).not.toContainText('backend vsynthetic-preview-v1')
    const settings = page.getByRole('button', { name: 'Open settings menu', exact: true })
    await settings.click()
    const surface = page.getByRole(width === 390 ? 'dialog' : 'menu', { name: 'Settings and workspace', exact: true })
    const version = surface.getByRole(width === 390 ? 'button' : 'menuitem', { name: /backend vsynthetic-preview-v1/i })
    await expect(version).toBeVisible()
    const check = page.waitForRequest(request => request.url().includes('/api/hermes/update/check?force=true'))
    await version.click()
    await check
    const updater = page.getByRole('dialog').filter({ hasText: 'The backend is running the latest version.' })
    await expect(updater).toBeVisible()
    await expect(surface).toBeHidden()
    await page.keyboard.press('Escape')
    await expect(updater).toBeHidden()
    await expect(settings).toBeFocused()
  })

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
    if (width === 390) {
      const stopBounds = await surface.getByRole('button', { name: 'Stop', exact: true }).boundingBox()
      expect(stopBounds.width, 'Stop target width').toBeGreaterThanOrEqual(44)
      expect(stopBounds.height, 'Stop target height').toBeGreaterThanOrEqual(44)
    }
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
    if (width === 390) {
      const sessionMenu = page.locator('[data-slot="dropdown-menu-content"]:visible').last()
      const bounds = await sessionMenu.boundingBox()
      expect(bounds.width).toBeGreaterThan(380)
      expect(bounds.y + bounds.height).toBeGreaterThan(950)
      expect(bounds.y).toBeGreaterThan(0)
    }
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
    const trigger = page.getByRole('button', { name: 'Navigation tabs', exact: true })
    const sectionAction = name => page.getByRole(width === 390 ? 'button' : 'menuitem', { name, exact: true })
    // Touch users reach the same command through an explicit toolbar control.
    if (width === 390) await trigger.click()
    else await heading.click({ button: 'right' })
    await expect(sectionAction('Hide pinned section')).toBeVisible()
    await page.keyboard.press('Escape')
    if (width === 390) {
      await expect(page.locator('.browser-navigation')).toHaveClass(/is-open/)
      await expect(trigger).toBeFocused()
    }
    await expect(section).toBeVisible()
    if (width === 390) await trigger.click()
    else await heading.click({ button: 'right' })
    await sectionAction('Hide pinned section').click()
    await expect(section).toBeHidden()
    await expect(trigger).toBeFocused()
    await page.reload()
    await expect(editor(page)).toBeVisible()
    if (width === 390) await openNavigation(page)
    await expect(section).toBeHidden()
    // Both the explicit menu and the remaining heading can restore Pinned.
    if (width === 390) await trigger.click()
    else await page.locator('.browser-sessions-pane').getByRole('button', { name: 'Sessions', exact: true }).click({ button: 'right' })
    await sectionAction('Show pinned section').click()
    await expect(section).toBeVisible()
    if (!await section.locator('[data-row-actions]').count()) await heading.click()
    const row = section.locator('[data-row-actions]').first()
    await expect(row).toBeVisible()
    if (width === 390) {
      await page.getByRole('button', { name: 'Back to chat', exact: true }).click()
      await page.getByRole('button', { name: 'Chat actions', exact: true }).click()
    }
    else await row.click({ button: 'right' })
    await expect(page.getByRole('menuitem', { name: 'Unpin', exact: true })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Hide pinned section', exact: true })).toHaveCount(0)
    // Restore the shared preview fixture after checking the action menu.
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
  await page.evaluate(() => window.hermesDesktop.zoom.setPercent(50))
  await editor(page).fill('Keep my draft while using panels')
  await expect(page.getByRole('button', { name: 'Open panels', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Open settings menu', exact: true }).click()
  await page.getByRole('dialog', { name: 'Settings and workspace', exact: true }).getByRole('button', { name: 'files', exact: true }).click()
  const close = page.getByRole('button', { name: 'Close files panel', exact: true })
  await expect(close).toBeVisible()
  const closeBounds = await close.boundingBox()
  expect(closeBounds.width).toBeGreaterThanOrEqual(44)
  expect(closeBounds.height).toBeGreaterThanOrEqual(44)
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
    const main = page.locator('.browser-main')
    const originalChatWidth = width === 1440 ? (await main.boundingBox()).width : null
    if (width === 390) {
      await expect(main).toBeHidden()
      await page.getByRole('button', { name: 'Back to chat', exact: true }).click()
      await expect(main).toBeVisible()
    } else {
      await toggle.click()
    }
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(navigation).toBeHidden()
    await expect(resizer).toBeHidden()
    if (width === 1440) expect((await main.boundingBox()).width).toBeGreaterThan(originalChatWidth)
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(navigation).toBeVisible()
    expect((await navigation.boundingBox()).width).toBeCloseTo(originalWidth, 0)
    if (width === 390) {
      await page.keyboard.press('Escape')
      await expect(navigation).toBeHidden()
      await expect(toggle).toBeFocused()
      await expect(editor(page)).toContainText('Keep this draft while toggling the sidebar')
    } else {
      await expect(editor(page)).toContainText('Keep this draft while toggling the sidebar')
      await expect(page.locator('.browser-chat-title')).toHaveCount(0)
      await expect(resizer).toBeVisible()
    }
  })

  test(`search and disclosure form one navigation list at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 960 })
    await page.emulateMedia({ colorScheme: 'dark' })
    await open(page)
    if (width === 390) await openNavigation(page)
    const search = page.locator('.browser-sessions-pane .browser-session-search')
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

for (const width of [390, 1440]) {
  test(`section headers preserve disclosure and browser styling at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 960 })
    // A populated schedule exercises the real upstream Cron section too.
    await page.route(/\/api\/cron\/jobs(?:\?|$)/, route => route.fulfill({ json: [{ id: 'preview-header-job', name: 'Header verification job', prompt: 'Check navigation', enabled: true }] }))
    await open(page)
    await editor(page).fill('Draft retained through section disclosure')
    if (width === 390) await openNavigation(page)
    const pane = page.locator('.browser-sessions-pane')
    for (const scale of [100, 150]) {
      await page.evaluate(percent => window.hermesDesktop.zoom.setPercent(percent), scale)
      const heights = []
      for (const name of ['Sessions', 'Cron jobs']) {
        const label = pane.locator('[data-browser-section-label]').filter({ hasText: new RegExp(`^${name}$`) })
        await expect(label).toBeVisible()
        const section = label.locator('xpath=ancestor::*[@data-sidebar="group"][1]')
        const content = section.locator(':scope > [data-sidebar="group-content"]')
        const wasOpen = await content.isVisible()
        await label.click()
        if (wasOpen) await expect(content).toBeHidden()
        else await expect(content).toBeVisible()
        await expect(label).toBeFocused()
        await label.click()
        if (wasOpen) await expect(content).toBeVisible()
        else await expect(content).toBeHidden()
        const header = section.locator(':scope > [data-browser-section-header]')
        heights.push((await header.boundingBox()).height)
        const box = await header.boundingBox()
        expect(box.x).toBeGreaterThanOrEqual(0)
        expect(box.x + box.width).toBeLessThanOrEqual(width)
      }
      expect(Math.abs(heights[0] - heights[1])).toBeLessThan(1)
      if (scale === 150) await page.screenshot({ path: testInfo.outputPath('section-headers-150.png') })
    }
    if (width === 390) await page.keyboard.press('Escape')
    await expect(editor(page)).toHaveText('Draft retained through section disclosure')
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
    if (width === 390) await page.getByRole('button', { name: 'Back to chat', exact: true }).click()
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
      if (width === 390) {
        const navigationBox = await page.locator('.browser-navigation').boundingBox()
        expect(navigationBox.x).toBe(0)
        expect(navigationBox.width).toBe(width)
        const triggerBox = await trigger.boundingBox()
        expect(triggerBox.x + triggerBox.width).toBeLessThanOrEqual(width)
      }
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
        await page.getByRole('button', { name: 'Back to chat', exact: true }).click()
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
      if (width === 390) await page.getByRole('button', { name: 'Back to chat', exact: true }).click()
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
      if (width === 390) await page.getByRole('button', { name: 'Back to chat', exact: true }).click()
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
    await page.getByRole('button', { name: 'Back to chat', exact: true }).tap()
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

test('phone tool surfaces fit a short 320px viewport and close back to chat', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 480 })
  await open(page)
  await openNavigation(page)
  await page.getByRole('button', { name: 'More', exact: true }).click()
  await page.getByRole('group', { name: 'More controls', exact: true }).getByRole('button', { name: 'Capabilities', exact: true }).click()
  const surface = page.locator('[data-overlay-surface]:visible').filter({ hasText: 'Skills' })
  await expect(surface).toBeVisible()
  const bounds = await surface.boundingBox()
  expect(bounds.x).toBeGreaterThanOrEqual(0)
  expect(bounds.y).toBeGreaterThanOrEqual(0)
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(321)
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(481)
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
      if (width === 390) await page.getByRole('button', { name: 'Back to chat', exact: true }).click()
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
    await page.getByRole('button', { name: 'Back to chat', exact: true }).tap()
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
      if (width === 390) await page.getByRole('button', { name: 'Back to chat', exact: true }).click()
      await expect(editor(page)).toHaveText('Keep my draft while organizing rows')
      await expect(page).toHaveURL(/#\/preview-week$/)
      errors.assertClean()
    })
  }
}

test('shared UI styles: compact controls retain active and keyboard focus states', async ({ page }) => {
  await open(page)
  await page.evaluate(() => window.hermesDesktop.zoom.setPercent(100))
  const sessionFilter = page.getByRole('button', { name: 'Filters', exact: true })
  expect((await sessionFilter.boundingBox()).width).toBeCloseTo(24, 0)
  const bots = page.getByRole('tab', { name: 'Bots', exact: true })
  await page.keyboard.press('Tab')
  await bots.focus()
  await expect(bots).toHaveCSS('outline-style', 'solid')
  await page.keyboard.press('Enter')
  const filter = page.getByRole('button', { name: /^Filter roster/ })
  expect((await filter.boundingBox()).width).toBeCloseTo(24, 0)
  const inactiveColor = await filter.evaluate(el => getComputedStyle(el).color)
  await filter.click()
  await page.getByRole('menuitemradio', { name: 'Bots only', exact: true }).click()
  await page.keyboard.press('Escape')
  await bots.focus()
  await page.mouse.move(600, 400)
  await expect(filter).toHaveAccessibleName('Filter roster, 1 active')
  await expect(filter).not.toHaveCSS('color', inactiveColor)
})

// Exercise the rendered contract, including body portals and CSS zoom. These
// cases straddle the navigation breakpoint and include touch-only landscape.
for (const scenario of [
  { name: 'desktop dark', width: 1440, height: 960, scale: 100, colorScheme: 'dark' },
  { name: 'desktop light zoomed', width: 1440, height: 960, scale: 150, colorScheme: 'light' },
  { name: 'touch tablet', width: 1024, height: 1024, scale: 100, colorScheme: 'dark', hasTouch: true },
  { name: 'small phone zoomed', width: 320, height: 740, scale: 150, colorScheme: 'dark', compact: true, hasTouch: true },
  { name: 'tablet boundary', width: 768, height: 1024, scale: 100, colorScheme: 'dark' },
  { name: 'compact boundary', width: 767, height: 960, scale: 100, colorScheme: 'light', compact: true },
  { name: 'phone dark', width: 390, height: 844, scale: 100, colorScheme: 'dark', compact: true, hasTouch: true },
  { name: 'phone light zoomed', width: 390, height: 844, scale: 150, colorScheme: 'light', compact: true, hasTouch: true },
  { name: 'landscape touch', width: 844, height: 390, scale: 100, colorScheme: 'dark', compact: true, hasTouch: true },
  { name: 'landscape touch zoomed', width: 844, height: 390, scale: 150, colorScheme: 'light', compact: true, hasTouch: true }
]) {
  test(`shared UI styles: ${scenario.name}`, async ({ browser }, testInfo) => {
    const { width, height, scale, compact = false, hasTouch = false, colorScheme } = scenario
    const context = await browser.newContext({ viewport: { width, height }, hasTouch, colorScheme })
    const page = await context.newPage()
    const errors = installBrowserErrorCollector(page)
    try {
      await open(page)
      await page.evaluate(percent => window.hermesDesktop.zoom.setPercent(percent), scale)
      const toolbar = page.locator('.browser-chat-toolbar')
      const controls = await toolbar.locator('button').evaluateAll(buttons => buttons.map(button => {
        const icon = button.querySelector('.codicon, svg')
        const bounds = button.getBoundingClientRect(), glyph = icon?.getBoundingClientRect()
        return { width: bounds.width, height: bounds.height, icon: glyph?.width, centered: glyph ? Math.abs(glyph.x + glyph.width / 2 - bounds.x - bounds.width / 2) < 1 && Math.abs(glyph.y + glyph.height / 2 - bounds.y - bounds.height / 2) < 1 : false }
      }))
      expect(controls).toHaveLength(4)
      for (const control of controls) {
        expect(control.width).toBeCloseTo(Math.max(36 * scale / 100, compact || hasTouch ? 52 : 0), 0)
        expect(control.height).toBeCloseTo(control.width, 0)
        expect(control.icon).toBeCloseTo(16 * scale / 100, 0)
        expect(control.centered).toBe(true)
      }
      const settings = page.getByRole('button', { name: 'Open settings menu', exact: true })
      await page.keyboard.press('Tab')
      await settings.focus()
      await expect(settings).toHaveCSS('outline-style', 'solid')
      await page.keyboard.press('Enter')
      const actions = page.getByRole(compact ? 'dialog' : 'menu', { name: 'Settings and workspace', exact: true })
      await expect(actions).toBeVisible()
      const appearance = await actions.evaluate(el => {
        const style = getComputedStyle(el)
        const row = el.querySelector('.browser-action-item')
        return { background: style.backgroundColor, border: style.borderTopColor, width: parseFloat(style.borderTopWidth), font: getComputedStyle(row).fontFamily, rowHeight: row.getBoundingClientRect().height }
      })
      expect(appearance.background).not.toBe('rgba(0, 0, 0, 0)')
      expect(appearance.width).toBeGreaterThan(0)
      expect(appearance.rowHeight).toBeCloseTo(compact || hasTouch ? 52 : 24 * scale / 100, 0)
      const bounds = await actions.boundingBox()
      expect(bounds.x).toBeGreaterThanOrEqual(-1)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1)
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(height + 1)
      if (compact) {
        expect(bounds.width).toBeCloseTo(width, 0)
        expect(bounds.y + bounds.height).toBeCloseTo(height, 0)
        const last = actions.getByRole('button', { name: 'Agents', exact: true })
        await last.scrollIntoViewIfNeeded()
        const lastBox = await last.boundingBox()
        expect(lastBox.y + lastBox.height).toBeLessThanOrEqual(height + 1)
      }
      await page.screenshot({ path: testInfo.outputPath('shared-styles.png') })
      await page.keyboard.press('Escape')
      await expect(settings).toBeFocused()
      if (compact) await page.getByRole('button', { name: 'Open navigation', exact: true }).click()
      await page.getByRole('button', { name: 'Filters', exact: true }).click()
      const filters = page.locator('[data-slot="dropdown-menu-content"]:visible').last()
      await expect(filters).toBeVisible()
      await expect(filters).toHaveCSS('background-color', appearance.background)
      await expect(filters).toHaveCSS('border-top-color', appearance.border)
      const ordering = filters.getByRole('menuitem', { name: 'Ordering', exact: true })
      await expect(ordering).toHaveCSS('font-family', appearance.font)
      expect((await ordering.boundingBox()).height).toBeCloseTo(appearance.rowHeight, 0)
      if (compact) await ordering.click()
      else await ordering.hover()
      const submenu = page.locator('[data-slot="dropdown-menu-sub-content"]:visible')
      await expect(submenu).toBeVisible()
      await expect(submenu).toHaveCSS('background-color', appearance.background)
      const submenuBox = await submenu.boundingBox()
      expect(submenuBox.x + submenuBox.width).toBeLessThanOrEqual(width + 1)
      expect(submenuBox.y + submenuBox.height).toBeLessThanOrEqual(height + 1)
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')
      if (compact) await page.keyboard.press('Escape')
      await expect(editor(page)).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true)
      errors.assertClean()
    } finally {
      await context.close()
    }
  })
}
