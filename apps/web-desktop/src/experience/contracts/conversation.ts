/**
 * Browser-facing conversation identity.
 *
 * This module deliberately contains no renderer imports or stores. It is the
 * stable product contract between the browser shell and the upstream adapter.
 */
export type ConversationKind = 'bot' | 'group' | 'session' | 'unknown'
export type ConversationStatus = 'empty' | 'loading' | 'ready'

export interface BrowserConversation {
  kind: ConversationKind
  status: ConversationStatus
  id: string | null
  sessionId: string | null
  profile: string | null
  displayName: string | null
  connectionId: string | null
}

export interface ConversationSession {
  id?: unknown
  title?: unknown
  profile?: unknown
  hidden?: unknown
}

export interface ConversationBot {
  name?: unknown
  display_name?: unknown
  connectionId?: unknown
  canonical_session?: { id?: unknown; resolved_id?: unknown } | null
}

export interface ConversationInput {
  selectedSessionId: string | null
  selectedBotKey: string | null
  groupName: string | null
  sessions: readonly ConversationSession[]
  bots: readonly ConversationBot[]
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function flag(value: unknown): boolean {
  return value === true || value === 1 || value === 'true'
}

function botKey(bot: ConversationBot): string {
  return `${text(bot.connectionId) || 'legacy'}::${text(bot.name)}`
}

function botSessionIds(bot: ConversationBot): string[] {
  return [bot.canonical_session?.id, bot.canonical_session?.resolved_id].map(text).filter(Boolean)
}

function emptyConversation(): BrowserConversation {
  return { kind: 'unknown', status: 'empty', id: null, sessionId: null, profile: null, displayName: null, connectionId: null }
}

/**
 * Resolve the visible identity from stable IDs. A missing selected session is
 * intentionally unknown while the upstream stores hydrate; falling back to a
 * previously selected bot here would leak identity across conversations.
 */
export function resolveConversationIdentity(input: ConversationInput): BrowserConversation {
  const groupName = text(input.groupName)
  if (groupName) {
    return { kind: 'group', status: 'ready', id: groupName, sessionId: null, profile: null, displayName: groupName, connectionId: null }
  }

  const selectedId = text(input.selectedSessionId)
  if (!selectedId) return emptyConversation()

  const session = input.sessions.find(candidate => text(candidate.id) === selectedId)
  if (!session) {
    return { kind: 'unknown', status: 'loading', id: selectedId, sessionId: selectedId, profile: null, displayName: null, connectionId: null }
  }

  const profile = text(session.profile) || null
  const bot = input.bots.find(candidate =>
    botSessionIds(candidate).includes(selectedId) ||
    (flag(session.hidden) && text(input.selectedBotKey) === botKey(candidate) && (!profile || profile === text(candidate.name)))
  )

  if (bot) {
    const name = text(bot.display_name) || text(bot.name) || null
    const connectionId = text(bot.connectionId) || null
    const id = botKey(bot)
    return { kind: 'bot', status: 'ready', id, sessionId: selectedId, profile, displayName: name, connectionId }
  }

  return { kind: 'session', status: 'ready', id: selectedId, sessionId: selectedId, profile, displayName: text(session.title) || null, connectionId: null }
}
