export type {
  DesktopBootProgress,
  DesktopCloudAgentSignInResult,
  DesktopCloudDiscoverResult,
  DesktopCloudStatus,
  DesktopConnectionConfig,
  DesktopConnectionConfigInput,
  DesktopOauthLoginResult,
  DesktopOauthLogoutResult,
  DesktopSshHostsResult,
  DesktopSshResolveResult,
  HermesApiRequest,
  HermesConnection,
  HermesReadDirResult,
  HermesReadFileTextResult
} from '@/global'

export type { QuickEntryStatus, QuickEntrySubmitPayload } from '@/store/quick-entry'

declare global {
  interface Window {
    __HERMES_SESSION_TOKEN__?: string
    __HERMES_BASE_PATH__?: string
    __HERMES_WEB_BRIDGE__?: boolean
    __HERMES_WEB_ACTIVE_PROFILE__?: string | null
    /** Dev only: gateway origins the developer whitelisted as reachable, folded
     *  through the dev proxy (HERMES_GATEWAY_URL + config.json +
     *  HERMES_GATEWAY_WHITELIST; see vite.config.ts). */
    __HERMES_GATEWAY_WHITELIST__?: string[]
  }
}


export type HermesNotification = Parameters<Window['hermesDesktop']['notify']>[0]
