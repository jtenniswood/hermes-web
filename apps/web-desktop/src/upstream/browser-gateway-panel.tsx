import { useStore } from '@nanostores/react'
import type { ComponentProps } from 'react'
import { $gatewayState } from '@/store/session'
import { $activeConnectionId } from '@/store/connections'
import { $activeGatewayProfile } from '@/store/profile'
import { useGatewayRequest } from '@/app/gateway/hooks/use-gateway-request'
import { useStatusSnapshot } from '@/app/shell/hooks/use-status-snapshot'
import { GatewayMenuPanel } from '@/app/shell/gateway-menu-panel'

type BrowserGatewayStatus = Pick<ComponentProps<typeof GatewayMenuPanel>, 'gatewayState' | 'inferenceStatus' | 'statusSnapshot'>

/** Keep this model mounted with the shell, including while its dialog is closed. */
export function useBrowserGatewayStatus(): BrowserGatewayStatus {
  const gatewayState = useStore($gatewayState)
  const connection = useStore($activeConnectionId), profile = useStore($activeGatewayProfile)
  const { requestGateway } = useGatewayRequest()
  const { inferenceStatus, statusSnapshot } = useStatusSnapshot(gatewayState, requestGateway, `${connection ?? ''}\0${profile}`)
  return { gatewayState, inferenceStatus, statusSnapshot }
}

export function BrowserGatewayPanel({ status, onClose, onOpenSystem }: { status: BrowserGatewayStatus; onClose(): void; onOpenSystem(): void }) {
  return <GatewayMenuPanel {...status} onClose={onClose} onOpenSystem={onOpenSystem} />
}
