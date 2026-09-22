/** A clicked session row carries its owner, even when another profile shares its ID. */
export interface BrowserSessionSelection {
  sessionId: string
  connectionId?: string
  profile?: string
}

export type BrowserNavigate = (path: string, options?: { replace?: boolean }) => void
