import { atom } from 'nanostores'

/** Explicit conversation opens also count when the selected identity is unchanged. */
export const $conversationOpenRequest = atom(0)

export function notifyConversationOpen(): void {
  $conversationOpenRequest.set($conversationOpenRequest.get() + 1)
}
