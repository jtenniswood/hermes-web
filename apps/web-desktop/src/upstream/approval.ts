import { useStore } from '@nanostores/react'
import { useEffect } from 'react'
import { $approvalModes, setApprovalModeForProfile, syncApprovalModeForProfile } from '@/store/approval-mode'
import { $gatewayState } from '@/store/session'
import { reportActionFailure } from '../experience/action-errors'
import type { BrowserApproval, BrowserApprovalRequester } from '../experience/contracts/actions'

/** Upstream owns optimistic state, confirmed values, and stale-response guards. */
export function useBrowserApproval(profile: string, requestGateway: BrowserApprovalRequester): BrowserApproval {
  const modes = useStore($approvalModes)
  const gatewayState = useStore($gatewayState)
  useEffect(() => {
    if (gatewayState !== 'open') return
    let current = true
    void syncApprovalModeForProfile(requestGateway, profile).catch(() => {
      if (current) reportActionFailure('Could not load approval mode.')
    })
    return () => { current = false }
  }, [gatewayState, profile, requestGateway])
  return {
    mode: modes[profile.trim() || 'default'] ?? 'smart',
    async setMode(mode) {
      try { await setApprovalModeForProfile(requestGateway, profile, mode) }
      catch { reportActionFailure('Could not change approval mode.') }
    }
  }
}
