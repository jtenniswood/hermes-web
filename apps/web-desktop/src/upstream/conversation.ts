import { useStore } from '@nanostores/react'

import { $groupChatWorkspace, $lastRoster, $selectedBot, $selectedStoredSessionId, $sessions } from './browser-api'
import { resolveConversationIdentity, type BrowserConversation } from '../experience/contracts/conversation'

/** Read-only projection of authoritative upstream conversation state. */
export function useBrowserConversation(): BrowserConversation {
  const selectedSessionId = useStore($selectedStoredSessionId)
  const selectedBotKey = useStore($selectedBot)
  const groupName = useStore($groupChatWorkspace)
  const sessions = useStore($sessions)
  const bots = useStore($lastRoster)

  return resolveConversationIdentity({
    selectedSessionId,
    selectedBotKey,
    groupName,
    sessions,
    bots
  })
}
