import { readFileSync } from 'node:fs'
import path from 'node:path'
import { repositoryRoot } from './renderer.mjs'

export function rendererAliases() {
  const root = path.join(repositoryRoot, 'apps/web-desktop')
  const { compilerOptions: { paths } } = JSON.parse(readFileSync(path.join(root, 'tsconfig.aliases.json'), 'utf8'))
  return Object.entries(paths).sort(([a], [b]) => Number(a.includes('*')) - Number(b.includes('*')) || b.length - a.length).map(([find, [target]]) => {
    const replacement = path.resolve(root, target)
    if (!find.endsWith('*')) return { find: new RegExp('^' + find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'), replacement }
    const prefix = find.slice(0, -1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return { find: new RegExp('^' + prefix + '(.+)$'), replacement: target.endsWith('*') ? replacement.slice(0, -1) + '$1' : replacement }
  })
}
