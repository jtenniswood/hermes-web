const BROWSER_PROFILE_KEY = 'hermes-web.browser.profile'
const LEGACY_PROFILE_KEY = 'hermes-web.comparison.profile'

export function initializeBrowserExperience(): void {
  document.documentElement.dataset.experience = 'browser'
  try {
    if (!sessionStorage.getItem(BROWSER_PROFILE_KEY)) {
      const legacyProfile = sessionStorage.getItem(LEGACY_PROFILE_KEY)
      if (legacyProfile) sessionStorage.setItem(BROWSER_PROFILE_KEY, legacyProfile)
    }
    sessionStorage.removeItem(LEGACY_PROFILE_KEY)
  } catch {
    // Browser storage is optional; the active profile can still be selected in memory.
  }
}
