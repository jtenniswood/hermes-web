// Keep the Sessions/Bots minimize affordance on the layout-tree path in the
// web wrapper. The upstream desktop shell also registers a closer for the
// sessions pane; that closer is correct for the sidebar visibility command,
// but it removes the whole side when the zone's own chevron is pressed. In a
// browser that leaves no rail or other visible way to restore the pane.

const SIDEBAR_PANE_IDS = ['sessions', 'hermes-bots:pane'] as const

function isSessionsZone(group: HTMLElement): boolean {
  return SIDEBAR_PANE_IDS.some(id => group.querySelector(`[data-tree-tab="${id}"]`))
}

function interceptSessionsMinimize(event: MouseEvent): void {
  const target = event.target instanceof Element ? event.target : null
  const button = target?.closest<HTMLButtonElement>('button')
  const group = button?.closest<HTMLElement>('[data-tree-group]')

  if (!button || !button.querySelector('.codicon-chevron-down') || !group || !isSessionsZone(group)) {
    return
  }

  // React's delegated click handler would otherwise call collapseTreePane,
  // whose registered sessions closer hides the entire sidebar. Stop that
  // route and ask the layout tree to render its normal vertical restore rail.
  event.preventDefault()
  event.stopPropagation()

  void import('./upstream/layout').then(({ setTreeGroupMinimized }) => {
    setTreeGroupMinimized(group.dataset.treeGroup ?? '', true)
  })
}

// Capture before React's root listener so the upstream closer never runs.
window.addEventListener('click', interceptSessionsMinimize, true)

export {}
