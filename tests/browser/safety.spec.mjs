import { test, expect } from '@playwright/test'
import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { requireBrowserImage } from './test-target.mjs'

let server, container, origin, workerVersion = 1
const browserImage = requireBrowserImage()
const read = file => readFileSync(new URL(`../../apps/web-desktop/${file}`, import.meta.url), 'utf8')
// This fixture embeds classic scripts, so apply the production DEV constant
// normally supplied by Vite before transpiling the application modules.
const compile = file => ts.transpileModule(read(file).replaceAll('import.meta.env.DEV', 'false'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
const guard = compile('src/platform/reload-safety.ts')
const state = compile('src/platform/connection-state.ts')
const registration = compile('src/pwa/register.ts')
const coordinator = read('public/update-coordinator-sw.js')

test.beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    if (req.url.startsWith('/api/worker.js')) {
      res.setHeader('Content-Type', 'text/javascript')
      res.end(`// candidate ${workerVersion}\nself.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));\n${coordinator}`)
    } else if (req.url === '/api/review') {
      res.setHeader('Content-Type', 'text/html')
      res.end(`<!doctype html><html><head><title>Browser safety fixture</title></head><body><div id="root"><textarea aria-label="Draft"></textarea></div>
<script>window.exports={};${guard};window.safety=exports;</script>
<script>window.exports={};window.require=()=>({});${state};window.stateFactory=exports.createConnectionState;</script>
<script>
window.exports={};window.require=()=>window.safety;
const register=navigator.serviceWorker.register.bind(navigator.serviceWorker);
navigator.serviceWorker.register=()=>register('/api/worker.js',{scope:'/api/',updateViaCache:'none'});
window.safety.setActiveWork({count:0});
window.__HERMES_WEB_DRAFT_SNAPSHOT__=()=>{
 const text=document.querySelector('textarea').value;
 localStorage.setItem('fixture-drafts',JSON.stringify(text?{session:text}:{}));
 return {storageKey:'fixture-drafts',texts:text?{session:text}:{},attachments:window.unsentFiles||0,blocked:false};
};
let updatePanel, updateStatus, updateAction;
window.addEventListener('hermes-update-available', event => {
 const notice=event.detail;
 if (!notice) return;
 if (!updatePanel) {
  updatePanel=document.createElement('div'); updatePanel.setAttribute('role','status');
  updateStatus=document.createElement('span'); updateAction=document.createElement('button'); updateAction.textContent='Update when safe';
  updatePanel.append(updateStatus, updateAction); document.body.append(updatePanel);
 }
 updateStatus.textContent=notice.message; updateAction.onclick=notice.update;
});
${registration};exports.registerPwa();
</script></body></html>`)
    } else if (req.url === '/api/status') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ auth_required: true, auth_providers: ['basic'] })) }
    else { res.statusCode = 401; res.end('Sign in to the fixture gateway') }
  })
  await new Promise(resolve => server.listen(0, '0.0.0.0', resolve))
  container = execFileSync('docker', ['run', '-d', '--rm', '--add-host', 'host.docker.internal:host-gateway', '-p', '127.0.0.1::80', '-e', `HERMES_GATEWAY_URL=http://host.docker.internal:${server.address().port}`, browserImage], { encoding: 'utf8' }).trim()
  const port = execFileSync('docker', ['port', container, '80/tcp'], { encoding: 'utf8' }).trim().split(':').at(-1)
  origin = `http://127.0.0.1:${port}`
  await expect.poll(async () => { try { return (await fetch(origin)).status } catch { return 0 } }).toBe(200)
})
test.afterAll(async () => {
  if (container) execFileSync('docker', ['stop', container], { stdio: 'ignore' })
  server?.closeAllConnections(); await new Promise(resolve => server ? server.close(resolve) : resolve())
})

async function openFixture(page) {
  await page.goto(`${origin}/api/review`)
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.waitForFunction(() => navigator.serviceWorker.controller)
}
async function newCandidate(page) {
  workerVersion++
  await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); await r.update() })
  await expect(page.getByRole('button', { name: 'Update when safe' })).toBeVisible()
}

test('nginx serves the built app and uncached identity; API stays available for recovery', async ({ page }, testInfo) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(origin)
  await expect.poll(() => page.evaluate(() => typeof window.hermesDesktop?.getConnection)).toBe('function')
  await expect(page.getByRole('button', { name: 'Gateway settings' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Use local gateway' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Gateway settings' }).click()
  await expect(page.getByText('This app connects to the server configured by its operator.')).toBeVisible()
  const config = await page.request.get(`${origin}/runtime-config.js`)
  expect(config.headers()['cache-control']).toBe('no-store')
  expect((await page.request.get(`${origin}/api/status`)).status()).toBe(200)
  const info = await (await page.request.get(`${origin}/build-info.json`)).json()
  expect(info.rendererRevision).toMatch(/^[a-f0-9]{40}$/)
  await page.screenshot({ path: testInfo.outputPath('gateway-recovery-desktop.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: testInfo.outputPath('gateway-recovery-phone.png'), fullPage: true })
  expect(errors).toEqual([])
})

test('storage migration binds only the matching connection and survives a reload', async ({ page }) => {
  await openFixture(page)
  await page.evaluate(() => {
    localStorage.setItem('hermes-ui.gateways', JSON.stringify({ activeId: 'old', gateways: [{ id: 'old', url: 'https://backend.test', authMode: 'token', token: 'fixture-token' }] }))
    const state = window.stateFactory(localStorage, 'gateway-id', url => url === 'https://backend.test')
    if (state.load().token !== 'fixture-token' || !state.persisted()) throw Error('Migration failed')
  })
  await page.reload()
  expect(await page.evaluate(() => window.stateFactory(localStorage, 'gateway-id', () => false).load().token)).toBe('fixture-token')
  expect(await page.evaluate(() => window.stateFactory(localStorage, 'different', () => false).load().token)).toBe('')
})

test('a busy second tab and unsent files defer an update; safe text survives activation', async ({ page, context }) => {
  await openFixture(page)
  const other = await context.newPage(); await openFixture(other)
  await other.evaluate(() => window.safety.setActiveWork({ count: 1 }))
  await page.getByRole('textbox', { name: 'Draft' }).fill('keep this draft')
  await newCandidate(page)
  await page.getByRole('button', { name: 'Update when safe' }).click()
  await expect(page.getByRole('status')).toContainText('postponed')
  expect(await page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration()).waiting))).toBe(true)
  await other.evaluate(() => window.safety.setActiveWork({ count: 0 }))
  await page.evaluate(() => { window.unsentFiles = 1 })
  await page.getByRole('button', { name: 'Update when safe' }).click()
  await expect(page.getByRole('status')).toContainText('attachments')
  await page.evaluate(() => { window.unsentFiles = 0 })
  // Same draft in both tabs avoids an intentional concurrent-edit conflict.
  await other.getByRole('textbox', { name: 'Draft' }).fill('keep this draft')
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Update when safe' }).click()])
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('fixture-drafts')).session)).toBe('keep this draft')
})
