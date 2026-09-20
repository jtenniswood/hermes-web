import type { ComponentProps } from 'react'
import { useNavigate } from 'react-router'
import { StatusbarItemView } from 'hermes:statusbar-item'
import type { StatusbarControls as DesktopStatusbar } from '../../../desktop/src/app/shell/statusbar-controls'

/** Browser chrome groups the existing wired controls; upstream still owns
 * menus, callbacks, plugin renderers, status polling and permission changes. */
export function StatusbarControls(props: ComponentProps<typeof DesktopStatusbar>) {
  const navigate = useNavigate()
  const items = [...(props.leftItems || []), ...(props.items || [])].filter(item => !item.hidden && !['terminal', 'gateway-switcher', 'profile-switcher'].includes(item.id))
  const primaryIds = new Set(['approval-mode', 'running-timer'])
  const primary = items.filter(item => primaryIds.has(item.id))
  return <div className="browser-statusbar" role="region" aria-label="Session status">
    <div className="browser-status-controls">{primary.map(item => <StatusbarItemView key={item.id} item={item} navigate={navigate} />)}</div>
  </div>
}
