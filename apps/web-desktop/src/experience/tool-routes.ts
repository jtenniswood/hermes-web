export const BROWSER_TOOL_ROUTES = [
  { path: '/skills', label: 'Capabilities', icon: 'symbol-misc' },
  { path: '/messaging', label: 'Messaging', icon: 'comment' },
  { path: '/artifacts', label: 'Artifacts', icon: 'files' }
] as const

export function isBrowserToolRoute(pathname: string) {
  return BROWSER_TOOL_ROUTES.some(route => route.path === pathname)
}
