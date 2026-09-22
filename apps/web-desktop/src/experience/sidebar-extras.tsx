import { BROWSER_TOOL_ROUTES } from './tool-routes'
import { createContext, useContext, type ReactNode } from 'react'
import { BrowserNavigationSection } from './ui/navigation-section'
import { Codicon } from '../upstream/browser-api'

const NavigateContext = createContext<(path: string) => void>(() => {})


export function BrowserSidebarNavigation({ onNavigate, children }: { onNavigate: (path: string) => void; children: ReactNode }) {
  return <NavigateContext.Provider value={onNavigate}>{children}</NavigateContext.Provider>
}

export function BrowserSidebarExtras() {
  const navigate = useContext(NavigateContext)
  return <BrowserNavigationSection id="browser-extra-controls" label="More controls">
    {BROWSER_TOOL_ROUTES.map(route => <button key={route.path} type="button" onClick={() => navigate(route.path)}>
      <Codicon name={route.icon} size="1rem" /><span>{route.label}</span>
    </button>)}
  </BrowserNavigationSection>
}
