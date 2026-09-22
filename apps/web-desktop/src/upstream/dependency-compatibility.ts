import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import type { Plugin } from 'vite'
import registry from './compatibility-registry.json'

// nanostores 1.4.0 marks batch() side-effect-free even though it executes its
// callback. Rolldown consequently deletes upstream batch(() => store.set(...))
// calls whose return value is unused. Remove only that erroneous annotation;
// preserve batching, queue semantics, and all other tree-shaking hints.
const sourceHash = registry.find(entry => entry.name === 'nanostores-batch-effects')!.sourceHash
const before = '/* @__NO_SIDE_EFFECTS__ */\nexport const batch = fn => {'
const after = '/* Hermes Web: batch executes its callback and must be retained. */\nexport const batch = fn => {'
export function preserveBatchEffects(code: string): string {
  const original = code.replace(after, before)
  if (createHash('sha256').update(original).digest('hex') !== sourceHash || original.split(before).length !== 2) {
    throw new Error('nanostores batch compatibility changed; review the locked dependency before building')
  }
  return original.replace(before, after)
}
export function dependencyCompatibilityPlugin(root: string): Plugin {
  const require = createRequire(path.join(root, 'package.json'))
  const target = path.join(path.dirname(require.resolve('nanostores')), 'atom/index.js')
  return {
    name: 'hermes:nanostores-batch-effects', enforce: 'pre',
    buildStart() { preserveBatchEffects(readFileSync(target, 'utf8')) },
    transform(code, id) {
      if (!id.replaceAll('\\', '/').endsWith('/nanostores/atom/index.js')) return null
      return { code: preserveBatchEffects(code), map: null }
    }
  }
}
