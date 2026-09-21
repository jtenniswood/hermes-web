import { useStore } from '@nanostores/react'
import { useEffect } from 'react'
import { $layoutTree, trackActiveTreeGroup } from '@/components/pane-shell/tree/store'
import { TreeNode } from '@/components/pane-shell/tree/renderer/tree-node'
import { FloatingPanes } from '@/components/pane-shell/tree/renderer/floating-panes'
import { NarrowOverlays } from '@/components/pane-shell/tree/renderer/narrow-overlays'
import { browserWorkspaceTree } from './workspace-tree'
import { useContributions } from '@/contrib/react/use-contributions'

export function BrowserWorkspace() {
  const tree = useStore($layoutTree)
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
