import { atom } from 'nanostores'

/** Explicit conversation opens also count when the selected identity is unchanged. */
export const $conversationOpenRequest = atom(0)

/** A sidebar-created side chat should leave its project list visible on mobile. */
export const $preserveNavigationRequest = atom(0)

export function notifyConversationOpen(): void {
  $conversationOpenRequest.set($conversationOpenRequest.get() + 1)
}

export function preserveNavigationForNextSelection(): void {
  $preserveNavigationRequest.set($preserveNavigationRequest.get() + 1)
}
