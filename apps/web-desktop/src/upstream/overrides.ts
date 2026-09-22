import path from 'node:path'
import type { Plugin } from 'vite'
import registry from './compatibility-registry.json'

// Match the resolved upstream module so both relative imports and @ aliases
// receive the same local component. Never modify the fetched source directory.
export function rendererOverrides(root: string): Plugin {
  const replacements = registry.filter(entry => entry.kind === 'replacement' && entry.owner.endsWith('/overrides.ts'))
  return {
    name: 'hermes:browser-component-overrides',
    enforce: 'pre',
    async resolveId(source, importer) {
      if (!replacements.some(entry => source.replace(/\.tsx$/, '').endsWith(entry.module!.split('/').at(-1)!.replace(/\.tsx$/, '')))) return null
      const resolved = await this.resolve(source, importer, { skipSelf: true })
      const id = resolved?.id.replaceAll('\\', '/')
      const entry = replacements.find(item => id?.endsWith('/desktop/src/' + item.module))
      if (entry) return path.join(root, entry.replacement!)
      return null
    }
  }
}
