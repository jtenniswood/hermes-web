import { useStore } from '@nanostores/react'
import { DropdownMenuCheckboxItem } from '@/components/ui/dropdown-menu'
import { Codicon } from '@/components/ui/codicon'
import { $activityToasts, setActivityToasts } from '@/plugins/hermes-bots/roster-actions'

export function BrowserActivityToastsItem() {
  const enabled = useStore($activityToasts)
  return <DropdownMenuCheckboxItem checked={enabled} onCheckedChange={setActivityToasts}>
    <Codicon name={enabled ? 'bell' : 'bell-slash'} size="0.875rem" />
    <span>Activity toasts</span>
  </DropdownMenuCheckboxItem>
}
