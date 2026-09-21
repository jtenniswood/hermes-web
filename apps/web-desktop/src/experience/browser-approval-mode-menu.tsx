import { useStore } from '@nanostores/react'
import { useEffect, useMemo } from 'react'

import type { StatusbarItem } from '@/app/shell/statusbar-controls'
import { DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem } from '@/components/ui/dropdown-menu'
import { Brain, Power, ShieldLock } from '@/lib/icons'
import { useI18n } from '@/i18n'
import { $approvalModes, type ApprovalMode, type ApprovalModeRequester, setApprovalModeForProfile, syncApprovalModeForProfile } from '@/store/approval-mode'

function ApprovalModeIcon({ mode }: { mode: ApprovalMode }) {
  if (mode === 'manual') return <ShieldLock className="size-3.5" />
  if (mode === 'smart') return <Brain className="size-3.5" />
  return <Power className="size-3.5" />
}

export function useApprovalModeStatusbarItem(profile: string, requestGateway: ApprovalModeRequester): StatusbarItem {
  const { t } = useI18n()
  const copy = t.shell.approvalMode
  const modes = useStore($approvalModes)
  const mode = modes[profile.trim() || 'default'] ?? 'smart'
  const labels = useMemo<Record<ApprovalMode, string>>(() => ({ manual: copy.manual, smart: copy.smart, off: copy.off }), [copy.manual, copy.off, copy.smart])
  const descriptions = useMemo<Record<ApprovalMode, string>>(() => ({ manual: copy.manualDescription, smart: 'Ask when needed', off: copy.offDescription }), [copy.manualDescription, copy.offDescription])

  useEffect(() => {
    void syncApprovalModeForProfile(requestGateway, profile).catch(() => undefined)
  }, [profile, requestGateway])

  return {
    className: mode === 'off' ? 'bg-(--chrome-action-hover) text-foreground' : undefined,
    icon: <ApprovalModeIcon mode={mode} />,
    id: 'approval-mode',
    label: labels[mode],
    menuAlign: 'end',
    menuClassName: 'w-72 p-1',
    menuContent: <>
      <DropdownMenuLabel>{copy.title}</DropdownMenuLabel>
      <DropdownMenuRadioGroup onValueChange={value => { void setApprovalModeForProfile(requestGateway, profile, value as ApprovalMode).catch(() => undefined) }} value={mode}>
        {(['manual', 'smart', 'off'] as const).map(value => <DropdownMenuRadioItem className="items-start gap-2" key={value} value={value}>
          <ApprovalModeIcon mode={value} />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-xs text-foreground">{labels[value]}</span>
            <span className="text-[0.6875rem] leading-snug text-(--ui-text-tertiary)">{descriptions[value]}</span>
          </span>
        </DropdownMenuRadioItem>)}
      </DropdownMenuRadioGroup>
    </>,
    title: copy.ariaLabel(labels[mode]),
    variant: 'menu'
  }
}
