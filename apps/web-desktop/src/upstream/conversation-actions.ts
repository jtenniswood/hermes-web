import { useStore } from '@nanostores/react'
import { useNavigate } from 'react-router'
import { $selectedStoredSessionId, $sessions, sessionPinId, setSessions } from '@/store/session'
import { $activeGatewayProfile } from '@/store/profile'
import { $pinnedSessionIds, pinSession, unpinSession } from '@/store/layout'
import { deleteSession, setSessionArchived } from '@/api/sessions'
import { $unreadWriteGuard, markSessionUnread, pendingUnreadValue } from './browser-unread'
import { reportActionFailure } from '../experience/action-errors'
import type { BrowserSessionActions } from '../experience/contracts/actions'

/** Commands operate on the displayed session; upstream stores remain authoritative. */
export function useBrowserSessionActions(): BrowserSessionActions {
  const selected = useStore($selectedStoredSessionId)
  const sessions = useStore($sessions)
  const activeProfile = useStore($activeGatewayProfile)
  const pins = useStore($pinnedSessionIds)
  useStore($unreadWriteGuard)
  const navigate = useNavigate()
  const session = sessions.find(row => String(row.id) === selected)
  const profile = session?.profile || activeProfile
  const pinId = session ? sessionPinId(session) : selected
  const pinned = Boolean(pinId && pins.includes(pinId))

  const remove = async (action: 'archive' | 'delete') => {
    if (!selected) return
    try {
      const result = action === 'archive'
        ? await setSessionArchived(selected, true, profile)
        : await deleteSession(selected, profile)
      if (!result.ok) throw new Error('Gateway did not confirm the change')
      setSessions(rows => rows.filter(row => row.id !== selected))
      // Completion belongs to this command; a newer selection keeps its route.
      if ($selectedStoredSessionId.get() === selected) navigate('/')
    } catch {
      reportActionFailure(`Could not ${action} conversation.`)
    }
  }

  return {
    profile,
    pinned,
    unread: pendingUnreadValue(selected, session?.profile) ?? session?.unread === true,
    togglePin() {
      if (!pinId) return
      if ($pinnedSessionIds.get().includes(pinId)) unpinSession(pinId)
      else pinSession(pinId)
    },
    async toggleUnread() {
      if (!selected) return
      const current = $sessions.get().find(row => row.id === selected)
      if (!current) return
      try { await markSessionUnread(selected, !(pendingUnreadValue(selected, current.profile) ?? current.unread === true)) }
      catch { reportActionFailure('Could not change unread status.') }
    },
    archive: () => remove('archive'),
    delete: () => remove('delete')
  }
}
