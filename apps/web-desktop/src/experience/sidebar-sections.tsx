import { useEffect, useState, type ReactNode } from 'react'
import { ActionsContextMenu } from '../upstream/browser-api'

const PINNED_HIDDEN_KEY = 'hermes-web.browser.pinned-section-hidden'

export function BrowserSessionsPane({ hidden, children }: { hidden: boolean; children: ReactNode }) {
  const [pinnedHidden, setPinnedHidden] = useState(() => {
    try { return localStorage.getItem(PINNED_HIDDEN_KEY) === 'true' } catch { return false }
  })
  useEffect(() => {
    try { localStorage.setItem(PINNED_HIDDEN_KEY, String(pinnedHidden)) } catch { /* Optional preference. */ }
  }, [pinnedHidden])

  return <ActionsContextMenu ariaLabel="Sidebar sections" items={kit => <>
    <kit.Item onSelect={() => setPinnedHidden(value => !value)}>
      {pinnedHidden ? 'Show pinned section' : 'Hide pinned section'}
    </kit.Item>
  </>}>
    <div hidden={hidden} className="browser-pane browser-sessions-pane" data-pinned-hidden={pinnedHidden}>
      {children}
    </div>
  </ActionsContextMenu>
}
