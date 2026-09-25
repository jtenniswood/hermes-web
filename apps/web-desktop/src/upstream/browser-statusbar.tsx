import { createContext, useContext, useEffect, type ComponentProps } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router'
import { StatusbarItemView } from 'hermes:statusbar-item'
import type { StatusbarControls as DesktopStatusbar, StatusbarItem } from '../../../desktop/src/app/shell/statusbar-controls'

export const ApprovalToolbarTarget = createContext<HTMLElement | null>(null)
export const BackendVersionListener = createContext<((item: StatusbarItem | null) => void) | null>(null)

/** Browser chrome groups the existing wired controls; upstream still owns
 * menus, callbacks, plugin renderers, status polling and permission changes. */
export function StatusbarControls(props: ComponentProps<typeof DesktopStatusbar>) {
  const navigate = useNavigate()
  const toolbarTarget = useContext(ApprovalToolbarTarget)
  const onBackendVersion = useContext(BackendVersionListener)
  const items = [...(props.leftItems || []), ...(props.items || [])].filter(item => !item.hidden && !['terminal', 'gateway-switcher', 'profile-switcher'].includes(item.id))
  const approval = items.find(item => item.id === 'approval-mode')
  const backendVersion = items.find(item => item.id === 'version-backend')
  useEffect(() => {
    onBackendVersion?.(backendVersion ?? null)
    return () => onBackendVersion?.(null)
  }, [backendVersion, onBackendVersion])
  return <>
    {toolbarTarget && createPortal(<>
      {approval && <StatusbarItemView item={{
        ...approval,
        icon: <span aria-hidden="true">{approval.icon}</span>,
        label: <span className="sr-only">{approval.title}</span>,
        detail: undefined
      }} navigate={navigate} />}
    </>, toolbarTarget)}
  </>
}
