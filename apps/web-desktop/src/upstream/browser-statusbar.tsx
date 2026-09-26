import { createContext, useContext, useEffect, type ComponentProps } from 'react'
import type { StatusbarControls as DesktopStatusbar, StatusbarItem } from '../../../desktop/src/app/shell/statusbar-controls'

export const BackendVersionListener = createContext<((item: StatusbarItem | null) => void) | null>(null)

/** Browser chrome groups the existing wired controls; upstream still owns
 * menus, callbacks, plugin renderers, status polling and permission changes. */
export function StatusbarControls(props: ComponentProps<typeof DesktopStatusbar>) {
  const onBackendVersion = useContext(BackendVersionListener)
  const items = [...(props.leftItems || []), ...(props.items || [])].filter(item => !item.hidden && !['terminal', 'gateway-switcher', 'profile-switcher'].includes(item.id))
  const backendVersion = items.find(item => item.id === 'version-backend')
  useEffect(() => {
    onBackendVersion?.(backendVersion ?? null)
    return () => onBackendVersion?.(null)
  }, [backendVersion, onBackendVersion])
  return null
}
