import { expect } from '@playwright/test'
import { test, editor, openConversation, observeResponses } from './gateway-fixture.mjs'

test.setTimeout(60000)
test.use({ viewport: { width: 1440, height: 960 } })

test('a late Bot A response cannot replace Bot B or cross their drafts', async ({ page, gatewayApp }) => {
  const finishHeldResponse = observeResponses(page)
  await openConversation(page, gatewayApp.origin)
  await editor(page).fill('Ordinary session draft')
  await page.getByRole('tab', { name: 'Bots', exact: true }).click()
  const first = gatewayApp.controls.hold(call => call.transport === 'rpc' && call.method === 'session.resume' && call.params.session_id === 'preview-research')
  await page.getByRole('button', { name: /Research · @/ }).click()
  await expect.poll(() => gatewayApp.controls.calls.some(call => call.method === 'session.resume' && call.params.session_id === 'preview-research')).toBe(true)
  await page.getByRole('button', { name: /Writer · @/ }).click()
  await expect(page).toHaveURL(/#\/preview-writer$/)
  await expect(page.getByText('Bring a rough outline or a first draft.', { exact: false }).first()).toBeVisible()
  await editor(page).fill('Writer draft')
  await finishHeldResponse(first)
  await expect(page).toHaveURL(/#\/preview-writer$/)
  await expect(editor(page)).toHaveText('Writer draft')
  await page.getByRole('tab', { name: 'Sessions', exact: true }).click()
  await page.getByRole('button', { name: 'Plan a calmer working week', exact: true }).click()
  await expect(editor(page)).toHaveText('Ordinary session draft')
})

test('an explicit profile choice survives delayed Bot activation', async ({ page, gatewayApp }, testInfo) => {
  const finishHeldResponse = observeResponses(page)
  await openConversation(page, gatewayApp.origin)
  await page.getByRole('tab', { name: 'Bots', exact: true }).click()
  const opening = gatewayApp.controls.hold(call => call.transport === 'rpc' && call.method === 'session.list' && call.params.profile === 'research')
  await page.getByRole('button', { name: /Research · @/ }).click()
  await expect.poll(() => gatewayApp.controls.calls.some(call => call.method === 'session.list' && call.params.profile === 'research')).toBe(true)
  await page.getByRole('tab', { name: 'Sessions', exact: true }).click()
  const choice = page.locator('[data-profile-key="writer"]')
  await choice.click()
  await finishHeldResponse(opening)
  await testInfo.attach('profile-after-response', { body: JSON.stringify(await page.evaluate(() => ({ saved: sessionStorage.getItem('hermes-web.browser.profile'), requested: window.__HERMES_WEB_ACTIVE_PROFILE__, pressed: [...document.querySelectorAll('[aria-pressed="true"]')].map(el => el.getAttribute('aria-label')) }))), contentType: 'application/json' })
  await expect(choice).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('hermes-web.browser.profile'))).toBe('writer')
  await page.reload()
  await expect(choice).toHaveAttribute('aria-pressed', 'true')
})

