import { useSyncExternalStore } from 'react'

const query = '(max-width:47.999rem)'
function subscribe(change: () => void) {
  const media = window.matchMedia(query)
  media.addEventListener('change', change)
  return () => media.removeEventListener('change', change)
}

/** Use the same physical viewport breakpoint as the browser navigation. */
export function useCompactBrowser() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false)
}
