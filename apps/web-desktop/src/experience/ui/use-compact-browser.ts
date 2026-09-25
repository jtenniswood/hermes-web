import { useSyncExternalStore } from 'react'

// Landscape phones can be wider than the portrait breakpoint while having
// little vertical room. Treat short, coarse-pointer viewports as compact too,
// while leaving taller touch tablets in the split navigation layout.
const query = '(width < 48rem), (pointer:coarse) and (max-height:27rem)'
function subscribe(change: () => void) {
  const media = window.matchMedia(query)
  media.addEventListener('change', change)
  return () => media.removeEventListener('change', change)
}

/** Width controls navigation visibility independently of input and density. */
export function useCompactBrowser() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false)
}

function subscribePointer(change: () => void) {
  const media = window.matchMedia('(pointer: coarse)')
  media.addEventListener('change', change)
  return () => media.removeEventListener('change', change)
}

/** Only touch-first compact windows use sheets and mobile interactions. */
export function useMobileBrowser() {
  const compact = useCompactBrowser()
  const touch = useSyncExternalStore(subscribePointer, () => window.matchMedia('(pointer: coarse)').matches, () => false)
  return compact && touch
}
