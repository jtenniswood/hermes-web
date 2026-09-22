import { readFileSync } from 'node:fs'
import path from 'node:path'
import { repositoryRoot } from './renderer.mjs'

export function rendererAliases() {
  const root = path.join(repositoryRoot, 'apps/web-desktop')
  const registry = JSON.parse(readFileSync(path.join(root, 'src/upstream/compatibility-registry.json'), 'utf8'))
  const paths = Object.fromEntries(registry.filter(entry => entry.kind === 'alias' && entry.aliasGroup === 'renderer').map(entry => [entry.specifier, [entry.replacement]]))
  return Object.entries(paths).sort(([a], [b]) => Number(a.includes('*')) - Number(b.includes('*')) || b.length - a.length).map(([find, [target]]) => {
    const replacement = path.resolve(root, target)
    if (!find.endsWith('*')) return { find: new RegExp('^' + find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'), replacement }
    const prefix = find.slice(0, -1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return { find: new RegExp('^' + prefix + '(.+)$'), replacement: target.endsWith('*') ? replacement.slice(0, -1) + '$1' : replacement }
  })
}

export function compatibilityAliases(root, env = process.env) {
  const registry = JSON.parse(readFileSync(path.join(root, 'src/upstream/compatibility-registry.json'), 'utf8'))
  return registry.filter(entry => entry.kind === 'alias' && entry.aliasGroup === 'vite').sort((a, b) => a.order - b.order).map(entry => ({
    find: entry.pattern ? new RegExp(entry.pattern) : entry.specifier,
    replacement: path.resolve(root, entry.environmentFlag && env[entry.environmentFlag] === '1' ? entry.enabledReplacement : entry.replacement)
  }))
}
export function compatibilitySingletons(root) {
  const registry = JSON.parse(readFileSync(path.join(root, 'src/upstream/compatibility-registry.json'), 'utf8'))
  return registry.filter(entry => entry.kind === 'dedupe').flatMap(entry => entry.packages)
}
