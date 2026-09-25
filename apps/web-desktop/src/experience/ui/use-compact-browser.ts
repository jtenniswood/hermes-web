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

/** Use the same physical viewport breakpoint as the browser navigation. */
export function useCompactBrowser() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false)
}
