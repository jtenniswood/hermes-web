import { useMemo } from 'react'
import { useStore } from '@nanostores/react'
import { computed } from 'nanostores'
import { PANE_TOGGLE_REVEAL_EVENT } from '@/components/pane-shell'
import { $collapsedTreeSides, $layoutTree, $narrowViewport, $paneVisible, closeTabPane, restoreTreePane, treeSideOfPane } from '@/components/pane-shell/tree/store'
import { $activityToasts, setActivityToasts } from '@/plugins/hermes-bots/roster-actions'
import type { BrowserPanelEntry, BrowserSettings } from '../experience/contracts/settings'

/** Project contributed panes without replacing their owning stores or lifecycle. */
export function useBrowserSettings(entries: readonly BrowserPanelEntry[]): BrowserSettings {
  const activityToasts = useStore($activityToasts)
  const collapsed = useStore($collapsedTreeSides)
  const narrowViewport = useStore($narrowViewport)
  // A pane can move between columns without changing its visibility boolean.
  useStore($layoutTree)
  const ids = JSON.stringify(entries.map(entry => entry.id))
  const visibility = useMemo(() => computed((JSON.parse(ids) as string[]).map($paneVisible), (...values) => values), [ids])
  const visible = useStore(visibility)
  return {
    activityToasts: { enabled: activityToasts, toggle: () => setActivityToasts(!$activityToasts.get()) },
    panels: entries.map((entry, index) => {
      const side = treeSideOfPane(entry.id)
      const open = visible[index] && !(side && collapsed.has(side))
      return {
        id: entry.id,
        checked: narrowViewport && entry.collapsible ? undefined : open,
        select() {
          const narrow = $narrowViewport.get() && entry.collapsible
          const currentSide = treeSideOfPane(entry.id)
          const currentlyOpen = $paneVisible(entry.id).get() && !(currentSide && $collapsedTreeSides.get().has(currentSide))
          if (!narrow && currentlyOpen) { closeTabPane(entry.id); return false }
          restoreTreePane(entry.id)
          if (narrow) {
            // The overlay needs the newly restored contribution after React commits.
            requestAnimationFrame(() => window.dispatchEvent(new CustomEvent(PANE_TOGGLE_REVEAL_EVENT, { detail: { id: entry.id, mode: 'open' } })))
          }
          return true
        }
      }
    })
  }
}
