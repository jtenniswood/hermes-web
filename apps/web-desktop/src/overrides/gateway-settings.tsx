import { assertSafeConnectionChange } from '../platform/reload-safety'
import { connectionState } from '../platform/connection-state'
import { useEffect, useState } from 'react'
import { Button, Input, SettingsContent } from '../upstream/ui'
import { runtimeConfig } from '../platform/runtime'
import { getActiveGateway, updateGateway } from '../web-bridge/gateways'

export function GatewaySettings({ embedded = false }: { embedded?: boolean } = {}) {
  const gateway = getActiveGateway()
  const [mode, setMode] = useState(gateway.authMode)
  const [token, setToken] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { setMode(getActiveGateway().authMode) }, [])

  async function run(action: () => Promise<void>) {
    setBusy(true); setMessage('')
    try { await action() } catch (error) { setMessage(error instanceof Error ? error.message : 'The connection could not be updated.') }
    finally { setBusy(false) }
  }
  const content = <section className="browser-gateway-settings space-y-4 p-4" aria-label="Gateway connection">
    <div><h2 className="text-lg font-semibold">Remote gateway</h2>
      <p className="break-words text-sm">{runtimeConfig().gateway.name}</p>
      <p className="text-sm text-muted-foreground">This app connects to the server configured by its operator.</p></div>
    <label className="block space-y-2"><span>Sign-in method</span>
      <select className="block rounded border bg-background p-2" value={mode} disabled={busy} onChange={event => setMode(event.target.value as 'oauth' | 'token')}>
        <option value="oauth">Browser sign-in</option><option value="token">Session token</option>
      </select>
    </label>
    {mode === 'token' && <label className="block space-y-2"><span>Session token</span>
      <Input type="password" autoComplete="off" value={token} onChange={event => setToken(event.target.value)} placeholder={gateway.token ? 'Leave blank to keep the saved token' : 'Enter a session token'} />
    </label>}
    <div className="flex flex-wrap gap-2">
      <Button disabled={busy} onClick={() => void run(async () => {
        assertSafeConnectionChange()
        updateGateway(gateway.id, { authMode: mode, ...(mode === 'oauth' ? { token: '' } : token ? { token } : {}) })
        if (mode === 'oauth') {
          const result = await window.hermesDesktop.oauthLoginConnectionConfig(window.location.origin)
          if (!result.connected) { setMessage('Sign-in did not complete. Allow the sign-in window and try again.'); return }
        }
        setToken('')
        await window.hermesDesktop.applyConnectionConfig({ mode: 'remote', remoteAuthMode: mode })
        setMessage(connectionState().persisted() ? 'Reconnecting to the configured gateway.' : 'Reconnecting. Your sign-in works in this tab but may not survive a reload.')
      })}>{mode === 'oauth' ? 'Sign in' : 'Save and reconnect'}</Button>
      <Button variant="outline" disabled={busy} onClick={() => void run(async () => {
        await window.hermesDesktop.testConnectionConfig({ mode: 'remote', remoteUrl: window.location.origin })
        setMessage('The configured gateway is reachable.')
      })}>Test connection</Button>
      <Button variant="outline" disabled={busy} onClick={() => void run(async () => {
        assertSafeConnectionChange()
        await window.hermesDesktop.oauthLogoutConnectionConfig(window.location.origin)
        await window.hermesDesktop.applyConnectionConfig({ mode: 'remote', remoteAuthMode: 'oauth', remoteToken: '' }); setToken(''); setMessage('Signed out.')
      })}>Sign out</Button>
    </div>
    {!connectionState().persisted() && <p role="status" className="text-sm">Browser storage is unavailable. Your sign-in works in this tab but may not survive a reload.</p>}
    {message && <p role="status" className="text-sm">{message}</p>}
  </section>
  return embedded ? content : <SettingsContent>{content}</SettingsContent>
}
