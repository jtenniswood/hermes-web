import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import vm from 'node:vm'
import { test } from 'node:test'
import ts from 'typescript'

const root = path.resolve('apps/web-desktop')
function evaluate(source, require) {
  const context = vm.createContext({ exports: {}, require })
  vm.runInContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, context)
  return context.exports
}
const file = path.join(root, 'src/upstream/browser-plugin.ts')
const { useBrowserOpenSessionOwner } = evaluate(readFileSync(file, 'utf8'), createRequire(file))
const source = useBrowserOpenSessionOwner(readFileSync('apps/desktop/src/app/open-session.ts', 'utf8'), root)
function harness() {
  const calls = [], errors = []
  let group = 'Team', failure = false, occupied = false, generation = 0
  const dependencies = {
    bumpBotOpenGeneration: () => { calls.push(['cancel']); return ++generation },
    getBotOpenGeneration: () => generation,
    $groupChatWorkspace: { set: value => { group = value } },
    reportActionFailure: error => errors.push(error),
    $activeSessionId: { get: () => occupied ? 'active' : null },
    $selectedStoredSessionId: { get: () => occupied ? 'stored' : null },
    $workspaceIsPage: { get: () => false },
    markSessionRead: id => calls.push(['read', id]),
    setSessionTileWorkspaceScope: (id, scope) => calls.push(['scope', id, scope]),
    focusOpenSession: id => { if (failure) throw new Error('Focus unavailable'); calls.push(['focus', id]); return null },
    focusedSessionNeedsRoute: () => true,
    openSessionTile: (...args) => calls.push(['tile', ...args]),
    reuseBlankDraftTile: () => false,
    canOpenSessionWindow: () => false,
    sessionRoute: id => '/' + id
  }
  const owner = evaluate(readFileSync(path.join(root, 'src/upstream/selection-owner.ts'), 'utf8'), () => dependencies)
  const engine = evaluate(source, name => name.endsWith('selection-owner') ? owner : dependencies)
  return { ...engine, ...owner, calls, errors, group: () => group, fail: () => { failure = true }, occupy: () => { occupied = true }, navigate: route => calls.push(['route', route]) }
}

test('every ordinary session open cancels older Bot work before the engine commits', () => {
  const h = harness()
  h.openSession('picker', h.navigate)
  assert.equal(h.calls[0][0], 'cancel')
  assert.deepEqual(h.calls.at(-1), ['route', '/picker'])
  assert.equal(h.group(), null)
})

test('Bot-scoped opens preserve their activation generation and workspace owner', () => {
  const h = harness()
  const scope = { workspaceMode: 'bots', workspaceOwnerKey: 'legacy::writer', ownerRoute: { profile: 'writer' } }
  h.openSession('writer', h.navigate, 'main', scope)
  assert.equal(h.calls.some(call => call[0] === 'cancel'), false)
  assert.equal(h.calls.find(call => call[0] === 'scope')[2], scope)
  assert.deepEqual(h.calls.at(-1), ['route', '/writer'])
  assert.equal(h.group(), 'Team')
})

test('ordinary palette and reference intents use the browser conversation view', () => {
  const h = harness()
  h.openSession('', h.navigate)
  assert.deepEqual(h.calls, [])
  h.occupy()
  for (const intent of ['stack', 'tab', 'window']) {
    h.openSession('reference', h.navigate, intent)
    assert.deepEqual(h.calls.at(-1), ['route', '/reference'])
  }
  assert.equal(h.calls.some(call => call[0] === 'tile'), false)
  assert.equal(h.group(), null)
})

test('failed synchronous selection is visible and retains the group identity', () => {
  const h = harness()
  h.fail()
  h.openSession('unavailable', h.navigate)
  assert.deepEqual(h.errors, ['Could not open conversation.'])
  assert.equal(h.group(), 'Team')
})
