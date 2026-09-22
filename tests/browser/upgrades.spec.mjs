import { expect } from '@playwright/test'
import { test } from './upgrade-fixture.mjs'
import { editor, openConversation } from './gateway-fixture.mjs'

test.setTimeout(180000)
test.use({ viewport: { width: 1440, height: 960 } })

async function openPrevious(page, app, session) {
  await openConversation(page, app.origin, session)
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.waitForFunction(() => navigator.serviceWorker.controller)
  await page.evaluate(() => { window.__upgradeDocument = 'previous' })
}

async function offerCandidate(page, app) {
  app.publishCandidate()
  await page.evaluate(async () => { const registration = await navigator.serviceWorker.getRegistration(); await registration.update() })
  await expect(page.getByRole('button', { name: 'Update when safe', exact: true })).toBeVisible({ timeout: 30000 })
}

async function expectPrevious(page) {
  expect(await page.evaluate(() => window.__upgradeDocument)).toBe('previous')
  expect(await page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration()).waiting))).toBe(true)
  await expect(editor(page)).toBeEditable()
}

async function attachFile(page) {
  await page.getByRole('button', { name: 'Add context', exact: true }).click()
  const picker = page.waitForEvent('filechooser')
  await page.getByRole('menuitem', { name: 'Files…', exact: true }).click()
  await (await picker).setFiles({ name: 'upgrade-draft.txt', mimeType: 'text/plain', buffer: Buffer.from('An unsent attachment that must not be lost.') })
  await expect(page.locator('[data-slot="composer-attachments"]').getByText('upgrade-draft.txt', { exact: true })).toBeVisible()
}

const entryFor = async image => (await (await fetch(`http://127.0.0.1:${image.port}/`)).text()).match(/<script[^>]+type="module"[^>]+src="([^"]+)"/)[1]

test('real drafts survive a previous-image upgrade after active work and unsent files are resolved', async ({ page, context, upgradeApp }) => {
  await openPrevious(page, upgradeApp, 'preview-week')
  const other = await context.newPage()
  await openPrevious(other, upgradeApp, 'preview-idea')
  await editor(page).fill('First tab keeps its own unsent draft')
  await editor(other).fill('Start a response in the other tab')
  await editor(other).press('Enter')
  await expect(other.locator('[data-slot="composer-surface"]').getByRole('button', { name: 'Stop', exact: true })).toBeVisible()
  await offerCandidate(page, upgradeApp)
  await page.getByRole('button', { name: 'Update when safe', exact: true }).click()
  await expect(page.getByRole('status', { name: 'Application update' })).toContainText(/postponed|active response/)
  await expectPrevious(page)
  await expect(editor(page)).toHaveText('First tab keeps its own unsent draft')
  await expect(other.locator('[data-slot="composer-surface"]').getByRole('button', { name: 'Stop', exact: true })).toBeVisible()
  await other.locator('[data-slot="composer-surface"]').getByRole('button', { name: 'Stop', exact: true }).click()
  await expect(other.locator('[data-slot="composer-surface"]').getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
  await editor(other).fill('Second tab keeps a different conversation draft')
  await attachFile(page)
  await page.getByRole('button', { name: 'Update when safe', exact: true }).click()
  await expect(page.getByRole('status', { name: 'Application update' })).toContainText('unsent attachments')
  await expectPrevious(page)
  await expect(page.getByRole('button', { name: 'Remove upgrade-draft.txt', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Remove upgrade-draft.txt', exact: true }).click()
  await Promise.all([
    page.waitForEvent('load', { timeout: 60000 }), other.waitForEvent('load', { timeout: 60000 }),
    page.getByRole('button', { name: 'Update when safe', exact: true }).click()
  ])
  await expect(editor(page)).toBeVisible({ timeout: 30000 })
  await expect(editor(other)).toBeVisible({ timeout: 30000 })
  await expect(editor(page)).toHaveText('First tab keeps its own unsent draft')
  await expect(editor(other)).toHaveText('Second tab keeps a different conversation draft')
  await expect(page).toHaveURL(/#\/preview-week$/)
  await expect(other).toHaveURL(/#\/preview-idea$/)
  const candidateHtml = await (await fetch(`http://127.0.0.1:${upgradeApp.candidate.port}/`)).text()
  const candidateEntry = candidateHtml.match(/<script[^>]+type="module"[^>]+src="([^"]+)"/)[1]
  for (const tab of [page, other]) {
    expect(await tab.evaluate(() => window.__upgradeDocument)).toBeUndefined()
    await expect(tab.locator(`script[type="module"][src="${candidateEntry}"]`)).toHaveCount(1)
    expect(await tab.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration()).waiting))).toBe(false)
  }
  expect((await (await page.request.get(`${upgradeApp.origin}/build-info.json`)).json()).wrapperRevision).toBe(upgradeApp.candidate.build.wrapperRevision)
  await other.close()
})

test('two real composers editing the same conversation cannot overwrite one another during upgrade', async ({ page, context, upgradeApp }) => {
  await openPrevious(page, upgradeApp, 'preview-week')
  const other = await context.newPage()
  await openPrevious(other, upgradeApp, 'preview-week')
  await editor(page).fill('First independent draft')
  await editor(other).fill('Second independent draft')
  await offerCandidate(page, upgradeApp)
  await page.getByRole('button', { name: 'Update when safe', exact: true }).click()
  await expect(page.getByRole('status', { name: 'Application update' })).toContainText(/postponed|could not be saved/)
  await expectPrevious(page)
  await expect(editor(page)).toHaveText('First independent draft')
  await expect(editor(other)).toHaveText('Second independent draft')
  expect(await other.evaluate(() => window.__upgradeDocument)).toBe('previous')
  await expect(editor(other)).toBeEditable()
  await other.close()
})


test('rollback to the previous tested image waits for active work and retains real drafts in both tabs', async ({ page, context, upgradeApp }, testInfo) => {
  await openPrevious(page, upgradeApp, 'preview-week')
  const other = await context.newPage()
  await openPrevious(other, upgradeApp, 'preview-idea')
  await editor(page).fill('First draft before the candidate')
  await editor(other).fill('Second draft before the candidate')
  await offerCandidate(page, upgradeApp)
  await Promise.all([
    page.waitForEvent('load', { timeout: 60000 }), other.waitForEvent('load', { timeout: 60000 }),
    page.getByRole('button', { name: 'Update when safe', exact: true }).click()
  ])
  await expect(editor(page)).toHaveText('First draft before the candidate')
  await expect(editor(other)).toHaveText('Second draft before the candidate')
  const candidateEntry = await entryFor(upgradeApp.candidate)
  for (const tab of [page, other]) await expect(tab.locator(`script[type="module"][src="${candidateEntry}"]`)).toHaveCount(1)
  await editor(page).fill('First draft edited in the candidate')
  await editor(other).fill('Start active work before rollback')
  await editor(other).press('Enter')
  const stop = other.locator('[data-slot="composer-surface"]').getByRole('button', { name: 'Stop', exact: true })
  await expect(stop).toBeVisible()
  upgradeApp.publishPrevious()
  await page.evaluate(async () => { const registration = await navigator.serviceWorker.getRegistration(); await registration.update() })
  const update = page.getByRole('button', { name: 'Update when safe', exact: true })
  await expect(update).toBeVisible({ timeout: 30000 })
  await update.click()
  await expect(page.getByRole('status', { name: 'Application update' })).toContainText(/postponed|active response/)
  await expect(stop).toBeVisible()
  await expect(page.locator(`script[type="module"][src="${candidateEntry}"]`)).toHaveCount(1)
  await stop.click()
  await expect(stop).toHaveCount(0)
  await editor(other).fill('Second draft edited in the candidate')
  await attachFile(page)
  await update.click()
  await expect(page.getByRole('status', { name: 'Application update' })).toContainText('unsent attachments')
  await expect(page.locator(`script[type="module"][src="${candidateEntry}"]`)).toHaveCount(1)
  await page.getByRole('button', { name: 'Remove upgrade-draft.txt', exact: true }).click()
  await Promise.all([
    page.waitForEvent('load', { timeout: 60000 }), other.waitForEvent('load', { timeout: 60000 }), update.click()
  ])
  const previousEntry = await entryFor(upgradeApp.previous)
  for (const [tab, session, draft] of [[page, 'preview-week', 'First draft edited in the candidate'], [other, 'preview-idea', 'Second draft edited in the candidate']]) {
    await expect(tab.locator(`script[type="module"][src="${previousEntry}"]`)).toHaveCount(1)
    await expect(editor(tab)).toHaveText(draft)
    await expect(tab).toHaveURL(new RegExp(`#/${session}$`))
    expect(await tab.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration()).waiting))).toBe(false)
    await tab.reload()
    await expect(editor(tab)).toHaveText(draft)
  }
  expect((await (await page.request.get(`${upgradeApp.origin}/build-info.json`)).json()).wrapperRevision).toBe(upgradeApp.previous.build.wrapperRevision)
  await testInfo.attach('rollback-result', { body: JSON.stringify({ from: upgradeApp.candidate.build, to: upgradeApp.previous.build, fromImage: upgradeApp.candidate.reference, toImage: upgradeApp.previous.reference, activeResponseBlocked: true, attachmentBlocked: true, draftsRetainedAfterReload: true, gateway: 'synthetic-preview-v1' }, null, 2), contentType: 'application/json' })
  await other.close()
})

