export interface BuildInfo {
  wrapperRevision: string
  rendererRevision: string
  dependencyLockHash: string
  builtAt: string
  channel: string
}

declare const __HERMES_BUILD_INFO__: BuildInfo
export const buildInfo: BuildInfo = __HERMES_BUILD_INFO__
