import path from 'node:path'
import type { Plugin } from 'vite'
import registry from './compatibility-registry.json'

// Match the resolved upstream module so both relative imports and @ aliases
// receive the same local component. Never modify the fetched source directory.
export function rendererOverrides(root: string): Plugin {
  const replacements = registry.filter(entry => entry.kind === 'replacement' && entry.owner.endsWith('/overrides.ts'))
  const browserReplacements = new Map([
    ['app/right-sidebar/files/remote-picker.tsx', 'src/overrides/remote-folder-picker.tsx']
  ])
  return {
    name: 'hermes:browser-component-overrides',
    enforce: 'pre',
    async resolveId(source, importer) {
      const remoteFolderPicker = source.replace(/\.tsx$/, '').endsWith('remote-picker')
      if (!remoteFolderPicker && !replacements.some(entry => source.replace(/\.tsx$/, '').endsWith(entry.module!.split('/').at(-1)!.replace(/\.tsx$/, '')))) return null
      const resolved = await this.resolve(source, importer, { skipSelf: true })
      const id = resolved?.id.replaceAll('\\', '/')
      const browserReplacement = [...browserReplacements].find(([module]) => id?.endsWith('/desktop/src/' + module))
      if (browserReplacement) return path.join(root, browserReplacement[1])
      const entry = replacements.find(item => id?.endsWith('/desktop/src/' + item.module))
      if (entry) return path.join(root, entry.replacement!)
      return null
    }
  }
}
