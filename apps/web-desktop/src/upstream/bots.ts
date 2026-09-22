import { useStore } from '@nanostores/react'
import { $showHiddenBots } from '@/plugins/hermes-bots/hidden-bots'

export function useBrowserBotVisibility(): { showHidden: boolean; toggleHidden(): void } {
  const showHidden = useStore($showHiddenBots)
  return { showHidden, toggleHidden: () => $showHiddenBots.set(!$showHiddenBots.get()) }
}
