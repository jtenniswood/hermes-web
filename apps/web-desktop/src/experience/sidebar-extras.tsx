import { createContext, useContext, useState, type ReactNode } from 'react'
import { Codicon } from '../upstream/comparison-api'

const NavigateContext = createContext<(path: string) => void>(() => {})
const EXTRA_ROUTES = [
  { path: '/skills', label: 'Capabilities', icon: 'symbol-misc' },
  { path: '/messaging', label: 'Messaging', icon: 'comment' },
  { path: '/artifacts', label: 'Artifacts', icon: 'files' }
]

export function BrowserSidebarNavigation({ onNavigate, children }: { onNavigate: (path: string) => void; children: ReactNode }) {
  return <NavigateContext.Provider value={onNavigate}>{children}</NavigateContext.Provider>
}

export function BrowserSidebarExtras() {
  const [expanded, setExpanded] = useState(false)
  const navigate = useContext(NavigateContext)
  return <div className="browser-more-wrap">
    <div id="browser-extra-controls" role="group" aria-label="More controls" hidden={!expanded} className="browser-more-list">
      {EXTRA_ROUTES.map(route => <button key={route.path} type="button" onClick={() => navigate(route.path)}>
        <Codicon name={route.icon} size="1rem" /><span>{route.label}</span>
      </button>)}
    </div>
    <button type="button" className="browser-more-trigger" aria-controls="browser-extra-controls" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
      <Codicon name={expanded ? 'chevron-up' : 'chevron-down'} size=".75rem" /><span>{expanded ? 'Less' : 'More'}</span>
    </button>
  </div>
}
