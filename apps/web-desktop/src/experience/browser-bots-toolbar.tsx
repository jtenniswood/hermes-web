import { useRef, useState } from 'react'
import { useBrowserBotVisibility } from '../upstream/bots'
import { cn, Codicon, GatewayKindGlyph, rosterGatewayOptions, SearchField, type RosterActivityFilter, type RosterKindFilter, type RosterRow, type useBots } from '../upstream/browser-api'
import { BrowserActionSurface, type BrowserActionGroup, type BrowserActionAnchor } from './ui/action-surface'
import { BrowserToolbarButton } from './ui/toolbar-button'
import { useCompactBrowser } from './ui/use-compact-browser'

type RenderRosterToolbarProps = {
  b: ReturnType<typeof useBots>
  activityToasts: boolean
  activeSourceRoster: RosterRow[]
  setCreateOpen: (value: boolean) => void
  setGroupCreateOpen: (value: boolean) => void
  setSectionDialog: (value: null | { bot?: RosterRow; mode: 'create' } | { id: string; mode: 'rename'; name: string }) => void
  showRosterTools: boolean
  showRosterSearch: boolean
  showRosterFilters: boolean
  query: string
  setQuery: (value: string) => void
  activeFilterCount: number
  gatewayOptions: ReturnType<typeof rosterGatewayOptions>
  rowKindFilter: RosterKindFilter
  setRowKindFilter: (value: RosterKindFilter) => void
  activityFilter: RosterActivityFilter
  setActivityFilter: (value: RosterActivityFilter) => void
  gatewayFilter: string
  setGatewayFilter: (value: string) => void
}

function BotsActionControl({ title, label = title, icon, active = false, groups }: {
  title: string; label?: string; icon: string; active?: boolean; groups: BrowserActionGroup[]
}) {
  const compact = useCompactBrowser()
  const trigger = useRef<HTMLButtonElement>(null)
  const [anchor, setAnchor] = useState<BrowserActionAnchor | null>(null)
  return <>
    <BrowserToolbarButton ref={trigger} tooltip={label} aria-label={label} aria-haspopup={compact ? 'dialog' : 'menu'} aria-expanded={Boolean(anchor)} className="browser-bots-control" data-active={active || undefined} onClick={event => {
      const bounds = event.currentTarget.getBoundingClientRect()
      setAnchor({ x: bounds.right, y: bounds.bottom, returnFocus: event.currentTarget })
    }}><Codicon name={icon} size="0.75rem" /></BrowserToolbarButton>
    <BrowserActionSurface title={title} groups={groups} anchor={anchor} compact={compact} fallbackFocus={trigger} onClose={() => setAnchor(null)} />
  </>
}

type BotsFilterMenuProps = Pick<RenderRosterToolbarProps, 'b' | 'activeFilterCount' | 'gatewayOptions' | 'rowKindFilter' | 'setRowKindFilter' | 'activityFilter' | 'setActivityFilter' | 'gatewayFilter' | 'setGatewayFilter'>

function BotsFilterMenu({ b, activeFilterCount, gatewayOptions, rowKindFilter, setRowKindFilter, activityFilter, setActivityFilter, gatewayFilter, setGatewayFilter }: BotsFilterMenuProps) {
  const { showHidden, toggleHidden } = useBrowserBotVisibility()
  const groups: BrowserActionGroup[] = [
    { key: 'kind', label: 'Show', selection: 'single', actions: ([['all', b.roster.botsAndGroups], ['bots', b.roster.botsOnly], ['groups', b.roster.groupsOnly]] as [RosterKindFilter, string][]).map(([value, label]) => ({ key: value, label, checked: rowKindFilter === value, keepOpen: true, run: () => setRowKindFilter(value) })) },
    { key: 'activity', label: 'Filter by time', selection: 'single', actions: ([['all', b.roster.anyActivity], ['active', b.roster.activeNow], ['recent', b.roster.recentlyActive], ['older', b.roster.older]] as [RosterActivityFilter, string][]).map(([value, label]) => ({ key: value, label, checked: activityFilter === value, keepOpen: true, run: () => setActivityFilter(value) })) },
    { key: 'gateways', label: 'Gateways', selection: 'single', actions: gatewayOptions.length > 1 ? [
      { key: 'all', label: 'All gateways', icon: <Codicon name="globe" />, checked: gatewayFilter === 'all', keepOpen: true, run: () => setGatewayFilter('all') },
      ...gatewayOptions.map(option => ({ key: option.connectionId, label: `${option.label || option.connectionId} (${option.count})`, icon: <GatewayKindGlyph kind={option.kind} />, checked: gatewayFilter === option.connectionId, keepOpen: true, run: () => setGatewayFilter(option.connectionId) }))
    ] : [] },
    { key: 'visibility', actions: [{ key: 'hidden', label: 'Show hidden bots', checked: showHidden, keepOpen: true, run: toggleHidden }] },
    { key: 'reset', actions: activeFilterCount ? [{ key: 'clear', label: b.roster.clearFilters, keepOpen: true, run: () => { setRowKindFilter('all'); setActivityFilter('all'); setGatewayFilter('all') } }] : [] }
  ]
  return <BotsActionControl title="Filter Bots" label={activeFilterCount ? `Filter roster, ${activeFilterCount} active` : 'Filter roster'} icon="list-filter" active={activeFilterCount > 0} groups={groups} />
}

export function renderRosterToolbar(props: RenderRosterToolbarProps) {
  return <BrowserBotsToolbar {...props} />
}

function BrowserBotsToolbar({ b, activeSourceRoster, setCreateOpen, setGroupCreateOpen, setSectionDialog, showRosterTools, showRosterSearch, query, setQuery, ...filters }: RenderRosterToolbarProps) {
  const create: BrowserActionGroup[] = [{ key: 'create', actions: [
    { key: 'bot', label: b.bot.newTitle, icon: <Codicon name="hubot" />, afterClose: true, run: () => setCreateOpen(true) },
    { key: 'group', label: b.group.newTitle, icon: <Codicon name="organization" />, disabled: activeSourceRoster.length < 2, afterClose: true, run: () => setGroupCreateOpen(true) },
    { key: 'section', label: b.sections.newSection, icon: <Codicon name="new-folder" />, afterClose: true, run: () => setSectionDialog({ mode: 'create' }) }
  ] }]
  return <>
    <div className="browser-bots-heading">
      <span>Bots</span>
      <div className="browser-bots-actions">
        <BotsFilterMenu b={b} {...filters} />
        <BotsActionControl title={b.roster.newBotOrGroup} icon="add" groups={create} />
      </div>
    </div>
    {showRosterTools && <div className="browser-bots-search">
      {showRosterSearch ? <SearchField aria-label={b.roster.search} containerClassName={cn('min-w-0 flex-1', query ? 'opacity-100!' : 'opacity-50 focus-within:opacity-100')} inputClassName="w-full text-[0.75rem] placeholder:text-(--ui-text-tertiary)" key="roster-search" onChange={setQuery} placeholder={b.roster.searchPlaceholder} value={query} /> : <span className="min-w-0 flex-1" key="roster-search-spacer" />}
    </div>}
  </>
}
