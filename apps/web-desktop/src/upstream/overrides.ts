import path from 'node:path'
import type { Plugin } from 'vite'

// Match the resolved upstream module so both relative imports and @ aliases
// receive the same local component. Never modify the fetched source directory.
export function rendererOverrides(root: string): Plugin {
  const replacement = path.join(root, 'src/overrides/gateway-settings.tsx')
  const browserBotsToolbar = path.join(root, 'src/experience/browser-bots-toolbar.tsx')
  return {
    name: 'hermes:browser-component-overrides',
    enforce: 'pre',
    async resolveId(source, importer) {
      if (!/(?:^|\/)(?:gateway-settings|roster-pane-toolbar)(?:\.tsx)?$/.test(source)) return null
      const resolved = await this.resolve(source, importer, { skipSelf: true })
      const id = resolved?.id.replaceAll('\\', '/')
      if (id?.endsWith('/desktop/src/app/settings/gateway-settings.tsx')) return replacement
      if (/(?:^|\/)roster-pane-toolbar(?:\.tsx)?$/.test(source) && id?.endsWith('/desktop/src/plugins/hermes-bots/roster-pane-toolbar.tsx')) return browserBotsToolbar
      return null
    }
  }
}
