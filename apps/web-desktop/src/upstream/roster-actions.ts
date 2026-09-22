import { useStore } from '@nanostores/react'
import { host, queryClient } from '@hermes/plugin-sdk'
import { $botMeta, $lastRoster, botSelectionKey, isDefaultBot, ROSTER_KEY, saveBotMeta } from '@/plugins/hermes-bots/data'
import { ensureBotMetadata } from '@/plugins/hermes-bots/canonical-chat'
import { botRosterMeta } from '@/plugins/hermes-bots/routing'
import { displayName } from '@/plugins/hermes-bots/labels'
import { botGroups } from '@/plugins/hermes-bots/group-membership'
import { fallbackSelectionAfterHide } from '@/plugins/hermes-bots/hidden-bots'
import { duplicateBot } from '@/plugins/hermes-bots/profile-ops'
import { $botSections, botSectionId } from '@/plugins/hermes-bots/user-sections'
import type { RosterRow } from '@/plugins/hermes-bots/types'
import { useBots } from '@/plugins/hermes-bots/i18n'
import { reportActionFailure } from '../experience/action-errors'
import type { BrowserActionGroup } from '../experience/ui/action-surface'

export type BotActionCallbacks = {
  onDelete(bot: RosterRow): void
  onEdit(bot: RosterRow): void
  onGroup(bot: RosterRow): void
  onNewSection(bot: RosterRow): void
}

/** UI metadata remains in the upstream store and uses its persistence fallback. */
export function useBrowserBotRowActions(bot: RosterRow, callbacks: BotActionCallbacks) {
  const metadata = useStore($botMeta)
  const sections = useStore($botSections)
  const meta = botRosterMeta(bot, metadata)
  const name = displayName(bot, meta)
  const groups = botGroups(meta)
  const currentSection = botSectionId(bot, metadata)
  const b = useBots()
  const run = (message: string, command: () => void | Promise<unknown>) => () => {
    void Promise.resolve().then(command).catch(() => reportActionFailure(message))
  }
  const save = async (patch: Parameters<typeof saveBotMeta>[1]) => {
    const result = await saveBotMeta(bot, patch)
    if (result.serverOutcome === 'failed') reportActionFailure('Bot changes were saved locally, but could not be saved to the gateway.')
  }
  const actions: BrowserActionGroup[] = [
    { key: 'visibility', actions: [
      { key: 'pin', label: meta?.pinned ? 'Unpin' : 'Pin to top', run: run('Could not change Bot pin.', async () => { const current = await ensureBotMetadata(bot); await save({ pinned: !current.pinned }) }) },
      { key: 'hide', label: meta?.hidden ? 'Unhide' : 'Hide', run: run('Could not change Bot visibility.', async () => {
        const current = await ensureBotMetadata(bot)
        await save({ hidden: !current.hidden })
        if (!current.hidden) fallbackSelectionAfterHide(botSelectionKey(bot))
      }) }
    ] },
    { key: 'manage', actions: [
      { key: 'edit', label: b.bot.editMenu, afterClose: true, run: run('Could not load Bot.', async () => { await ensureBotMetadata(bot); callbacks.onEdit(bot) }) },
      { key: 'groups', label: groups.length ? `Groups: ${groups.join(', ')}…` : 'Manage groups…', afterClose: true, run: run('Could not load Bot groups.', async () => { await ensureBotMetadata(bot); callbacks.onGroup(bot) }) },
      { key: 'duplicate', label: b.bot.duplicate, run: run(b.bot.duplicateFailed, async () => {
        const created = await duplicateBot(bot, $lastRoster.get())
        await queryClient.invalidateQueries({ queryKey: ROSTER_KEY })
        host.notify({ kind: 'success', message: `Created ${created} — full copy of ${bot.name}` })
      }) }
    ] },
    { key: 'sections', label: b.sections.moveTo, actions: [
      ...sections.map(section => ({ key: section.id, label: section.name, disabled: section.id === currentSection, run: run('Could not move Bot to section.', () => save({ sectionId: section.id })) })),
      { key: 'new', label: b.sections.newSectionEllipsis, afterClose: true, run: () => callbacks.onNewSection(bot) },
      ...(currentSection ? [{ key: 'remove', label: b.sections.removeFromSection, run: run('Could not remove Bot from section.', () => save({ sectionId: null })) }] : [])
    ] },
    { key: 'delete', actions: isDefaultBot(bot) ? [] : [{ key: 'delete', destructive: true, label: 'Delete', afterClose: true, run: () => callbacks.onDelete(bot) }] }
  ]
  return { name, actionKey: `bot:${botSelectionKey(bot)}`, groups: actions }
}
