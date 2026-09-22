import { $lastRoster, $botMeta, botSelectionKey } from '@/plugins/hermes-bots/data'
import { $groupChats } from '@/plugins/hermes-bots/group-chat'
import { groupChatNames } from '@/plugins/hermes-bots/group-membership'
import { openGroupChat } from '@/plugins/hermes-bots/group-chat-view'
import { openRosterBot } from '@/plugins/hermes-bots/roster-actions'
import { getBotOpenGeneration } from '@/plugins/hermes-bots/shared'
import { reportActionFailure } from '../experience/action-errors'

/** Resolve the exact connection-qualified owner from the authoritative roster. */
export async function selectBrowserBot(key: string): Promise<void> {
  const bot = $lastRoster.get().find(row => botSelectionKey(row) === key)
  if (!bot) {
    reportActionFailure('This Bot is no longer available. Refresh the roster and try again.')
    return
  }
  let generation = getBotOpenGeneration()
  try {
    const opening = openRosterBot(bot)
    generation = getBotOpenGeneration()
    const opened = await opening
    if (!opened && generation === getBotOpenGeneration()) reportActionFailure('Could not open Bot conversation.')
  } catch {
    if (generation === getBotOpenGeneration()) reportActionFailure('Could not open Bot conversation.')
  }
}

/** Existing room state and the engine's room lifecycle remain authoritative. */
export function selectBrowserGroup(name: string): void {
  if ($groupChats.get()[name]?.tombstone || !groupChatNames($botMeta.get(), $groupChats.get()).includes(name)) {
    reportActionFailure('This group is no longer available. Refresh the roster and try again.')
    return
  }
  try {
    openGroupChat(name)
  } catch {
    reportActionFailure('Could not open group conversation.')
  }
}
