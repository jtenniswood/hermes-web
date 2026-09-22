import { useState, type ReactNode } from 'react'
import { Codicon } from '../../upstream/browser-api'

/** An in-flow disclosure keeps navigation controls reachable without an overlay. */
export function BrowserNavigationSection({ id, label, children, expandLabel = 'More', collapseLabel = 'Less' }: {
  id: string
  label: string
  children: ReactNode
  expandLabel?: string
  collapseLabel?: string
}) {
  const [expanded, setExpanded] = useState(false)
  return <div className="browser-navigation-section">
    <div id={id} role="group" aria-label={label} hidden={!expanded} className="browser-navigation-section-list">{children}</div>
    <button type="button" className="browser-navigation-section-trigger" aria-controls={id} aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
      <Codicon name={expanded ? 'chevron-up' : 'chevron-down'} size=".75rem" /><span>{expanded ? collapseLabel : expandLabel}</span>
    </button>
  </div>
}
