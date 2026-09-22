/** Browser commands report failures through the shared action error surface. */
export interface BrowserSessionActions {
  profile: string
  pinned: boolean
  unread: boolean
  togglePin(): void
  toggleUnread(): Promise<void>
  archive(): Promise<void>
  delete(): Promise<void>
}

export type BrowserApprovalMode = 'manual' | 'smart' | 'off'
export type BrowserApprovalRequester = (method: string, params?: Record<string, unknown>) => Promise<unknown>
export interface BrowserApproval {
  mode: BrowserApprovalMode
  setMode(mode: BrowserApprovalMode): Promise<void>
}
