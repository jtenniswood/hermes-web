import {
  Button,
  cn,
  Codicon,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  SearchField,
  Tip,
  useValue
} from '@hermes/plugin-sdk'
import { DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from '@/components/ui/dropdown-menu'

import { botSourceStatus } from '@/plugins/hermes-bots/data'
import { $showHiddenBots } from '@/plugins/hermes-bots/hidden-bots'
import type { useBots } from '@/plugins/hermes-bots/i18n'
import { GatewayKindGlyph, type rosterGatewayOptions } from '@/plugins/hermes-bots/roster-sections'
import type { RosterActivityFilter, RosterKindFilter, RosterRow } from '@/plugins/hermes-bots/types'

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

type BotsFilterMenuProps = Pick<RenderRosterToolbarProps, 'b' | 'activeFilterCount' | 'gatewayOptions' | 'rowKindFilter' | 'setRowKindFilter' | 'activityFilter' | 'setActivityFilter' | 'gatewayFilter' | 'setGatewayFilter'>

function BotsFilterMenu({ b, activeFilterCount, gatewayOptions, rowKindFilter, setRowKindFilter, activityFilter, setActivityFilter, gatewayFilter, setGatewayFilter }: BotsFilterMenuProps) {
  const showHiddenBots = useValue($showHiddenBots)
  return <DropdownMenu>
    <Tip label={activeFilterCount ? `Filters (${activeFilterCount} active)` : 'Filter roster'}>
      <DropdownMenuTrigger asChild>
        <Button aria-label={activeFilterCount ? `Filter roster, ${activeFilterCount} active` : 'Filter roster'} className={cn('size-6 shrink-0 rounded-md text-(--ui-text-tertiary) hover:text-foreground', activeFilterCount && 'text-(--ui-accent)')} size="icon-xs" variant="ghost"><Codicon name="list-filter" size="0.75rem" /></Button>
      </DropdownMenuTrigger>
    </Tip>
    <DropdownMenuContent align="end">
      <DropdownMenuSub><DropdownMenuSubTrigger>Show</DropdownMenuSubTrigger><DropdownMenuSubContent>
        {([['all', b.roster.botsAndGroups], ['bots', b.roster.botsOnly], ['groups', b.roster.groupsOnly]] as [RosterKindFilter, string][]).map(([value, label]) => <DropdownMenuItem key={`kind:${value}`} onSelect={() => setRowKindFilter(value)}><span className="min-w-0 flex-1">{label}</span>{rowKindFilter === value ? <Codicon name="check" /> : null}</DropdownMenuItem>)}
      </DropdownMenuSubContent></DropdownMenuSub>
      <DropdownMenuSeparator />
      <DropdownMenuSub><DropdownMenuSubTrigger>Filter by time</DropdownMenuSubTrigger><DropdownMenuSubContent>
        {([['all', b.roster.anyActivity], ['active', b.roster.activeNow], ['recent', b.roster.recentlyActive], ['older', b.roster.older]] as [RosterActivityFilter, string][]).map(([value, label]) => <DropdownMenuItem key={`activity:${value}`} onSelect={() => setActivityFilter(value)}><span className="min-w-0 flex-1">{label}</span>{activityFilter === value ? <Codicon name="check" /> : null}</DropdownMenuItem>)}
      </DropdownMenuSubContent></DropdownMenuSub>
      {gatewayOptions.length > 1 && <>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setGatewayFilter('all')}><Codicon className="mr-1.5" name="globe" /><span className="min-w-0 flex-1">All gateways</span>{gatewayFilter === 'all' ? <Codicon name="check" /> : null}</DropdownMenuItem>
        {gatewayOptions.map(option => <DropdownMenuItem key={option.connectionId} onSelect={() => setGatewayFilter(option.connectionId)}><GatewayKindGlyph className="mr-1.5" kind={option.kind} /><span className="min-w-0 flex-1 truncate">{option.label || option.connectionId}</span><span className="text-[0.625rem] tabular-nums text-(--ui-text-quaternary)">{option.count}</span>{gatewayFilter === option.connectionId ? <Codicon name="check" /> : null}</DropdownMenuItem>)}
      </>}
      {activeFilterCount > 0 && <><DropdownMenuSeparator /><DropdownMenuItem onSelect={() => { setRowKindFilter('all'); setActivityFilter('all'); setGatewayFilter('all') }}>{b.roster.clearFilters}</DropdownMenuItem></>}
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => $showHiddenBots.set(!$showHiddenBots.get())}><span className="min-w-0 flex-1">Show hidden bots</span>{showHiddenBots ? <Codicon name="check" /> : null}</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
}

