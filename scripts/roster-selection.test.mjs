import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { test } from 'node:test'
import ts from 'typescript'

function harness() {
  const bots = [{ name: 'research', connectionId: 'first', sourceScoped: true }, { name: 'research', connectionId: 'second', sourceScoped: true }]
  const rooms = { Team: { members: bots }, Gone: { tombstone: true } }
  const opened = [], errors = [], pending = []
  let generation = 0
  const dependencies = {
    $lastRoster: { get: () => bots }, $botMeta: { get: () => ({}) }, $groupChats: { get: () => rooms },
    botSelectionKey: bot => `${bot.connectionId}::${bot.name}`,
    groupChatNames: () => ['Team', 'Gone'],
    getBotOpenGeneration: () => generation,
    openRosterBot: bot => { generation++; opened.push(bot); return new Promise((resolve, reject) => pending.push({ resolve, reject })) },
    openGroupChat: name => { generation++; opened.push(name) },
    reportActionFailure: message => errors.push(message)
  }
  const context = vm.createContext({ exports: {}, require: () => dependencies })
  vm.runInContext(ts.transpileModule(readFileSync('apps/web-desktop/src/upstream/roster-selection.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context)
  return { ...context.exports, bots, opened, errors, pending }
}

test('Bot commands resolve the exact connection-qualified row and report a missing owner', async () => {
  const h = harness()
  const opening = h.selectBrowserBot('second::research')
  assert.equal(h.opened[0], h.bots[1])
  h.pending[0].resolve(true)
  await opening
  await h.selectBrowserBot('missing::research')
  assert.equal(h.opened.length, 1)
  assert.match(h.errors[0], /no longer available/)
})

test('superseded Bot failures stay quiet while the latest failure is visible', async () => {
  const h = harness()
  const first = h.selectBrowserBot('first::research')
  const second = h.selectBrowserBot('second::research')
  h.pending[0].reject(new Error('Older request failed'))
  await first
  assert.deepEqual(h.errors, [])
  h.pending[1].resolve(false)
  await second
  assert.deepEqual(h.errors, ['Could not open Bot conversation.'])
})

test('group commands retain live engine rooms and reject deleted or missing rooms', () => {
  const h = harness()
  h.selectBrowserGroup('Team')
  h.selectBrowserGroup('Gone')
  h.selectBrowserGroup('Unknown')
  assert.deepEqual(h.opened, ['Team'])
  assert.equal(h.errors.length, 2)
})
