export interface BrowserProfile {
  key: string
  label: string
  botName: string
  appearance: { color: string | null; image: string | null; shape: string }
}

export interface BrowserProfiles {
  active: string
  all: boolean
  items: readonly BrowserProfile[]
  fallback: BrowserProfile | null
  select(profile: string | null): void
  reorder(source: string, target: string, after: boolean): void
}
