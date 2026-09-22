import { useStore } from '@nanostores/react'

import { $selectedStoredSessionId, $sessions } from '@/store/session'
import { $groupChatWorkspace } from '@/plugins/hermes-bots/group-chat'
import { $lastRoster } from '@/plugins/hermes-bots/data'
import { $selectedBot } from '@/plugins/hermes-bots/bot-state'
import { resolveConversationIdentity, type BrowserConversationModel } from '../experience/contracts/conversation'

/** Read-only projection of authoritative upstream conversation state. */
export function useBrowserConversation(): BrowserConversationModel {
  const selectedSessionId = useStore($selectedStoredSessionId)
  const selectedBotKey = useStore($selectedBot)
  const groupName = useStore($groupChatWorkspace)
  const sessions = useStore($sessions)
  const bots = useStore($lastRoster)

  const identity = resolveConversationIdentity({
    selectedSessionId,
    selectedBotKey,
    groupName,
    sessions,
    bots
  })
  // Roster/profile metadata can change while the same session remains visible.
  // Dismiss navigation only for a different session or group, including before
  // that session's title and Bot identity have finished loading.
  const selectionKey = JSON.stringify(identity.kind === 'group'
    ? ['group', identity.id] : ['session', identity.sessionId])
  return { ...identity, selectionKey }
}
