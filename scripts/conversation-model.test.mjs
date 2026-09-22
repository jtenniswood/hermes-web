import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const source = file => ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS }
}).outputText
const contract = { exports: {} }
vm.runInNewContext(source('../apps/web-desktop/src/experience/contracts/conversation.ts'), contract)

function model() {
  const stores = {
    $selectedStoredSessionId: { value: 'session-a' },
    $selectedBot: { value: 'web-single::default' },
    $groupChatWorkspace: { value: null },
    $sessions: { value: [{ id: 'session-a', title: 'First chat', profile: 'default' }, { id: 'session-b', title: 'Second chat' }] },
    $lastRoster: { value: [] }
  }
  const context = { exports: {}, require(name) {
    if (name === '@nanostores/react') return { useStore: store => store.value }
    if (name === '../experience/contracts/conversation') return contract.exports
    if (['@/store/session', '@/plugins/hermes-bots/group-chat', '@/plugins/hermes-bots/data', '@/plugins/hermes-bots/bot-state'].includes(name)) return stores
    throw new Error(`Unexpected adapter dependency: ${name}`)
  } }
  vm.runInNewContext(source('../apps/web-desktop/src/upstream/conversation.ts'), context)
  return { stores, read: context.exports.useBrowserConversation }
}

test('background Bot selection metadata cannot dismiss the current conversation navigation', () => {
  const { stores, read } = model()
  const before = read()
  // Observed during startup: the qualified roster key becomes a profile name.
  stores.$selectedBot.value = 'default'
  const after = read()
  assert.equal(after.id, before.id)
  assert.equal(after.selectionKey, before.selectionKey)
})

test('session and Bot identity hydration does not change the selected conversation key', () => {
  const { stores, read } = model()
  stores.$sessions.value = []
  const loading = read()
  stores.$sessions.value = [{ id: 'session-a', title: 'Loaded chat' }]
  assert.equal(read().selectionKey, loading.selectionKey)
  stores.$lastRoster.value = [{ name: 'default', connectionId: 'web-single', canonical_session: { id: 'session-a' } }]
  assert.equal(read().kind, 'bot')
  assert.equal(read().selectionKey, loading.selectionKey)
})

test('real conversation changes dismiss navigation while background state in a group does not', () => {
  const { stores, read } = model()
  const first = read().selectionKey
  stores.$selectedStoredSessionId.value = 'session-b'
  assert.notEqual(read().selectionKey, first)
  stores.$groupChatWorkspace.value = 'session-b'
  const group = read().selectionKey
  stores.$selectedStoredSessionId.value = 'session-a'
  stores.$selectedBot.value = 'other'
  assert.equal(read().selectionKey, group)
  stores.$groupChatWorkspace.value = 'another-group'
  assert.notEqual(read().selectionKey, group)
  stores.$groupChatWorkspace.value = null
  assert.equal(read().selectionKey, first)
})