test('reconnect preserves the selected conversation and its draft', async ({ page, gatewayApp }) => {
  await openConversation(page, gatewayApp.origin)
  await editor(page).fill('Keep this draft across reconnect')
  const before = gatewayApp.controls.calls.filter(call => call.method === 'session.resume').length
  gatewayApp.disconnect()
  await expect.poll(() => gatewayApp.controls.calls.filter(call => call.method === 'session.resume').length, { timeout: 30000 }).toBeGreaterThan(before)
  await expect(page).toHaveURL(/#\/preview-week$/)
  await expect(editor(page)).toHaveText('Keep this draft across reconnect')
})

for (const action of ['archive', 'delete']) {
  test(`rejected ${action} keeps the chat and draft and explains the failure`, async ({ page, gatewayApp }) => {
    await openConversation(page, gatewayApp.origin)
    await editor(page).fill('Keep this draft after a rejected action')
    gatewayApp.controls.reject({ transport: 'http', method: action === 'delete' ? 'DELETE' : 'PATCH', path: '/api/sessions/preview-week' }, `${action} rejected`)
    await page.getByRole('button', { name: 'Chat actions', exact: true }).click()
    await page.getByRole('menuitem', { name: action === 'delete' ? 'Delete' : 'Archive', exact: true }).click()
    if (action === 'delete') await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(page.getByRole('alert').filter({ hasText: `Could not ${action} conversation.` })).toBeVisible()
    await expect(page).toHaveURL(/#\/preview-week$/)
    await expect(editor(page)).toHaveText('Keep this draft after a rejected action')
    expect(gatewayApp.sessions.has('preview-week')).toBe(true)
    expect(gatewayApp.sessions.get('preview-week').archived).not.toBe(true)
  })
}

test('rejected approval change restores the confirmed mode and explains the failure', async ({ page, gatewayApp }) => {
  await openConversation(page, gatewayApp.origin)
  const control = page.locator('.browser-approval-control button')
  await expect(control.locator('svg')).toHaveClass(/brain/)
  gatewayApp.controls.reject({ transport: 'rpc', method: 'config.set' }, 'Approval rejected')
  await control.click()
  await page.getByRole('menuitemradio', { name: /Off/ }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Could not change approval mode.' })).toBeVisible()
  await expect(control.locator('svg')).toHaveClass(/brain/)
})

test('a delayed archive cannot navigate away from a newer conversation', async ({ page, gatewayApp }) => {
  await openConversation(page, gatewayApp.origin)
  const archive = gatewayApp.controls.hold({ transport: 'http', method: 'PATCH', path: '/api/sessions/preview-week' })
  await page.getByRole('button', { name: 'Chat actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Archive', exact: true }).click()
  await archive.entered
  await page.getByText('Explore a product idea', { exact: true }).first().click()
  await expect(page).toHaveURL(/#\/preview-idea$/)
  await editor(page).fill('Keep the newer conversation draft')
  const completed = page.waitForResponse(response => response.url().includes('/api/sessions/preview-week') && response.request().method() === 'PATCH')
  archive.release()
  await completed
  await expect(page.getByRole('button', { name: 'Plan a calmer working week', exact: true })).toHaveCount(0)
  await expect(page).toHaveURL(/#\/preview-idea$/)
  await expect(editor(page)).toHaveText('Keep the newer conversation draft')
})


test('rejected unread change rolls back the action and preserves the draft', async ({ page, gatewayApp }) => {
  await openConversation(page, gatewayApp.origin)
  await editor(page).fill('Keep the unread-action draft')
  gatewayApp.controls.reject({ transport: 'http', method: 'PATCH', path: '/api/sessions/preview-week' }, 'Unread rejected')
  await page.getByRole('button', { name: 'Chat actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Mark as unread', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Could not change unread status.' })).toBeVisible()
  await expect(editor(page)).toHaveText('Keep the unread-action draft')
  await page.getByRole('button', { name: 'Chat actions', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: 'Mark as unread', exact: true })).toBeVisible()
})

test('a delayed delete cannot navigate away from a newer conversation', async ({ page, gatewayApp }) => {
  await openConversation(page, gatewayApp.origin)
  const deletion = gatewayApp.controls.hold({ transport: 'http', method: 'DELETE', path: '/api/sessions/preview-week' })
  await page.getByRole('button', { name: 'Chat actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click()
  await deletion.entered
  await page.getByText('Explore a product idea', { exact: true }).first().click()
  await expect(page).toHaveURL(/#\/preview-idea$/)
  await editor(page).fill('Keep the newer conversation after deletion')
  const completed = page.waitForResponse(response => response.url().includes('/api/sessions/preview-week') && response.request().method() === 'DELETE')
  deletion.release()
  await completed
  await expect(page.getByRole('button', { name: 'Plan a calmer working week', exact: true })).toHaveCount(0)
  await expect(page).toHaveURL(/#\/preview-idea$/)
  await expect(editor(page)).toHaveText('Keep the newer conversation after deletion')
})

for (const action of ['archive', 'delete']) {
  test(`unconfirmed ${action} leaves the conversation intact`, async ({ page, gatewayApp }) => {
    await openConversation(page, gatewayApp.origin)
    await editor(page).fill('Keep this draft without confirmation')
    let intercepted = false
    await page.route(/\/api\/sessions\/preview-week(?:\?|$)/, route => {
      if (route.request().method() === (action === 'archive' ? 'PATCH' : 'DELETE')) {
        intercepted = true
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false }) })
      }
      return route.continue()
    })
    await page.getByRole('button', { name: 'Chat actions', exact: true }).click()
    await page.getByRole('menuitem', { name: action === 'archive' ? 'Archive' : 'Delete', exact: true }).click()
    if (action === 'delete') await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(page.getByRole('alert').filter({ hasText: `Could not ${action} conversation.` })).toBeVisible()
    await expect(page).toHaveURL(/#\/preview-week$/)
    await expect(editor(page)).toHaveText('Keep this draft without confirmation')
    expect(intercepted).toBe(true)
    expect(gatewayApp.sessions.has('preview-week')).toBe(true)
  })
}

test('unread action labels follow the persisted state', async ({ page, gatewayApp }) => {
  await openConversation(page, gatewayApp.origin)
  await editor(page).fill('Keep this draft while changing unread state')
  for (const unread of [true, false]) {
    await page.getByRole('button', { name: 'Chat actions', exact: true }).click()
    await page.getByRole('menuitem', { name: unread ? 'Mark as unread' : 'Mark as read', exact: true }).click()
    await expect.poll(() => gatewayApp.sessions.get('preview-week').unread).toBe(unread)
  }
  await expect(editor(page)).toHaveText('Keep this draft while changing unread state')
})

test('approval initialization waits for the gateway without a false action error', async ({ page, gatewayApp }) => {
  await openConversation(page, gatewayApp.origin)
  await expect(page.locator('.browser-approval-control button svg')).toHaveClass(/brain/)
  await expect.poll(() => gatewayApp.controls.calls.some(call => call.method === 'config.get' && call.params.key === 'approvals.mode')).toBe(true)
  await expect(page.getByRole('alert').filter({ hasText: 'Could not load approval mode.' })).toHaveCount(0)
})