test('candidate composers block conflicting rollback drafts and allow retry after the other tab closes', async ({ page, context, upgradeApp }) => {
  await openPrevious(page, upgradeApp, 'preview-week')
  await offerCandidate(page, upgradeApp)
  await Promise.all([
    page.waitForEvent('load', { timeout: 60000 }),
    page.getByRole('button', { name: 'Update when safe', exact: true }).click()
  ])
  const other = await context.newPage()
  await openConversation(other, upgradeApp.origin, 'preview-week')
  const candidateEntry = await entryFor(upgradeApp.candidate)
  for (const tab of [page, other]) await expect(tab.locator(`script[type="module"][src="${candidateEntry}"]`)).toHaveCount(1)
  await editor(page).fill('Keep this candidate draft')
  await editor(other).fill('A different candidate draft')
  upgradeApp.publishPrevious()
  await page.evaluate(async () => { const registration = await navigator.serviceWorker.getRegistration(); await registration.update() })
  const update = page.getByRole('button', { name: 'Update when safe', exact: true })
  await expect(update).toBeVisible({ timeout: 30000 })
  await update.click()
  await expect(page.getByRole('status', { name: 'Application update' })).toContainText(/postponed|could not be saved/)
  await expect(editor(page)).toHaveText('Keep this candidate draft')
  await expect(editor(other)).toHaveText('A different candidate draft')
  await expect(editor(page)).toBeEditable()
  await expect(editor(other)).toBeEditable()
  expect(await page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration()).waiting))).toBe(true)
  await other.close()
  await Promise.all([page.waitForEvent('load', { timeout: 60000 }), update.click()])
  await expect(page.locator(`script[type="module"][src="${await entryFor(upgradeApp.previous)}"]`)).toHaveCount(1)
  await expect(editor(page)).toHaveText('Keep this candidate draft')
  await page.reload()
  await expect(editor(page)).toHaveText('Keep this candidate draft')
})
