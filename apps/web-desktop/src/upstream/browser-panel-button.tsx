import { useStore } from '@nanostores/react'
import type { ReactNode } from 'react'
import { PANE_TOGGLE_REVEAL_EVENT } from '@/components/pane-shell'
import { DropdownMenuCheckboxItem, DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { $collapsedTreeSides, $narrowViewport, $paneVisible, closeTabPane, restoreTreePane, treeSideOfPane } from '@/components/pane-shell/tree/store'

/** Keep each contribution's owning store in sync with its browser controls. */
export function BrowserPanelButton({ id, title, ariaLabel, icon, collapsible, onOpen }: { id: string; title: string; ariaLabel?: string; icon?: ReactNode; collapsible: boolean; onOpen: () => void }) {
  const visible = useStore($paneVisible(id))
  const collapsed = useStore($collapsedTreeSides)
  const narrow = useStore($narrowViewport) && collapsible
  const side = treeSideOfPane(id)
  const open = visible && !(side && collapsed.has(side))
  const Item = narrow ? DropdownMenuItem : DropdownMenuCheckboxItem
  return <Item aria-label={ariaLabel} checked={narrow ? undefined : open} onSelect={() => {
    if (!narrow && open) { closeTabPane(id); return }
    restoreTreePane(id)
    if (narrow) {
      // The overlay reads newly unhidden contributions after React commits.
      requestAnimationFrame(() => window.dispatchEvent(new CustomEvent(PANE_TOGGLE_REVEAL_EVENT, { detail: { id, mode: 'open' } })))
    }
    onOpen()
  }}>{icon}<span>{title}</span></Item>
}
