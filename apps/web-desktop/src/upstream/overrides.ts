import path from 'node:path'
import type { Plugin } from 'vite'

// Match the resolved upstream module so both relative imports and @ aliases
// receive the same local component. Never modify the fetched source directory.
export function rendererOverrides(root: string): Plugin {
  const replacement = path.join(root, 'src/overrides/gateway-settings.tsx')
  return {
    name: 'hermes:browser-component-overrides',
    enforce: 'pre',
    async resolveId(source, importer) {
      if (!/(?:^|\/)gateway-settings(?:\.tsx)?$/.test(source)) return null
      const resolved = await this.resolve(source, importer, { skipSelf: true })
      return resolved?.id.replaceAll('\\', '/').endsWith('/desktop/src/app/settings/gateway-settings.tsx') ? replacement : null
    }
  }
}