export function renderRosterToolbar({
  b,
  activeSourceRoster,
  setCreateOpen,
  setGroupCreateOpen,
  setSectionDialog,
  showRosterTools,
  showRosterSearch,
  showRosterFilters,
  query,
  setQuery,
  activeFilterCount,
  gatewayOptions,
  rowKindFilter,
  setRowKindFilter,
  activityFilter,
  setActivityFilter,
  gatewayFilter,
  setGatewayFilter
}: RenderRosterToolbarProps) {
  const showHiddenBots = useValue($showHiddenBots)
  return <>
    <div className="flex items-center justify-between gap-2 px-2.5 pt-2.5 pb-1.5">
      <span className="text-[0.6875rem] font-semibold uppercase tracking-wider text-(--ui-text-quaternary)">Bots</span>
      <div className="flex items-center gap-0.5">
        <BotsFilterMenu b={b} activeFilterCount={activeFilterCount} gatewayOptions={gatewayOptions} rowKindFilter={rowKindFilter} setRowKindFilter={setRowKindFilter} activityFilter={activityFilter} setActivityFilter={setActivityFilter} gatewayFilter={gatewayFilter} setGatewayFilter={setGatewayFilter} />
        <DropdownMenu>
          <Tip label="New…">
            <DropdownMenuTrigger asChild>
              <Button aria-label={b.roster.newBotOrGroup} className="rounded-md text-(--ui-text-tertiary) hover:text-foreground" size="icon-xs" variant="ghost">
                <Codicon name="add" size="0.75rem" />
              </Button>
            </DropdownMenuTrigger>
          </Tip>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setCreateOpen(true)}><Codicon className="mr-1.5" name="hubot" />{b.bot.newTitle}</DropdownMenuItem>
            <DropdownMenuItem disabled={activeSourceRoster.length < 2} onSelect={() => setGroupCreateOpen(true)}><Codicon className="mr-1.5" name="organization" />{b.group.newTitle}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setSectionDialog({ mode: 'create' })}><Codicon className="mr-1.5" name="new-folder" />{b.sections.newSection}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
    {showRosterTools && <div className="flex min-w-0 items-center gap-1 px-2.5 pb-1.5">
      {showRosterSearch ? <SearchField aria-label={b.roster.search} containerClassName={cn('min-w-0 flex-1', query ? 'opacity-100!' : 'opacity-50 focus-within:opacity-100')} inputClassName="w-full text-[0.75rem] placeholder:text-(--ui-text-tertiary)" key="roster-search" onChange={setQuery} placeholder={b.roster.searchPlaceholder} value={query} /> : <span className="min-w-0 flex-1" key="roster-search-spacer" />}
      {false && <DropdownMenu>
        <Tip label={activeFilterCount ? `Filters (${activeFilterCount} active)` : 'Filter roster'}>
          <DropdownMenuTrigger asChild>
            <Button aria-label={activeFilterCount ? `Filter roster, ${activeFilterCount} active` : 'Filter roster'} className={cn('size-6 shrink-0 rounded-md text-(--ui-text-tertiary) hover:text-foreground', activeFilterCount && 'text-(--ui-accent)')} size="icon-xs" variant="ghost">
              <Codicon name="list-filter" size="0.75rem" />
            </Button>
          </DropdownMenuTrigger>
        </Tip>
        <DropdownMenuContent align="end">
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Show</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {([
                ['all', b.roster.botsAndGroups], ['bots', b.roster.botsOnly], ['groups', b.roster.groupsOnly]
              ] as [RosterKindFilter, string][]).map(([value, label]) => <DropdownMenuItem key={`kind:${value}`} onSelect={() => setRowKindFilter(value)}>
                <span className="min-w-0 flex-1">{label}</span>{rowKindFilter === value ? <Codicon name="check" /> : null}
              </DropdownMenuItem>)}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Filter by time</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {([
                ['all', b.roster.anyActivity], ['active', b.roster.activeNow], ['recent', b.roster.recentlyActive], ['older', b.roster.older]
              ] as [RosterActivityFilter, string][]).map(([value, label]) => <DropdownMenuItem key={`activity:${value}`} onSelect={() => setActivityFilter(value)}>
                <span className="min-w-0 flex-1">{label}</span>{activityFilter === value ? <Codicon name="check" /> : null}
              </DropdownMenuItem>)}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          {gatewayOptions.length > 1 && <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setGatewayFilter('all')}><Codicon className="mr-1.5" name="globe" /><span className="min-w-0 flex-1">All gateways</span>{gatewayFilter === 'all' ? <Codicon name="check" /> : null}</DropdownMenuItem>
            {gatewayOptions.map(option => {
              const status = botSourceStatus({ sourceError: option.error, sourceReachable: option.reachable })
              return <DropdownMenuItem key={option.connectionId} onSelect={() => setGatewayFilter(option.connectionId)}>
                <GatewayKindGlyph className={cn('mr-1.5', !status.available && 'text-amber-600 dark:text-amber-300')} kind={option.kind} />
                <span className="min-w-0 flex-1 truncate">{option.label || option.connectionId}</span>
                <span className="text-[0.625rem] tabular-nums text-(--ui-text-quaternary)">{option.count}</span>
                {gatewayFilter === option.connectionId ? <Codicon name="check" /> : null}
              </DropdownMenuItem>
            })}
          </>}
          {activeFilterCount > 0 && <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => { setRowKindFilter('all'); setActivityFilter('all'); setGatewayFilter('all') }}>{b.roster.clearFilters}</DropdownMenuItem>
          </>}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => $showHiddenBots.set(!$showHiddenBots.get())}>
            <span className="min-w-0 flex-1">Show hidden bots</span>{showHiddenBots ? <Codicon name="check" /> : null}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>}
    </div>}
  </>
}
