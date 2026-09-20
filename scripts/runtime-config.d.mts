export const proxyRoutes: string[]
export function matchesGatewayRoute(url?: string): boolean
export interface HostingConfiguration {
  target: string
  home: string
  staticRoot: string
  stateDir: string
  listen: string
  publicConfig: {
    version: 1
    gateway: { id: string; name: string; legacyUrls: string[] }
    capabilities: { gatewaySelection: false; pluginAssets: true }
  }
}
export function runtimeConfiguration(env?: NodeJS.ProcessEnv): HostingConfiguration
export function runtimeScripts(configuration: HostingConfiguration): Record<string, string>
export function renderNginx(template: string, configuration: HostingConfiguration): string
