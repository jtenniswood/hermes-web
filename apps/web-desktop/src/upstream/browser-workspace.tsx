import { useStore } from '@nanostores/react'
import { useEffect } from 'react'
import { $pinnedSessionIds, $sidebarPinsOpen, setSidebarPinsOpen } from '@/store/layout'
import { $layoutTree, trackActiveTreeGroup, removeTreePane, revealTreePane } from '@/components/pane-shell/tree/store'
import { TreeNode } from '@/components/pane-shell/tree/renderer/tree-node'
import { FloatingPanes } from '@/components/pane-shell/tree/renderer/floating-panes'
import { NarrowOverlays } from '@/components/pane-shell/tree/renderer/narrow-overlays'
import { browserWorkspaceTree } from './workspace-tree'
import { useContributions } from '@/contrib/react/use-contributions'

function sessionTileIds(node: unknown): string[] {
  const ids: string[] = []
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return
    const record = value as { children?: unknown; panes?: unknown }
    if (Array.isArray(record.panes)) {
      for (const pane of record.panes) if (typeof pane === 'string' && pane.startsWith('session-tile:')) ids.push(pane)
    }
    if (Array.isArray(record.children)) for (const child of record.children) visit(child)
  }
  visit(node)
  return ids
}

export function revealBrowserWorkspace(): void {
  revealTreePane('workspace')
}

export function BrowserWorkspace() {
  const tree = useStore($layoutTree)
  const pinnedSessionIds = useStore($pinnedSessionIds), pinsOpen = useStore($sidebarPinsOpen)
  useEffect(() => {
    // Clear session-tile panes restored from a desktop layout. Browser chat
    // navigation is single-view, so these stale panes must not become tabs.
    for (const paneId of sessionTileIds(tree)) removeTreePane(paneId)
  }, [tree])
  useEffect(() => {
    if (pinnedSessionIds.length === 0 && pinsOpen) setSidebarPinsOpen(false)
  }, [pinnedSessionIds, pinsOpen])
  const panes = useContributions('panes')
  useEffect(trackActiveTreeGroup, [])
  const panelIds = new Set(panes.filter(pane =>
    !['workspace', 'sessions', 'hermes-bots:pane', 'terminal'].includes(pane.id) &&
    (pane.data as { placement?: string } | undefined)?.placement !== 'main'
  ).map(pane => pane.id))
  const workspace = tree && browserWorkspaceTree(tree, panelIds)
  return <div className="browser-upstream-workspace">
    {workspace && <TreeNode node={workspace} root rootRow={workspace.type === 'split' && workspace.orientation === 'row'} />}
    <NarrowOverlays />
    <FloatingPanes />
  </div>
}
