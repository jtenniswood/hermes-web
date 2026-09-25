import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { test } from 'node:test'
import ts from 'typescript'

function selectionHarness() {
  const calls = [], errors = []
  const sessionSource = readFileSync('apps/desktop/src/store/session.ts', 'utf8')
  const tree = ts.createSourceFile('session.ts', sessionSource, ts.ScriptTarget.Latest, true)
  const ownerRoute = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'sessionOwnerRouteFromRow')
  assert.ok(ownerRoute, 'The upstream row-ownership helper must exist')
  let fail = false, generation = 0
  let group = 'Team'
  const dependencies = {
    $groupChatWorkspace: { set: value => { group = value } },
    requestSessionResume: (id, owner) => calls.push(['resume', id, owner]),
    forgetSessionOwnerHintsForSession: id => calls.push(['forget', id]),
    bumpBotOpenGeneration: () => { calls.push(['cancel']); return ++generation },
    getBotOpenGeneration: () => generation,
    openSession: (id, navigate) => context.exports.runBrowserSessionSelection(() => { if (fail) throw new Error('Navigation unavailable'); calls.push(['open', id]); navigate('/' + id) }),
    reportActionFailure: message => errors.push(message),
    notifyConversationOpen: () => {}
  }
  const context = vm.createContext({ exports: {}, require: () => dependencies })
  const evaluate = source => vm.runInContext('(function () {' + ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText + '\n})()', context)
  evaluate(ownerRoute.getText(tree))
  dependencies.sessionOwnerRouteFromRow = context.exports.sessionOwnerRouteFromRow
  evaluate(readFileSync('apps/web-desktop/src/upstream/selection-owner.ts', 'utf8'))
  evaluate(readFileSync('apps/web-desktop/src/upstream/selection.ts', 'utf8'))
  return { select: context.exports.selectBrowserSession, calls, errors, group: () => group, fail: () => { fail = true } }
}

test('session commands preserve the clicked owner for identical IDs in different profiles', () => {
  const { select, calls } = selectionHarness()
  for (const profile of ['research', 'writer']) select({ sessionId: 'same-id', connectionId: 'web-single', profile }, route => calls.push(['route', route]))
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['resume', 'same-id', { connectionId: 'web-single', profile: 'research', targetProfile: 'research' }], ['cancel'], ['open', 'same-id'], ['route', '/same-id'],
    ['resume', 'same-id', { connectionId: 'web-single', profile: 'writer', targetProfile: 'writer' }], ['cancel'], ['open', 'same-id'], ['route', '/same-id']
  ])
})

test('untagged session rows clear stale owners before ambient resume', () => {
  const { select, calls } = selectionHarness()
  select({ sessionId: 'legacy', profile: 'default' }, () => {})
  assert.deepEqual(calls, [['forget', 'legacy'], ['resume', 'legacy', undefined], ['cancel'], ['open', 'legacy']])
})

test('session navigation failures reach the browser error surface', () => {
  const { select, errors, fail, group } = selectionHarness()
  fail()
  select({ sessionId: 'unavailable' }, () => {})
  assert.deepEqual(errors, ['Could not open conversation.'])
  assert.equal(group(), 'Team')
})

test('successful session selection releases group identity', () => {
  const { select, group } = selectionHarness()
  select({ sessionId: 'ordinary' }, () => {})
  assert.equal(group(), null)
})
