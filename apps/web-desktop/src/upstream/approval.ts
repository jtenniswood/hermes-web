import { useStore } from '@nanostores/react'
import { useEffect } from 'react'
import { $approvalModes, setApprovalModeForProfile, syncApprovalModeForProfile } from '@/store/approval-mode'
import { $gateway } from '@/store/gateway'
import { $gatewayState } from '@/store/session'
import { reportActionFailure } from '../experience/action-errors'
import type { BrowserApproval, BrowserApprovalRequester } from '../experience/contracts/actions'

/** Upstream owns optimistic state, confirmed values, and stale-response guards. */
export function useBrowserApproval(profile: string, requestGateway: BrowserApprovalRequester): BrowserApproval {
  const modes = useStore($approvalModes)
  const gateway = useStore($gateway)
  const gatewayState = useStore($gatewayState)
  useEffect(() => {
    // The connection state can become open just before useGatewayRequest has
    // published the active socket. Do not issue config.get in that gap: its
    // requester would reject with "Hermes gateway unavailable" and show a
    // misleading approval-mode error even though the gateway is connecting.
    if (gatewayState !== 'open' || !gateway) return
    let current = true
    void syncApprovalModeForProfile(requestGateway, profile).catch(() => {
      if (current) reportActionFailure('Could not load approval mode.')
    })
    return () => { current = false }
  }, [gateway, gatewayState, profile, requestGateway])
  return {
    mode: modes[profile.trim() || 'default'] ?? 'smart',
    async setMode(mode) {
      try { await setApprovalModeForProfile(requestGateway, profile, mode) }
      catch { reportActionFailure('Could not change approval mode.') }
    }
  }
}
