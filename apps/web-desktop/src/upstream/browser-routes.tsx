import { createContext, useContext, useLayoutEffect, useRef, type ReactNode } from 'react'
import { Routes, useLocation, type Location } from 'react-router'
import { appViewForPath, isOverlayView } from '@/app/routes'
import { isBrowserToolRoute } from '../experience/tool-routes'

const PageSurface = createContext(false)

export function browserRouteCoversWorkspace(pathname: string) {
  return isBrowserToolRoute(pathname) || isOverlayView(appViewForPath(pathname))
}

/** The page and the conversation have separate route contexts and one live instance each. */
export function BrowserPageRoutes({ children }: { children: ReactNode }) {
  return <PageSurface.Provider value>{children}</PageSurface.Provider>
}

/** Keep the last workspace route mounted while a browser or engine overlay is open. */
export function BrowserWorkspaceRoutes({ children }: { children: ReactNode }) {
  const location = useLocation()
  const page = useContext(PageSurface)
  const covered = browserRouteCoversWorkspace(location.pathname)
  const background = useRef<Location>({ pathname: '/', search: '', hash: '', state: null, key: 'browser-background' })
  useLayoutEffect(() => { if (!covered) background.current = location }, [covered, location])
  return <Routes location={page || !covered ? location : background.current}>{children}</Routes>
}
