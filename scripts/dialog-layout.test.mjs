import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../apps/web-desktop/src/experience/ui/dialog-layout.ts', import.meta.url), 'utf8')
const context = vm.createContext({ exports: {} })
vm.runInContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context)
const { browserDialogStyle } = context.exports

test('browser dialog bounds preserve caller styles and constrain numeric and CSS resize dimensions', () => {
  const ordinary = browserDialogStyle()
  assert.equal(ordinary.maxWidth, undefined, 'the upstream max-width class still sizes ordinary forms')
  assert.match(ordinary.width, /100vw \/ var\(--web-ui-scale/)

  const style = { resize: 'both', overflow: 'auto', minWidth: 420, minHeight: 360, maxWidth: '95vw', maxHeight: '90vh', color: 'red' }
  const snapshot = { ...style }
  const advanced = browserDialogStyle(style)
  assert.deepEqual(style, snapshot, 'do not mutate props shared with the upstream form')
  assert.equal(advanced.resize, 'both')
  assert.equal(advanced.overflow, 'auto')
  assert.equal(advanced.color, 'red')
  assert.equal(advanced.minWidth, 'min(420px, calc(100vw / var(--web-ui-scale, 1) - 2rem))')
  assert.equal(advanced.minHeight, 'min(360px, calc(85dvh / var(--web-ui-scale, 1)))')
  assert.equal(advanced.maxWidth, 'min(48rem, calc(100vw / var(--web-ui-scale, 1) - 2rem))')

  const custom = browserDialogStyle({ width: 320, minWidth: '12rem', maxWidth: '40rem' })
  assert.match(custom.width, /^min\(320px,/)
  assert.match(custom.minWidth, /^min\(12rem,/)
  assert.match(custom.maxWidth, /^min\(40rem,/)
})
