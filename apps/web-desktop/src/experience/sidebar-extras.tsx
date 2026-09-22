import { createContext, useContext, type ReactNode } from 'react'
import { BrowserNavigationSection } from './ui/navigation-section'
import { Codicon } from '../upstream/browser-api'

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
  const navigate = useContext(NavigateContext)
  return <BrowserNavigationSection id="browser-extra-controls" label="More controls">
    {EXTRA_ROUTES.map(route => <button key={route.path} type="button" onClick={() => navigate(route.path)}>
      <Codicon name={route.icon} size="1rem" /><span>{route.label}</span>
    </button>)}
  </BrowserNavigationSection>
}
