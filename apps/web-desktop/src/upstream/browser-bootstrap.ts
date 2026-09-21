/** Restore the selected profile before upstream startup reads its connection. */
export function prepareBrowserBridge(): void {
  let profile: string | null = null
  try { profile = sessionStorage.getItem('hermes-web.browser.profile') } catch { /* Keep the configured default. */ }
  if (!profile) return
  const bridge = window.hermesDesktop
  const getConnection = bridge.getConnection.bind(bridge)
  bridge.getConnection = requested => getConnection(requested ?? profile)
  bridge.profile.get = async () => ({ profile })
}
