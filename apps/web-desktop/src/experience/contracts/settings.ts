export interface BrowserPanelEntry {
  id: string
  collapsible: boolean
}

export interface BrowserSettings {
  activityToasts: { enabled: boolean; toggle: () => void }
  panels: readonly {
    id: string
    checked: boolean | undefined
    /** True when opening; false when closing an already visible desktop pane. */
    select: () => boolean
  }[]
}
